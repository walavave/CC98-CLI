import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openSync, readSync, closeSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getCacheDir } from "../../storage/paths.js";

export const imagePreviewRows = 8;

export interface TerminalImageSize {
  columns?: number;
  rows?: number;
}

export interface LoadedTerminalImage {
  token: string;
  size: {
    columns: number;
    rows: number;
  };
}

type ImageProtocol = "kitty" | "iterm2";
interface ImagePixelSize {
  width: number;
  height: number;
}

const imagePreviewTokens = new Map<string, string>();
const imagePixelSizeCache = new Map<string, ImagePixelSize>();
let nextImagePreviewId = 1;
const execFileAsync = promisify(execFile);
const terminalCellAspectRatio = 0.4;

/** Images larger than this on any side are resized down via ImageMagick. */
const maxImagePixelDimension = 2000;

/** Kitty protocol chunk size for base64 payload. */
const kittyChunkSize = 4096;

/** Read PNG dimensions from an in-memory buffer (IHDR at offset 16). */
function readPngSizeFromBuffer(data: Buffer): ImagePixelSize | undefined {
  if (data.length < 24 || data.toString("ascii", 1, 4) !== "PNG") {
    return undefined;
  }
  const w = data.readUInt32BE(16);
  const h = data.readUInt32BE(20);
  return w > 0 && h > 0 ? { width: w, height: h } : undefined;
}

/**
 * Read pixel dimensions of a local image file.
 *
 * Fast path — reads the PNG IHDR directly without a subprocess.
 * Fallback — delegates to `magick identify` for any other format
 * (JPEG, WebP, AVIF, HEIC, …).
 */
async function readImagePixelSize(path: string): Promise<ImagePixelSize | undefined> {
  const cached = imagePixelSizeCache.get(path);
  if (cached) {
    return cached;
  }

  // Fast path: PNG IHDR.
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const header = Buffer.alloc(24);
    const bytesRead = readSync(fd, header, 0, 24, 0);
    if (bytesRead >= 24 && header.toString("ascii", 1, 4) === "PNG") {
      const w = header.readUInt32BE(16);
      const h = header.readUInt32BE(20);
      if (w > 0 && h > 0) {
        const result = { width: w, height: h };
        imagePixelSizeCache.set(path, result);
        return result;
      }
    }
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
  }

  // Fallback: ImageMagick identify.
  try {
    const { stdout } = await execFileAsync("/opt/homebrew/bin/magick", ["identify", "-format", "%w %h", path]);
    const [ws, hs] = stdout.trim().split(/\s+/);
    const w = Number.parseInt(ws, 10);
    const h = Number.parseInt(hs, 10);
    if (w > 0 && h > 0) {
      const result = { width: w, height: h };
      imagePixelSizeCache.set(path, result);
      return result;
    }
  } catch {
    /* magick unavailable */
  }
  return undefined;
}

export function supportsImagePreview(): boolean {
  return detectImageProtocol() !== undefined;
}

export async function loadImagePreview(url: string, columns: number, rows?: number): Promise<LoadedTerminalImage | undefined> {
  return loadTerminalImage(url, { columns, rows });
}

export async function loadModalImagePreview(
  url: string,
  columns: number,
  rows: number
): Promise<LoadedTerminalImage | undefined> {
  return loadTerminalImage(url, { columns, rows });
}

export async function measureImagePreview(url: string, columns: number, rows?: number): Promise<LoadedTerminalImage["size"] | undefined> {
  const resolved = await resolveTerminalImage(url, { columns, rows });
  if (!resolved) {
    return undefined;
  }
  return {
    columns: Math.max(1, Math.floor(resolved.fittedSize.columns ?? 1)),
    rows: Math.max(1, Math.floor(resolved.fittedSize.rows ?? 1))
  };
}

async function loadTerminalImage(url: string, size: TerminalImageSize): Promise<LoadedTerminalImage | undefined> {
  const protocol = detectImageProtocol();
  if (!protocol) {
    return undefined;
  }

  const resolved = await resolveTerminalImage(url, size);
  if (!resolved) {
    return undefined;
  }
  const { data, fittedSize } = resolved;

  let sequence: string;
  if (protocol === "kitty") {
    sequence = wrapTerminalSequence(kittyImage(data, fittedSize));
  } else {
    sequence = wrapTerminalSequence(iterm2Image(data, fittedSize));
  }
  return {
    token: registerImagePreview(sequence),
    size: {
      columns: Math.max(1, Math.floor(fittedSize.columns ?? 1)),
      rows: Math.max(1, Math.floor(fittedSize.rows ?? 1))
    }
  };
}

