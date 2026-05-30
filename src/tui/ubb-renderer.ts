import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { emotionPreviewRows } from "./emotion-preview.js";
import { theme } from "./theme.js";

export interface RenderedPost {
  lines: string[];
  images: string[];
  links: string[];
}

interface RenderOptions {
  imagePreviewRows?: number;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const forumImageRoot = join(moduleDir, "..", "..", "assets", "forum-images");
const mediaBlockStart = "@@CC98_MEDIA_START@@";
const mediaBlockEnd = "@@CC98_MEDIA_END@@";

export function renderUbbToLines(content: string, width: number, options: RenderOptions = {}): RenderedPost {
  const images: string[] = [];
  const links: string[] = [];
  let text = content.replace(/\r\n/g, "\n");

  text = text.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_match, url: string) => {
    const cleanUrl = normalizeImageUrl(url);
    images.push(cleanUrl);
    const index = images.length;
    return imageBlock(index, cleanUrl, options.imagePreviewRows);
  });

  text = text.replace(/\[upload(?:=[^\]]*)?\]([\s\S]*?)\[\/upload\]/gi, (_match, url: string) => {
    const cleanUrl = normalizeImageUrl(url);
    if (isPreviewableImageUrl(cleanUrl)) {
      images.push(cleanUrl);
      const index = images.length;
      return imageBlock(index, cleanUrl, options.imagePreviewRows);
    }
    links.push(cleanUrl);
    return `[link ${links.length}: ${shortUrl(cleanUrl)}]`;
  });

  text = text.replace(/<img\b[^>]*\bsrc=(["']?)([^"'\s>]+)\1[^>]*>/gi, (_match, _quote: string, url: string) => {
    const cleanUrl = normalizeImageUrl(url);
    images.push(cleanUrl);
    const index = images.length;
    return imageBlock(index, cleanUrl, options.imagePreviewRows);
  });

  text = text.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url: string, label: string) => {
    const cleanUrl = url.trim();
    links.push(cleanUrl);
    return `${stripUbb(label)} [link ${links.length}: ${shortUrl(cleanUrl)}]`;
  });

  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_match, url: string) => {
    const cleanUrl = url.trim();
    links.push(cleanUrl);
    return `[link ${links.length}: ${shortUrl(cleanUrl)}]`;
  });

  text = text.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, (_match, quoted: string) => {
    return `\n${stripUbb(quoted).split("\n").map((line) => `${theme.quote.prefix}${line}`).join("\n")}\n`;
  });

  text = text.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_match, code: string) => {
    return `\n${code.split("\n").map((line) => `    ${line}`).join("\n")}\n`;
  });

  text = normalizeMediaBlocks(text);
  text = replaceInlineEmotionTags(text, images, options.imagePreviewRows);
  text = normalizeMediaBlocks(text);
  text = stripUbb(text);
  text = decodeHtml(text);

  return {
    lines: wrapLines(text, width),
    images,
    links
  };
}

export function renderMarkdownToLines(content: string, width: number, options: RenderOptions = {}): RenderedPost {
  const images: string[] = [];
  const links: string[] = [];
  let text = content.replace(/\r\n/g, "\n");

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g, (_match, _alt: string, target: string) => {
    const cleanUrl = normalizeMarkdownTarget(target);
    images.push(cleanUrl);
    const index = images.length;
    return imageBlock(index, cleanUrl, options.imagePreviewRows);
  });

  text = text.replace(/<img\b[^>]*\bsrc=(["']?)([^"'\s>]+)\1[^>]*>/gi, (_match, _quote: string, url: string) => {
    const cleanUrl = normalizeImageUrl(url);
    images.push(cleanUrl);
    const index = images.length;
    return imageBlock(index, cleanUrl, options.imagePreviewRows);
  });

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g, (_match, label: string, target: string) => {
    const cleanUrl = normalizeMarkdownTarget(target);
    links.push(cleanUrl);
    return `${label} [link ${links.length}: ${shortUrl(cleanUrl)}]`;
  });

  text = text.replace(/^\s{0,3}>\s?(.*)$/gm, (_match, quoted: string) => `${theme.quote.prefix}${quoted}`);
  text = text.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    const normalized = code.replace(/^\w+\n/, "");
    return `\n${normalized.split("\n").map((line) => `    ${line}`).join("\n")}\n`;
  });
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^\s{0,3}(#{1,6})\s+(.*)$/gm, (_match, _hashes: string, heading: string) => `\n${heading}\n`);
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(^|[^\*])\*([^\*]+)\*(?!\*)/g, "$1$2");
  text = text.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1$2");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/^\s*[-*+]\s+/gm, "• ");
  text = text.replace(/^\s*\d+\.\s+/gm, (match) => match.replace(/^\s*/, ""));
  text = normalizeMediaBlocks(text);
  text = decodeHtml(text);

  return {
    lines: wrapLines(text, width),
    images,
    links
  };
}

function stripUbb(value: string): string {
  return value
    .replace(/\[(?:\/)?(?:b|i|u|size|color|align|email|del|s|sub|sup|h\d?)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[[a-z0-9]+(?:=[^\]]*)?\]/gi, "")
    .replace(/\[\/[a-z0-9]+\]/gi, "");
}

