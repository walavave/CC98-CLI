import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getDownloadsDir } from "../../storage/paths.js";

export async function downloadUrlToDownloads(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("只支持下载 http/https 链接");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "cc98-cli"
    }
  });
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status}`);
  }

  const downloadsDir = getDownloadsDir();
  await mkdir(downloadsDir, { recursive: true, mode: 0o700 });

  const filename = resolveFilename(url, response.headers.get("content-disposition"));
  const targetPath = await uniquePath(join(downloadsDir, filename));
  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, data, { mode: 0o600 });
  return targetPath;
}

function resolveFilename(url: string, contentDisposition: string | null): string {
  const fromHeader = parseContentDispositionFilename(contentDisposition);
  if (fromHeader) {
    return sanitizeFilename(fromHeader);
  }

  try {
    const pathname = new URL(url).pathname;
    const fromPath = basename(pathname);
    if (fromPath) {
      return sanitizeFilename(fromPath);
    }
  } catch {
    // Fall through to default filename.
  }

  return "download.bin";
}

function parseContentDispositionFilename(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const match = /filename=\"?([^\";]+)\"?/i.exec(value);
  return match?.[1];
}

function sanitizeFilename(value: string): string {
  const normalized = value
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized === "." || normalized === "..") {
    return "download.bin";
  }
  return normalized.slice(0, 180);
}

async function uniquePath(path: string): Promise<string> {
  const extension = extname(path);
  const stem = extension ? path.slice(0, -extension.length) : path;

  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? path : `${stem} (${index})${extension}`;
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }

  return `${stem}-${Date.now()}${extension}`;
}