async function resolveTerminalImage(url: string, size: TerminalImageSize): Promise<{ data: Buffer; fittedSize: TerminalImageSize } | undefined> {
  if (!isSupportedImageSource(url)) {
    return undefined;
  }

  const sourcePath = await resolveImageSource(url);
  if (!sourcePath) {
    return undefined;
  }

  // Determine original pixel dimensions (PNG IHDR or magick identify).
  const pixelSize = await readImagePixelSize(sourcePath);
  if (!pixelSize) {
    // Fallback: convert without knowing size, then read PNG dimensions.
    const renderPath = await ensureRenderableImage(sourcePath);
    const data = await readFile(renderPath);
    // Try reading PNG header from converted data.
    const fallbackSize = readPngSizeFromBuffer(data);
    if (!fallbackSize) {
      return undefined;
    }
    const fittedSize = fitTerminalImageSize(fallbackSize, size);
    return { data, fittedSize };
  }

  // Calculate how many terminal cells the image will occupy.
  const fittedSize = fitTerminalImageSize(pixelSize, size);

  // Terminal previews do not need the original full-resolution PNG payload.
  const resizePixels = computeViewportResizePixelSize(fittedSize);
  const maxDim = Math.max(pixelSize.width, pixelSize.height);
  const resizeLimit = resizePixels !== undefined
    ? Math.min(maxImagePixelDimension, Math.max(resizePixels.width, resizePixels.height))
    : maxDim > maxImagePixelDimension ? maxImagePixelDimension : undefined;

  // Render as PNG, resized if worthwhile.
  const renderPath = await ensureRenderableImage(sourcePath, resizeLimit);
  const data = await readFile(renderPath);
  return { data, fittedSize };
}

function computeViewportResizePixelSize(size: TerminalImageSize): ImagePixelSize | undefined {
  const columns = Math.max(1, Math.floor(size.columns ?? 0));
  const rows = Math.max(1, Math.floor(size.rows ?? 0));
  if (!columns || !rows) {
    return undefined;
  }
  // Terminal cell size estimate tuned to keep payload close to visual need.
  const width = Math.max(64, columns * 14);
  const height = Math.max(64, rows * 28);
  return { width, height };
}

function fitTerminalImageSize(pixelSize: ImagePixelSize, bounds: TerminalImageSize): TerminalImageSize {
  const maxColumns = Math.max(1, Math.floor(bounds.columns ?? 0) || Number.MAX_SAFE_INTEGER);
  const maxRows = Math.max(1, Math.floor(bounds.rows ?? 0) || Number.MAX_SAFE_INTEGER);
  const pixelWidthPerColumn = terminalCellAspectRatio;
  const widthLimitedRows = Math.max(1, Math.floor((maxColumns * pixelWidthPerColumn * pixelSize.height) / pixelSize.width));

  if (widthLimitedRows <= maxRows) {
    return { columns: maxColumns, rows: widthLimitedRows };
  }

  const heightLimitedColumns = Math.max(1, Math.floor((maxRows * pixelSize.width) / (pixelSize.height * pixelWidthPerColumn)));
  return { columns: Math.min(maxColumns, heightLimitedColumns), rows: maxRows };
}

function detectImageProtocol(): ImageProtocol | undefined {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
  if (process.env.KITTY_WINDOW_ID || termProgram === "wezterm" || termProgram === "ghostty") {
    return "kitty";
  }
  if (termProgram.includes("iterm")) {
    return "iterm2";
  }
  return undefined;
}

