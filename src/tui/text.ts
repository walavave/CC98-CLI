import { stripAnsi } from "./ansi.js";

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : undefined;

export function blank(count: number, width: number): string[] {
  return Array.from({ length: Math.max(0, count) }, () => " ".repeat(Math.max(0, width)));
}

export function fit(value: string, width: number): string {
  const safeWidth = Math.max(0, width);
  const truncated = truncate(value, safeWidth);
  return `${truncated}${" ".repeat(Math.max(0, safeWidth - cellWidth(truncated)))}`;
}

export function truncate(value: string, width: number): string {
  const safeWidth = Math.max(0, width);
  let out = "";
  let used = 0;
  let inEscape = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\x1b") {
      inEscape = true;
      out += char;
      continue;
    }

    if (inEscape) {
      out += char;
      if (/[A-Za-z]/.test(char)) {
        inEscape = false;
      }
      continue;
    }

    const plainStart = index;
    const cluster = nextCluster(value, index);
    const clusterWidth = cellWidth(cluster);
    if (used + clusterWidth > safeWidth) {
      break;
    }
    out += cluster;
    used += clusterWidth;
    index = plainStart + cluster.length - 1;
  }

  return out;
}

export function wrapText(text: string, maxWidth: number): string[] {
  const width = Math.max(1, maxWidth);
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const cluster of graphemes(text)) {
    const clusterWidth = cellWidth(cluster);
    if (currentWidth + clusterWidth > width) {
      lines.push(current);
      current = cluster;
      currentWidth = clusterWidth;
    } else {
      current += cluster;
      currentWidth += clusterWidth;
    }
  }
  if (current) {
    lines.push(current);
  }

  return lines;
}

export function cellWidth(value: string): number {
  let width = 0;
  for (const cluster of graphemes(stripAnsi(value))) {
    width += clusterCellWidth(cluster);
  }
  return width;
}

export function sliceCells(value: string, start: number, width: number): string {
  const plain = stripAnsi(value);
  const targetStart = Math.max(0, start);
  const targetWidth = Math.max(0, width);
  let result = "";
  let used = 0;
  let resultWidth = 0;

  for (const cluster of graphemes(plain)) {
    const clusterWidth = clusterCellWidth(cluster);
    if (used + clusterWidth <= targetStart) {
      used += clusterWidth;
      continue;
    }
    if (resultWidth + clusterWidth > targetWidth) {
      break;
    }
    result += cluster;
    resultWidth += clusterWidth;
    used += clusterWidth;
  }

  return result;
}

export function graphemes(value: string): string[] {
  if (!value) {
    return [];
  }
  if (segmenter) {
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

export function clusterCellWidth(value: string): number {
  if (!value) {
    return 0;
  }
  if (isZeroWidthCluster(value)) {
    return 0;
  }
  if (isEmojiCluster(value)) {
    return 2;
  }
  let width = 0;
  for (const char of Array.from(value)) {
    width += charCellWidth(char);
  }
  return Math.max(1, width);
}

function nextCluster(value: string, index: number): string {
  const rest = value.slice(index);
  return graphemes(rest)[0] ?? value[index] ?? "";
}

function isZeroWidthCluster(value: string): boolean {
  return /^[\u200d\ufe0e\ufe0f\p{Mark}]+$/u.test(value);
}

function isEmojiCluster(value: string): boolean {
  for (const char of Array.from(value)) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x1f000 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x2300 && code <= 0x23ff)
    ) {
      return true;
    }
  }
  return /\p{Extended_Pictographic}/u.test(value) || /\p{Emoji_Presentation}/u.test(value);
}

export function charCellWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0) {
    return 0;
  }
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
