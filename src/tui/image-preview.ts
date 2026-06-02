import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getCacheDir } from "../storage/paths.js";

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

async function resolveTerminalImage(
  url: string,
  size: TerminalImageSize
): Promise<{ data: Buffer; fittedSize: TerminalImageSize } | undefined> {
  if (!isSupportedImageSource(url)) {
    return undefined;
  }

  const sourcePath = await resolveImageSource(url);
  if (!sourcePath) {
    return undefined;
  }
  const renderPath = await ensureRenderableImage(sourcePath);
  const data = await readFile(renderPath);
  return {
    data,
    fittedSize: fitTerminalImageSize(renderPath, data, size)
  };
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

async function ensureRenderableImage(path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") {
    return path;
  }

  const pngPath = join(tmpdir(), "cc98-cli-images", `${createHash("sha256").update(path).digest("hex")}.png`);
  try {
    await readFile(pngPath);
    return pngPath;
  } catch {
    await mkdir(join(tmpdir(), "cc98-cli-images"), { recursive: true, mode: 0o700 });
    const source = extension === ".gif" ? `${path}[0]` : path;
    await execFileAsync("/opt/homebrew/bin/magick", [source, "-auto-orient", pngPath]);
    return pngPath;
  }
}

function fitTerminalImageSize(path: string, data: Buffer, bounds: TerminalImageSize): TerminalImageSize {
  const pixelSize = getImagePixelSize(path, data);
  const maxColumns = Math.max(1, Math.floor(bounds.columns ?? 0) || Number.MAX_SAFE_INTEGER);
  const maxRows = Math.max(1, Math.floor(bounds.rows ?? 0) || Number.MAX_SAFE_INTEGER);
  const pixelWidthPerColumn = terminalCellAspectRatio;
  const widthLimitedRows = Math.max(1, Math.floor((maxColumns * pixelWidthPerColumn * pixelSize.height) / pixelSize.width));

  if (widthLimitedRows <= maxRows) {
    return {
      columns: maxColumns,
      rows: widthLimitedRows
    };
  }

  const heightLimitedColumns = Math.max(1, Math.floor((maxRows * pixelSize.width) / (pixelSize.height * pixelWidthPerColumn)));
  return {
    columns: Math.min(maxColumns, heightLimitedColumns),
    rows: maxRows
  };
}

function getImagePixelSize(path: string, data: Buffer): ImagePixelSize {
  const cached = imagePixelSizeCache.get(path);
  if (cached) {
    return cached;
  }
  if (data.length < 24 || data.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("failed to read png size");
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error("failed to read png size");
  }

  const size = { width, height };
  imagePixelSizeCache.set(path, size);
  return size;
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
  const args = ["f=100", "a=T", "t=d"];
  const columns = Math.floor(size.columns ?? 0);
  const rows = Math.floor(size.rows ?? 0);
  if (columns > 0) {
    args.push(`c=${columns}`);
  }
  if (rows > 0) {
    args.push(`r=${rows}`);
  }
  return `\x1b_G${args.join(",")};${payload}\x1b\\`;
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
