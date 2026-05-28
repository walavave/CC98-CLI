#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultUrl = "https://file.cc98.org/v4-upload/d/2026/0527/4bvduwze.webp";
const url = process.argv[2] ?? defaultUrl;
const columns = Math.max(8, Number.parseInt(process.argv[3] ?? "", 10) || 80);
const rows = Math.max(1, Number.parseInt(process.argv[4] ?? "", 10) || 20);

const cacheDir = join(tmpdir(), "cc98-image-test");
const sourcePath = await cacheImage(url, cacheDir);
const renderPath = await ensurePng(sourcePath, cacheDir);

process.stdout.write(`TERM_PROGRAM=${process.env.TERM_PROGRAM ?? ""}\n`);
process.stdout.write(`source=${sourcePath}\n`);
process.stdout.write(`render=${renderPath}\n`);
process.stdout.write(`size=${columns}x${rows}\n\n`);

const protocol = detectProtocol();
if (!protocol) {
  process.stderr.write("Unsupported terminal for this script. Expected ghostty, kitty, wezterm, or iTerm2.\n");
  process.exit(1);
}

if (protocol === "kitty") {
  const data = await readFile(renderPath);
  process.stdout.write(kittySequence(data, rows));
  process.stdout.write("\n");
} else {
  const data = await readFile(renderPath);
  process.stdout.write(iterm2Sequence(data, rows));
  process.stdout.write("\n");
}

function detectProtocol() {
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  if (process.env.KITTY_WINDOW_ID || termProgram === "ghostty" || termProgram === "wezterm") {
    return "kitty";
  }
  if (termProgram.includes("iterm")) {
    return "iterm2";
  }
  return undefined;
}

async function cacheImage(imageUrl, dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const extension = extname(new URL(imageUrl).pathname) || ".img";
  const path = join(dir, `${createHash("sha256").update(imageUrl).digest("hex")}${extension}`);
  try {
    await readFile(path);
    return path;
  } catch {
    const response = await fetch(imageUrl, { headers: { "User-Agent": "cc98-cli-image-test" } });
    if (!response.ok) {
      throw new Error(`image request failed: ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    await writeFile(path, data, { mode: 0o600 });
    return path;
  }
}

async function ensurePng(path, dir) {
  if (extname(path).toLowerCase() === ".png") {
    return path;
  }
  const pngPath = join(dir, `${createHash("sha256").update(path).digest("hex")}.png`);
  try {
    await readFile(pngPath);
    return pngPath;
  } catch {
    await execFileAsync("/opt/homebrew/bin/magick", [path, "-auto-orient", pngPath]);
    return pngPath;
  }
}

function kittySequence(data, rowsCount) {
  const payload = data.toString("base64");
  return `\x1b_Gf=100,a=T,t=d,r=${rowsCount};${payload}\x1b\\`;
}

function iterm2Sequence(data, rowsCount) {
  const payload = data.toString("base64");
  return `\x1b]1337;File=inline=1;height=${rowsCount};preserveAspectRatio=1:${payload}\x07`;
}