function replaceInlineEmotionTags(value: string, images: string[], previewRows = 0): string {
  return value
    .replace(/\[(ac(?:\d{2}|\d{4})|cc98\d{2}|em\d{2}|tb\d{2}|ms\d{2,3}|[acf]:\d{3})\](?:\[\/\1\])?/gi, (_match, tag: string) => {
      const imagePath = resolveEmotionImagePath(String(tag).toLowerCase());
      if (!imagePath) {
        return `:${String(tag).toLowerCase()}:`;
      }
      images.push(imagePath);
      return emotionBlock(images.length, imagePath, previewRows || emotionPreviewRows);
    });
}

function resolveEmotionImagePath(tag: string): string | undefined {
  if (/^ac(\d{2}|\d{4})$/i.test(tag)) {
    const id = tag.slice(2);
    return join(forumImageRoot, "ac", `${id}.png`);
  }
  if (/^cc98\d{2}$/i.test(tag)) {
    const id = tag.slice(4);
    const number = Number(id);
    const extension = number > 14 && number < 31 || number > 35 ? "png" : "gif";
    return join(forumImageRoot, "CC98", `CC98${id}.${extension}`);
  }
  if (/^em\d{2}$/i.test(tag)) {
    return join(forumImageRoot, "em", `${tag.toLowerCase()}.gif`);
  }
  if (/^tb\d{2}$/i.test(tag)) {
    return join(forumImageRoot, "tb", `${tag.toLowerCase()}.png`);
  }
  if (/^ms\d{2,3}$/i.test(tag)) {
    const digits = tag.slice(2).padStart(2, "0");
    return join(forumImageRoot, "ms", `ms${digits}.png`);
  }
  const mahjong = /^([acf]):(\d{3})$/i.exec(tag);
  if (!mahjong) {
    return undefined;
  }
  const type = mahjong[1]?.toLowerCase();
  const id = mahjong[2] ?? "";
  switch (type) {
    case "a":
      return join(forumImageRoot, "mahjong", "animal2017", `${id}.png`);
    case "c":
      return join(forumImageRoot, "mahjong", "carton2017", mahjongGifIds.has(id) ? `${id}.gif` : `${id}.png`);
    case "f":
      return join(forumImageRoot, "mahjong", "face2017", mahjongFaceGifIds.has(id) ? `${id}.gif` : `${id}.png`);
    default:
      return undefined;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeImageUrl(value: string): string {
  const decoded = decodeHtml(value).trim();
  if (!decoded) {
    return decoded;
  }
  if (/^https?:\/\//i.test(decoded)) {
    return decoded;
  }
  if (decoded.startsWith("//")) {
    return `https:${decoded}`;
  }
  if (decoded.startsWith("/")) {
    return `https://file.cc98.org${decoded}`;
  }
  return decoded;
}

function normalizeMarkdownTarget(value: string): string {
  const match = value.trim().match(/^(\S+)(?:\s+".*")?$/);
  return normalizeImageUrl(match?.[1] ?? value);
}

function imageBlock(index: number, url: string, previewRows = 0): string {
  const reservedRows = Math.max(0, Math.floor(previewRows));
  const padding = "\n".repeat(Math.max(0, reservedRows - 1));
  return `${mediaBlockStart}[image ${index}] ${shortUrl(url)}${padding}${mediaBlockEnd}`;
}

function emotionBlock(index: number, url: string, previewRows = emotionPreviewRows): string {
  return imageBlock(index, url, previewRows);
}

function normalizeMediaBlocks(value: string): string {
  return value
    .replace(new RegExp(`([^\\n])${escapeRegExp(mediaBlockStart)}`, "g"), `$1\n${mediaBlockStart}`)
    .replace(new RegExp(`${escapeRegExp(mediaBlockEnd)}([^\\n])`, "g"), `${mediaBlockEnd}\n$1`)
    .replace(new RegExp(mediaBlockStart, "g"), "")
    .replace(new RegExp(mediaBlockEnd, "g"), "");
}

function wrapLines(value: string, width: number): string[] {
  const maxWidth = Math.max(20, width);
  const lines: string[] = [];

  for (const paragraph of value.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    let current = "";
    let currentWidth = 0;
    for (const char of paragraph) {
      const nextWidth = charWidth(char);
      if (currentWidth + nextWidth > maxWidth) {
        lines.push(current);
        current = char;
        currentWidth = nextWidth;
      } else {
        current += char;
        currentWidth += nextWidth;
      }
    }
    lines.push(current);
  }

  return lines;
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const fileName = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return `${url.host}/${fileName}`;
  } catch {
    return value.split(/[\\/]/).at(-1) ?? value;
  }
}

function isPreviewableImageUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(pathname);
  } catch {
    return /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(value);
  }
}

const mahjongGifIds = new Set(["018", "049", "096"]);
const mahjongFaceGifIds = new Set(["004", "009", "056", "061", "062", "087", "115", "120", "137", "168", "169", "175", "206"]);

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6))
  ) {
    return 2;
  }
  return 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
