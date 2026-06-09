import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { emotionPreviewRows } from "./emotion-preview.js";
import { internalLinkEndMarker, internalLinkStartPrefix, renderLink, replacePlainLinks, shortUrl } from "../link.js";
import { theme } from "../render-core/theme.js";

export interface RenderedPost {
  lines: string[];
  images: string[];
  links: string[];
}

interface RenderOptions {
  imagePreviewRows?: number;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const forumImageRoot = join(moduleDir, "..", "..", "..", "assets", "forum-images");
const mediaBlockStart = "@@CC98_MEDIA_START@@";
const mediaBlockEnd = "@@CC98_MEDIA_END@@";
const legacyMediaBlockTag = /@@CC98MEDIA(?:START|SART|END)@@/gi;

export function renderUbbToLines(content: string, width: number, options: RenderOptions = {}): RenderedPost {
  const images: string[] = [];
  const links: string[] = [];
  let text = normalizeMediaBlocks(content.replace(/\r\n/g, "\n"));

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
    return renderLink(cleanUrl, undefined, links);
  });

  text = text.replace(/<img\b[^>]*\bsrc=(["']?)([^"'\s>]+)\1[^>]*>/gi, (_match, _quote: string, url: string) => {
    const cleanUrl = normalizeImageUrl(url);
    images.push(cleanUrl);
    const index = images.length;
    return imageBlock(index, cleanUrl, options.imagePreviewRows);
  });

  text = text.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url: string, label: string) => {
    return renderLink(url.trim(), stripUbb(label), links);
  });

  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_match, url: string) => {
    return renderLink(url.trim(), undefined, links);
  });

  text = renderNestedUbbQuotes(text);

  text = text.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_match, code: string) => {
    return `\n${code.split("\n").map((line) => `    ${line}`).join("\n")}\n`;
  });

  text = normalizeMediaBlocks(text);
  text = replaceInlineEmotionTags(text, images, options.imagePreviewRows);
  text = normalizeMediaBlocks(text);
  text = stripUbb(text);
  text = decodeHtml(text);
  text = replacePlainLinks(text, links);

  return {
    lines: wrapLines(text, width),
    images,
    links
  };
}

export function renderMarkdownToLines(content: string, width: number, options: RenderOptions = {}): RenderedPost {
  const images: string[] = [];
  const links: string[] = [];
  let text = normalizeMediaBlocks(content.replace(/\r\n/g, "\n"));

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
    return renderLink(normalizeMarkdownTarget(target), label, links);
  });

  text = compactMarkdownQuoteMediaBlocks(text)
    .replace(/^\s{0,3}>\s?(.*)$/gm, (_match, quoted: string) => `${theme.quote.prefix}${quoted}`);
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
  text = replacePlainLinks(text, links);

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

function renderNestedUbbQuotes(value: string): string {
  const segments = parseQuoteSegments(value);
  return segments.map((segment) => segment.kind === "text" ? segment.value : renderQuoteSegment(segment.value)).join("");
}

function renderQuoteSegment(value: string): string {
  const blocks = flattenQuoteBlocks(value);
  const lines = blocks.flatMap((block, index) => {
    const rendered = compactQuotedMediaLines(stripUbb(renderNestedUbbQuotes(block)));
    if (rendered.length === 0) {
      return [];
    }
    return index === 0 ? rendered : ["", ...rendered];
  });
  if (lines.length === 0) {
    return "\n";
  }
  return `\n${lines.map((line) => `${theme.quote.prefix}${line}`).join("\n")}\n`;
}

function flattenQuoteBlocks(value: string): string[] {
  const segments = parseQuoteSegments(value);
  const blocks: string[] = [];
  let textBuffer = "";

  for (const segment of segments) {
    if (segment.kind === "text") {
      textBuffer += segment.value;
      continue;
    }
    blocks.push(...flattenQuoteBlocks(segment.value));
  }

  if (textBuffer.trim()) {
    blocks.push(textBuffer);
  }

  return blocks;
}

function parseQuoteSegments(value: string): Array<{ kind: "text" | "quote"; value: string }> {
  const segments: Array<{ kind: "text" | "quote"; value: string }> = [];
  const quoteTag = /\[(\/)?(quote|quotex)\]/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = quoteTag.exec(value)) !== null) {
    const [tag] = match;
    const isClosing = match[1] === "/";
    if (isClosing) {
      continue;
    }

    const start = match.index;
    const end = findMatchingQuoteEnd(value, quoteTag.lastIndex);
    if (!end) {
      continue;
    }

    if (start > cursor) {
      segments.push({ kind: "text", value: value.slice(cursor, start) });
    }
    segments.push({ kind: "quote", value: value.slice(quoteTag.lastIndex, end.start) });
    cursor = end.end;
    quoteTag.lastIndex = end.end;
  }

  if (cursor < value.length) {
    segments.push({ kind: "text", value: value.slice(cursor) });
  }

  return segments;
}

