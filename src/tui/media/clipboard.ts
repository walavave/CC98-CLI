import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export async function readClipboardImageFile(): Promise<File | undefined> {
  switch (process.platform) {
    case "darwin":
      return readMacClipboardImageFile();
    case "linux":
      return readLinuxClipboardImageFile();
    default:
      return undefined;
  }
}

export async function readClipboardText(): Promise<string | undefined> {
  switch (process.platform) {
    case "darwin":
      return captureText("pbpaste", []);
    case "linux":
      return readLinuxClipboardText();
    case "win32":
      return captureText("powershell", ["-NoProfile", "-Command", "Get-Clipboard"]);
    default:
      return undefined;
  }
}

async function readMacClipboardImageFile(): Promise<File | undefined> {
  const dir = await mkdtemp(join(tmpdir(), "cc98-clipboard-"));
  const outputPath = join(dir, "clipboard-image.bin");
  try {
    const mimeType = await writeMacClipboardImage(outputPath);
    if (!mimeType) {
      return undefined;
    }
    const bytes = await readFile(outputPath);
    const extension = mimeType === "image/tiff" ? "tiff" : "png";
    return new File([bytes], `clipboard-image.${extension}`, { type: mimeType });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeMacClipboardImage(outputPath: string): Promise<string | undefined> {
  const script = [
    `set outPath to POSIX file "${escapeAppleScriptString(outputPath)}"`,
    "try",
    "  try",
    "    set imageData to the clipboard as «class PNGf»",
    '    set imageType to "image/png"',
    "  on error",
    "    set imageData to the clipboard as «class TIFF»",
    '    set imageType to "image/tiff"',
    "  end try",
    "  set fileRef to open for access outPath with write permission",
    "  set eof fileRef to 0",
    "  write imageData to fileRef",
    "  close access fileRef",
    "  return imageType",
    "on error",
    "  try",
    "    close access outPath",
    "  end try",
    "  return \"\"",
    "end try"
  ];
  const result = await captureText("osascript", script.flatMap((line) => ["-e", line]));
  const mimeType = result?.trim();
  return mimeType ? mimeType : undefined;
}

async function readLinuxClipboardImageFile(): Promise<File | undefined> {
  const mimeTypes = [
    { type: "image/png", extension: "png" },
    { type: "image/jpeg", extension: "jpg" },
    { type: "image/tiff", extension: "tiff" },
    { type: "image/webp", extension: "webp" }
  ];

  for (const entry of mimeTypes) {
    const wlPaste = await captureBinary("wl-paste", ["--no-newline", "--type", entry.type]);
    if (wlPaste) {
      return new File([wlPaste], `clipboard-image.${entry.extension}`, { type: entry.type });
    }
    const xclip = await captureBinary("xclip", ["-selection", "clipboard", "-t", entry.type, "-o"]);
    if (xclip) {
      return new File([xclip], `clipboard-image.${entry.extension}`, { type: entry.type });
    }
  }
  return undefined;
}

async function readLinuxClipboardText(): Promise<string | undefined> {
  return (await captureText("wl-paste", ["--no-newline"])) ??
    (await captureText("xclip", ["-selection", "clipboard", "-o"]));
}

function captureText(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];

    child.on("error", () => resolve(undefined));
    child.stdout.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function captureBinary(command: string, args: string[]): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];

    child.on("error", () => resolve(undefined));
    child.stdout.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve(undefined);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
