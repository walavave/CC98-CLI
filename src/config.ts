import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformConfigDir } from "./platform/config-dir.js";

export interface AppConfig {
  account: AccountConfig;
  tui: TuiConfig;
}

export interface AccountConfig {
  autoSignin: boolean;
}

export interface TuiConfig {
  hideTopChrome: boolean;
  previewImages: boolean;
  navigationHistoryLimit: number;
  clearCacheOnExit: boolean;
  postSignature: string;
  topicScrollAtViewportEdge: boolean;
  blacklist: string[];
  hiddenPatterns: string[];
}

const defaultConfig: AppConfig = {
  account: {
    autoSignin: true
  },
  tui: {
    hideTopChrome: false,
    previewImages: true,
    navigationHistoryLimit: 10,
    clearCacheOnExit: true,
    postSignature: "[right][color=#808080]——来自终端应用[/color]「[b][url=https://github.com/walavave/CC98-CLI]CC98 CLI[/url][/b]」[/right]",
    topicScrollAtViewportEdge: false,
    blacklist: []
    , hiddenPatterns: []
  }
};

export function loadConfig(): AppConfig {
  const path = getConfigFilePath();
  if (!existsSync(path)) {
    return defaultConfig;
  }

  try {
    return mergeConfig(defaultConfig, parseTomlSubset(readFileSync(path, "utf8")));
  } catch {
    return defaultConfig;
  }
}

export function getConfigFilePath(): string {
  return join(getPlatformConfigDir(), "config.toml");
}

function mergeConfig(base: AppConfig, parsed: Record<string, Record<string, unknown>>): AppConfig {
  const account = parsed.account ?? {};
  const tui = parsed.tui ?? {};
  return {
    account: {
      autoSignin: booleanValue(account.auto_signin, base.account.autoSignin)
    },
    tui: {
      hideTopChrome: booleanValue(tui.hide_top_chrome, base.tui.hideTopChrome),
      previewImages: booleanValue(tui.preview_images, base.tui.previewImages),
      navigationHistoryLimit: positiveIntegerValue(tui.navigation_history_limit, base.tui.navigationHistoryLimit),
      clearCacheOnExit: booleanValue(tui.clear_cache_on_exit, base.tui.clearCacheOnExit),
      postSignature: stringValue(tui.post_signature, base.tui.postSignature),
      topicScrollAtViewportEdge: booleanValue(tui.topic_scroll_at_viewport_edge, base.tui.topicScrollAtViewportEdge),
      blacklist: stringArrayValue(tui.blacklist, base.tui.blacklist)
      , hiddenPatterns: stringArrayValue(tui.hidden_patterns, base.tui.hiddenPatterns)
    }
  };
}

export function saveBlacklist(blacklist: string[]): void {
  saveTuiArray("blacklist", blacklist);
}

export function saveHiddenPatterns(patterns: string[]): void {
  saveTuiArray("hidden_patterns", patterns);
}

function saveTuiArray(key: string, values: string[]): void {
  const path = getConfigFilePath();
  mkdirSync(getPlatformConfigDir(), { recursive: true });
  const input = existsSync(path) ? readFileSync(path, "utf8") : "";
  const value = `[${values.map((name) => JSON.stringify(name)).join(", ")}]`;
  const lines = input.split(/\r?\n/);
  let tuiStart = -1;
  let tuiEnd = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*\[tui\]\s*(?:#.*)?$/.test(lines[index] ?? "")) {
      tuiStart = index;
      continue;
    }
    if (tuiStart >= 0 && /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[index] ?? "")) {
      tuiEnd = index;
      break;
    }
  }

  if (tuiStart < 0) {
    const prefix = input.trimEnd();
    writeFileSync(path, `${prefix}${prefix ? "\n\n" : ""}[tui]\n${key} = ${value}\n`, "utf8");
    return;
  }

  const keyIndex = lines.findIndex((line, index) =>
    index > tuiStart && index < tuiEnd && new RegExp(`^\\s*${key}\\s*=`).test(line)
  );
  if (keyIndex >= 0) {
    lines[keyIndex] = `${key} = ${value}`;
  } else {
    lines.splice(tuiEnd, 0, `${key} = ${value}`);
  }
  writeFileSync(path, `${lines.join("\n").replace(/\n*$/, "")}\n`, "utf8");
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringArrayValue(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...new Set(value.map((item) => item.trim()).filter(Boolean))]
    : fallback;
}

function positiveIntegerValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseTomlSubset(input: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  let section = "";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1] ?? "";
      result[section] ??= {};
      continue;
    }
    const keyMatch = /^([A-Za-z0-9_-]+)\s*=\s*(true|false|\d+|"(?:[^"\\]|\\.)*"|\[(?:\s*(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*,?)*\])$/i.exec(line);
    if (!keyMatch || !section) {
      continue;
    }
    result[section] ??= {};
    const rawValue = keyMatch[2] ?? "";
    result[section][keyMatch[1] ?? ""] = rawValue.startsWith("[")
      ? parseTomlStringArray(rawValue)
      : rawValue.startsWith("\"")
      ? parseTomlString(rawValue)
      : /^\d+$/.test(rawValue)
        ? Number(rawValue)
        : rawValue.toLowerCase() === "true";
  }

  return result;
}

function parseTomlStringArray(value: string): string[] {
  const items: string[] = [];
  const pattern = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
  for (const match of value.matchAll(pattern)) {
    items.push(match[0].startsWith("'") ? match[0].slice(1, -1) : parseTomlString(match[0]));
  }
  return items;
}

function parseTomlString(value: string): string {
  return value.slice(1, -1)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function stripComment(line: string): string {
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && (!quote || quote === char) && (char === "'" || line[index - 1] !== "\\")) {
      quote = quote ? undefined : char;
    } else if (char === "#" && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}
