export function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizePreview(value: string): string {
  return normalizeInline(value
    .replace(/\[(?:cc98\d{2,4}|ac\d{2,4}|tb\d{2,4}|ms\d{2,4}|em\d{2,4}|[acf]:\d{2,4})\]/gi, " [表情] ")
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, " [图片] ")
    .replace(/\[upload(?:=[^\]]*)?\][\s\S]*?\[\/upload\]/gi, " [附件] ")
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, _url: string, label: string) => ` ${label} `)
    .replace(/\[url\][\s\S]*?\[\/url\]/gi, " [链接] ")
    .replace(/<img\b[^>]*>/gi, " [图片] ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\[(?:\/)?(?:b|i|u|size|color|align|email|del|s|sub|sup|h\d?|quote|code)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[[a-z0-9]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\[\/[a-z0-9]+\]/gi, " "));
}

export function timestampOf(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function formatTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 16);
}

export function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
