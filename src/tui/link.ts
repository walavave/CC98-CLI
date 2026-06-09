import { ansi, stripAnsi } from "./render-core/ansi.js";
import { clusterCellWidth, graphemes } from "./render-core/text.js";

export const internalLinkStartPrefix = "@@CC98_LINK_START:";
export const internalLinkEndMarker = "@@CC98_LINK_END@@";

const plainHttpUrlPattern = /(?:https?:\/\/|\/topic\/)[^\s<>"）】)\]]+/i;
const trailingLinkPunctuationPattern = /[.,!?;:'"】）)\]]$/;
const plainLinkMatchPattern = /(?:^|[\s(（<])(https?:\/\/[^\s<>"）】)\]]+)/gi;
const ansiSequencePattern = /^\x1b\[[0-9;?]*[A-Za-z]/;
const internalLinkStartPattern = new RegExp(`^${escapeRegExp(internalLinkStartPrefix)}(\\d+)@@`);
const internalLinkMarkupPattern = new RegExp(
  `${escapeRegExp(internalLinkStartPrefix)}\\d+@@|${escapeRegExp(internalLinkEndMarker)}`,
  "g"
);

export interface InlineLinkSpan {
  index: number;
  start: number;
  end: number;
}

export function extractFirstHttpUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const plain = stripAnsi(value);
  const match = plain.match(plainHttpUrlPattern);
  return trimTrailingLinkPunctuation(match?.[0]);
}

export function trimTrailingLinkPunctuation(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let next = value;
  while (next && trailingLinkPunctuationPattern.test(next)) {
    next = next.slice(0, -1);
  }
  return next || undefined;
}

export function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const fileName = url.pathname.split("/").filter(Boolean).at(-1) ?? url.host;
    return `${url.host}/${fileName}`;
  } catch {
    return value.split(/[\\/]/).at(-1) ?? value;
  }
}

export function isDownloadLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const fileName = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const extension = fileName.includes(".") ? fileName.split(".").at(-1)?.toLowerCase() ?? "" : "";
    return downloadLikeExtensions.has(extension);
  } catch {
    return false;
  }
}

export function normalizeLinkUrl(value: string): string {
  return value.trim();
}

export interface Cc98TopicLinkTarget {
  topicId: number;
  floor?: number;
}

export function parseCc98TopicId(value: string): number | undefined {
  return parseCc98TopicLink(value)?.topicId;
}

export function parseCc98TopicLink(value: string): Cc98TopicLinkTarget | undefined {
  try {
    const url = value.startsWith("/")
      ? new URL(value, "https://www.cc98.org")
      : new URL(value);
    if (!isCc98Host(url.hostname)) {
      return undefined;
    }
    const match = url.pathname.match(/^\/topic\/(\d+)(?:\/(\d+))?(?:\/|$)/i);
    if (!match) {
      return undefined;
    }
    const topicId = Number(match[1]);
    if (!Number.isFinite(topicId) || topicId <= 0) {
      return undefined;
    }

    const page = match[2] ? Number(match[2]) : undefined;
    const hash = url.hash.replace(/^#/, "");
    const hashFloor = hash ? Number(hash) : undefined;
    const floor = resolveTopicFloor(page, hashFloor);
    return floor !== undefined ? { topicId, floor } : { topicId };
  } catch {
    return undefined;
  }
}

export function renderLink(url: string, label: string | undefined, links: string[]): string {
  const cleanUrl = normalizeLinkUrl(url);
  const cleanLabel = label?.trim();
  links.push(cleanUrl);
  const index = links.length;
  if (!isDownloadLikeUrl(cleanUrl)) {
    return wrapInteractiveLink(index, underline(cleanLabel || cleanUrl));
  }
  const displayLabel = cleanLabel || fileLabel(cleanUrl);
  return `${displayLabel} ${wrapInteractiveLink(index, underline("[点击下载]"))}`.trim();
}

export function replacePlainLinks(value: string, links: string[]): string {
  let output = "";
  let cursor = 0;

  while (cursor < value.length) {
    const internalStart = value.indexOf(internalLinkStartPrefix, cursor);
    if (internalStart >= 0) {
      const plainMatch = findNextPlainUrl(value, cursor);
      if (!plainMatch || internalStart < plainMatch.matchStart) {
        output += value.slice(cursor, internalStart);
        const internalEnd = value.indexOf(internalLinkEndMarker, internalStart);
        const nextCursor = internalEnd < 0 ? value.length : internalEnd + internalLinkEndMarker.length;
        output += value.slice(internalStart, nextCursor);
        cursor = nextCursor;
        continue;
      }
    }

    const match = findNextPlainUrl(value, cursor);
    if (!match) {
      output += value.slice(cursor);
      break;
    }

    output += value.slice(cursor, match.matchStart);
    output += match.prefix;
    output += renderLink(match.url, undefined, links);
    cursor = match.end;
  }

  return output;
}

export function stripInternalLinkMarkup(value: string): string {
  return value.replace(internalLinkMarkupPattern, "");
}

export function extractInlineLinkSpans(value: string): { text: string; spans: InlineLinkSpan[] } {
  const spans: InlineLinkSpan[] = [];
  let text = "";
  let column = 0;
  let cursor = 0;
  let activeLinkIndex: number | undefined;
  let activeLinkStart = 0;

  while (cursor < value.length) {
    const remainder = value.slice(cursor);
    const linkStart = internalLinkStartPattern.exec(remainder);
    if (linkStart) {
      activeLinkIndex = Number(linkStart[1]);
      activeLinkStart = column;
      cursor += linkStart[0].length;
      continue;
    }
    if (remainder.startsWith(internalLinkEndMarker)) {
      if (activeLinkIndex !== undefined && column > activeLinkStart) {
        spans.push({ index: activeLinkIndex, start: activeLinkStart, end: column });
      }
      activeLinkIndex = undefined;
      cursor += internalLinkEndMarker.length;
      continue;
    }
    const ansiMatch = ansiSequencePattern.exec(remainder);
    if (ansiMatch) {
      text += ansiMatch[0];
      cursor += ansiMatch[0].length;
      continue;
    }

    const next = graphemes(value.slice(cursor))[0] ?? value[cursor] ?? "";
    text += next;
    column += clusterCellWidth(next);
    cursor += next.length;
  }

  return { text, spans };
}

function underline(value: string): string {
  return `${ansi.underline}${value}${ansi.underlineOff}`;
}

function wrapInteractiveLink(index: number, value: string): string {
  return `${internalLinkStartPrefix}${index}@@${value}${internalLinkEndMarker}`;
}

function findNextPlainUrl(
  value: string,
  from: number
): { matchStart: number; end: number; prefix: string; url: string } | undefined {
  plainLinkMatchPattern.lastIndex = from;
  let match: RegExpExecArray | null;

  while ((match = plainLinkMatchPattern.exec(value)) !== null) {
    const rawUrl = trimTrailingLinkPunctuation(match[1]);
    if (!rawUrl) {
      continue;
    }
    const full = match[0] ?? "";
    const prefix = full.slice(0, full.length - match[1].length);
    const matchStart = match.index;
    const start = matchStart + prefix.length;
    return {
      matchStart,
      end: start + match[1].length,
      prefix,
      url: normalizeLinkUrl(rawUrl)
    };
  }

  return undefined;
}

function fileLabel(value: string): string {
  try {
    const url = new URL(value);
    return url.pathname.split("/").filter(Boolean).at(-1) ?? shortUrl(value);
  } catch {
    return shortUrl(value);
  }
}

function isCc98Host(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "www.cc98.org" || normalized === "cc98.org";
}

function resolveTopicFloor(page: number | undefined, hashFloor: number | undefined): number | undefined {
  if (!hashFloor || !Number.isInteger(hashFloor) || hashFloor <= 0) {
    return undefined;
  }
  if (!page || !Number.isInteger(page) || page <= 1) {
    return hashFloor;
  }
  return (page - 1) * 10 + hashFloor;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const downloadLikeExtensions = new Set([
  "pdf",
  "epub",
  "mobi",
  "azw3",
  "djvu",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "tsv",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "tgz",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "heic",
  "heif",
  "mp3",
  "wav",
  "flac",
  "ogg",
  "m4a",
  "mp4",
  "mkv",
  "avi",
  "mov",
  "webm",
  "apk",
  "exe",
  "dmg",
  "pkg",
  "msi",
  "deb",
  "rpm"
]);