function findMatchingQuoteEnd(value: string, from: number): { start: number; end: number } | undefined {
  const quoteTag = /\[(\/)?(quote|quotex)\]/gi;
  quoteTag.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = quoteTag.exec(value)) !== null) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) {
        return { start: match.index, end: quoteTag.lastIndex };
      }
      continue;
    }
    depth += 1;
  }

  return undefined;
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
    return join(forumImageRoot, "ac-dark", `${id}.png`);
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
    .replace(/&nbsp;/g, " ")
    .replace(/&ensp;/g, "  ")
    .replace(/&emsp;/g, " ")
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
    .replace(legacyMediaBlockTag, "")
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

    const quotePrefix = paragraph.startsWith(theme.quote.prefix) ? theme.quote.prefix : "";
    const content = quotePrefix ? paragraph.slice(quotePrefix.length) : paragraph;
    const contentWidthLimit = Math.max(1, maxWidth - textWidth(quotePrefix));
    let current = "";
    let currentWidth = 0;
    let activeLinkIndex: number | undefined;
    let currentLineLinkIndex: number | undefined;
    for (const token of splitRenderableTokens(content)) {
      const linkStart = parseInternalLinkStart(token);
      if (linkStart !== undefined) {
        activeLinkIndex = linkStart;
        currentLineLinkIndex ??= linkStart;
        continue;
      }
      if (token === internalLinkEndMarker) {
        activeLinkIndex = undefined;
        continue;
      }
      const tokenWidth = textWidth(token);
      if (tokenWidth > contentWidthLimit) {
        for (const char of token) {
          const nextWidth = charWidth(char);
          if (currentWidth + nextWidth > contentWidthLimit) {
            lines.push(formatWrappedLine(quotePrefix, current, currentLineLinkIndex));
            current = char;
            currentWidth = nextWidth;
            currentLineLinkIndex = activeLinkIndex;
          } else {
            current += char;
            currentWidth += nextWidth;
            currentLineLinkIndex ??= activeLinkIndex;
          }
        }
        continue;
      }
      if (currentWidth > 0 && currentWidth + tokenWidth > contentWidthLimit) {
        lines.push(formatWrappedLine(quotePrefix, current, currentLineLinkIndex));
        current = token;
        currentWidth = tokenWidth;
        currentLineLinkIndex = activeLinkIndex;
        continue;
      }
      current += token;
      currentWidth += tokenWidth;
      currentLineLinkIndex ??= activeLinkIndex;
    }
    lines.push(formatWrappedLine(quotePrefix, current, currentLineLinkIndex));
  }

  return lines;
}

function splitRenderableTokens(value: string): string[] {
  const parts = value.match(new RegExp(
    `${escapeRegExp(internalLinkStartPrefix)}\\d+@@|${escapeRegExp(internalLinkEndMarker)}|https?:\\/\\/[^\\s<>\"）】)\\]]+|.`,
    "gu"
  ));
  return parts ?? [];
}

function parseInternalLinkStart(value: string): number | undefined {
  const match = new RegExp(`^${escapeRegExp(internalLinkStartPrefix)}(\\d+)@@$`).exec(value);
  return match ? Number(match[1]) : undefined;
}

function formatWrappedLine(quotePrefix: string, value: string, linkIndex: number | undefined): string {
  const marker = linkIndex !== undefined ? `[link ${linkIndex}]` : "";
  return `${quotePrefix}${marker}${value}`;
}

function textWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += charWidth(char);
  }
  return width;
}

function compactQuotedMediaLines(value: string): string[] {
  const input = value.split("\n");
  const output: string[] = [];
  let previousBlank = false;

  for (let index = 0; index < input.length; index += 1) {
    const line = input[index] ?? "";
    const isBlank = line.trim() === "";
    if (isBlank && previousBlank) {
      continue;
    }
    output.push(line);
    previousBlank = isBlank;
    if (!line.startsWith("[image ")) {
      continue;
    }
    while (index + 1 < input.length && (input[index + 1] ?? "").trim() === "") {
      index += 1;
    }
    previousBlank = false;
  }

  while (output.length > 0 && output[output.length - 1]?.trim() === "") {
    output.pop();
  }

  return output;
}

function compactMarkdownQuoteMediaBlocks(value: string): string {
  const lines = value.split("\n");
  const output: string[] = [];
  let previousBlankQuote = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const isBlankQuote = /^\s{0,3}>\s?$/.test(line);
    if (isBlankQuote && previousBlankQuote) {
      continue;
    }
    output.push(line);
    previousBlankQuote = isBlankQuote;
    if (!/^\s{0,3}>\s?\[image \d+\]/.test(line)) {
      continue;
    }
    while (index + 1 < lines.length && /^\s{0,3}>\s?$/.test(lines[index + 1] ?? "")) {
      index += 1;
    }
    previousBlankQuote = false;
  }

  while (output.length > 0 && /^\s{0,3}>\s?$/.test(output[output.length - 1] ?? "")) {
    output.pop();
  }

  return output.join("\n");
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
