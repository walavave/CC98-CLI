import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  postSignature: string;
}

const defaultConfig: AppConfig = {
  account: {
    autoSignin: true
  },
  tui: {
    hideTopChrome: false,
    previewImages: true,
    navigationHistoryLimit: 10,
    postSignature: "[right][color=#808080]——来自终端应用[/color]「[b][url=https://github.com/walavave/CC98-CLI]CC98 CLI[/url][/b]」[/right]"
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
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfigHome, "cc98-cli", "config.toml");
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
      postSignature: stringValue(tui.post_signature, base.tui.postSignature)
    }
  };
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
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
    const keyMatch = /^([A-Za-z0-9_-]+)\s*=\s*(true|false|\d+|"(?:[^"\\]|\\.)*")$/i.exec(line);
    if (!keyMatch || !section) {
      continue;
    }
    result[section] ??= {};
    const rawValue = keyMatch[2] ?? "";
    result[section][keyMatch[1] ?? ""] = rawValue.startsWith("\"")
      ? parseTomlString(rawValue)
      : /^\d+$/.test(rawValue)
        ? Number(rawValue)
        : rawValue.toLowerCase() === "true";
  }

  return result;
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
  let inQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index - 1] !== "\\") {
      inQuote = !inQuote;
    } else if (char === "#" && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}