async function ensureCachedImage(url: string): Promise<string> {
  const path = imageCachePath(url);
  try {
    await readFile(path);
    return path;
  } catch {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "cc98-cli"
      }
    });
    if (!response.ok) {
      throw new Error(`image request failed: ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    await mkdir(join(getCacheDir(), "images"), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { mode: 0o600 });
    return path;
  }
}

async function resolveImageSource(url: string): Promise<string | undefined> {
  if (/^https?:\/\//i.test(url)) {
    return ensureCachedImage(url);
  }

  const localPath = toLocalImagePath(url);
  if (!localPath) {
    return undefined;
  }

  await readFile(localPath);
  return localPath;
}

/**
 * Ensure a source image is available as PNG, optionally resized.
 *
 * When `maxPixelDimension` is set, images larger than that limit on their
 * longest side are shrunk via ImageMagick in the same pass that converts
 * non-PNG formats.  The cache key incorporates the dimension so that
 * different display contexts (inline preview vs. modal viewer) each get
 * appropriately-sized files.
 */
async function ensureRenderableImage(path: string, maxPixelDimension?: number): Promise<string> {
  const extension = extname(path).toLowerCase();
  const cacheKey = createHash("sha256")
    .update(path + (maxPixelDimension ? `:size${maxPixelDimension}` : ""))
    .digest("hex");
  const outPath = join(tmpdir(), "cc98-cli-images", `${cacheKey}.png`);

  // Hit the cache first.
  try {
    await readFile(outPath);
    return outPath;
  } catch {
    // Cache miss – create the file.
  }

  await mkdir(join(tmpdir(), "cc98-cli-images"), { recursive: true, mode: 0o700 });
  const source = extension === ".gif" ? `${path}[0]` : path;

  const magickArgs = [source, "-auto-orient"];
  if (maxPixelDimension !== undefined && maxPixelDimension > 0) {
    // `>` means "only shrink, never enlarge".
    magickArgs.push("-resize", `${maxPixelDimension}x${maxPixelDimension}>`);
  }
  // Strip metadata AFTER resize so color profiles are available during resize.
  magickArgs.push("-strip", outPath);

  try {
    await execFileAsync("/opt/homebrew/bin/magick", magickArgs);
  } catch (firstError) {
    // Resize may fail for some images (corrupt ICC profile, etc.).
    // Try without resize as a fallback.
    if (maxPixelDimension !== undefined && maxPixelDimension > 0) {
      const fallbackArgs = [source, "-auto-orient", "-strip", outPath];
      await execFileAsync("/opt/homebrew/bin/magick", fallbackArgs);
    } else {
      throw firstError;
    }
  }
  return outPath;
}

function imageCachePath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  const pathname = new URL(url).pathname;
  const extension = extname(pathname).slice(0, 12) || ".img";
  return join(getCacheDir(), "images", `${hash}${extension}`);
}

function isSupportedImageSource(url: string): boolean {
  return isHttpImageUrl(url) || isLocalImagePath(url);
}

function isHttpImageUrl(url: string): boolean {
  try {
    return /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isLocalImagePath(url: string): boolean {
  const localPath = toLocalImagePath(url);
  return localPath !== undefined && /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(localPath);
}

function toLocalImagePath(url: string): string | undefined {
  if (isAbsolute(url)) {
    return url;
  }
  if (url.startsWith("file://")) {
    return fileURLToPath(url);
  }
  return undefined;
}

function kittyImage(data: Buffer, size: TerminalImageSize): string {
  const payload = data.toString("base64");
  const columns = Math.floor(size.columns ?? 0);
  const rows = Math.floor(size.rows ?? 0);

  // Build the shared argument list (applied only to the first chunk).
  const staticArgs = ["f=100", "a=T", "t=d"];
  if (columns > 0) {
    staticArgs.push(`c=${columns}`);
  }
  if (rows > 0) {
    staticArgs.push(`r=${rows}`);
  }

  // Single-chunk path – identical to original behaviour.
  if (payload.length <= kittyChunkSize) {
    return `\x1b_G${staticArgs.join(",")};${payload}\x1b\\`;
  }

  // Chunked transmission — split the base64 payload.
  const chunks: string[] = [];
  for (let pos = 0; pos < payload.length; pos += kittyChunkSize) {
    chunks.push(payload.slice(pos, pos + kittyChunkSize));
  }

  let result = "";
  for (let i = 0; i < chunks.length; i += 1) {
    const isLast = i === chunks.length - 1;
    if (i === 0) {
      // First chunk carries all parameters + m=1 (more to follow).
      staticArgs.push("m=1");
      result += `\x1b_G${staticArgs.join(",")};${chunks[i]}\x1b\\`;
    } else if (isLast) {
      result += `\x1b_Gm=0;${chunks[i]}\x1b\\`;
    } else {
      // Middle chunks: just m=1.
      result += `\x1b_Gm=1;${chunks[i]}\x1b\\`;
    }
  }
  return result;
}

function iterm2Image(data: Buffer, size: TerminalImageSize): string {
  const payload = data.toString("base64");
  const args = ["inline=1", "preserveAspectRatio=1"];
  const columns = Math.floor(size.columns ?? 0);
  const rows = Math.floor(size.rows ?? 0);
  if (columns > 0) {
    args.push(`width=${columns}`);
  }
  if (rows > 0) {
    args.push(`height=${rows}`);
  }
  return `\x1b]1337;File=${args.join(";")}:${payload}\x07`;
}

function wrapTerminalSequence(sequence: string): string {
  if (!process.env.TMUX) {
    return sequence;
  }
  return `\x1bPtmux;${sequence.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

export function getImagePreviewSequence(token: string): string | undefined {
  return imagePreviewTokens.get(token);
}

export function getClearVisibleImageSequence(): string {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
  if (process.env.KITTY_WINDOW_ID || termProgram === "wezterm" || termProgram === "ghostty") {
    return wrapTerminalSequence("\x1b_Ga=d\x1b\\");
  }
  return "";
}

function registerImagePreview(sequence: string): string {
  const token = `@@CC98_IMG_${nextImagePreviewId}@@`;
  nextImagePreviewId += 1;
  imagePreviewTokens.set(token, sequence);
  return token;
}
