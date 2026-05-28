import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { getCacheDir } from "../storage/paths.js";

export const imagePreviewRows = 8;

type ImageProtocol = "kitty" | "iterm2";
const imagePreviewTokens = new Map<string, string>();
let nextImagePreviewId = 1;
const execFileAsync = promisify(execFile);

export function supportsImagePreview(): boolean {
  return detectImageProtocol() !== undefined;
}

export async function loadImagePreview(url: string, columns: number, rows = imagePreviewRows): Promise<string | undefined> {
  const protocol = detectImageProtocol();
  if (!protocol || !/^https?:\/\//i.test(url) || !isPreviewableImageUrl(url)) {
    return undefined;
  }

  const sourcePath = await ensureCachedImage(url);
  if (!sourcePath) {
    return undefined;
  }
  const renderPath = await ensureRenderableImage(sourcePath);

  let sequence: string;
  if (protocol === "kitty") {
    const data = await readFile(renderPath);
    sequence = wrapTerminalSequence(kittyImage(data, rows));
  } else {
    const data = await readFile(renderPath);
    sequence = wrapTerminalSequence(iterm2Image(data, rows));
  }
  return registerImagePreview(sequence);
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
    await execFileAsync("/opt/homebrew/bin/magick", [path, "-auto-orient", pngPath]);
    return pngPath;
  }
}

function imageCachePath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  const pathname = new URL(url).pathname;
  const extension = extname(pathname).slice(0, 12) || ".img";
  return join(getCacheDir(), "images", `${hash}${extension}`);
}

function isPreviewableImageUrl(url: string): boolean {
  try {
    return /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function kittyImage(data: Buffer, rows: number): string {
  const payload = data.toString("base64");
  const h = Math.max(1, Math.floor(rows));
  return `\x1b_Gf=100,a=T,t=d,r=${h};${payload}\x1b\\`;
}

function iterm2Image(data: Buffer, rows: number): string {
  const payload = data.toString("base64");
  const height = Math.max(1, Math.floor(rows));
  return `\x1b]1337;File=inline=1;height=${height};preserveAspectRatio=1:${payload}\x07`;
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
