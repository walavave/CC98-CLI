import { ansi } from "./render-core/ansi.js";

import { stripAnsi } from "./render-core/ansi.js";

export const internalLinkStartPrefix = "@@CC98_LINK_START:";
export const internalLinkEndMarker = "@@CC98_LINK_END@@";

export function extractFirstHttpUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const plain = stripAnsi(value);
  const match = plain.match(/(?:https?:\/\/|\/topic\/)[^\s<>"）】)\]]+/i);
  return trimTrailingLinkPunctuation(match?.[0]);
}

export function trimTrailingLinkPunctuation(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let next = value;
  while (next && /[.,!?;:'"】）)\]]$/.test(next)) {
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
  if (!isDownloadLikeUrl(cleanUrl)) {
    links.push(cleanUrl);
    const index = links.length;
    const rendered = !cleanLabel || cleanLabel === cleanUrl
      ? cleanUrl
      : `${cleanLabel} ${cleanUrl}`;
    return wrapInteractiveLink(index, underline(rendered));
  }
  links.push(cleanUrl);
  const download = underline("[点击下载]");
  const displayLabel = cleanLabel || fileLabel(cleanUrl);
  return `${displayLabel} ${download}`.trim();
}

export function replacePlainLinks(value: string, links: string[]): string {
  return value.replace(/(^|[\s(（<])((?:https?:\/\/)[^\s<>"\])）]+)/gi, (match, prefix: string, rawUrl: string) => {
    const url = trimTrailingLinkPunctuation(rawUrl);
    if (!url) {
      return match;
    }
    const cleanUrl = normalizeLinkUrl(url);
    if (!isDownloadLikeUrl(cleanUrl)) {
      links.push(cleanUrl);
      return `${prefix}${wrapInteractiveLink(links.length, underline(cleanUrl))}`;
    }
    links.push(cleanUrl);
    return `${prefix}${fileLabel(cleanUrl)} ${underline("[点击下载]")}`;
  });
}

function underline(value: string): string {
  return `${ansi.underline}${value}${ansi.underlineOff}`;
}

function wrapInteractiveLink(index: number, value: string): string {
  return `${internalLinkStartPrefix}${index}@@${value}${internalLinkEndMarker}`;
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
