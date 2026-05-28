import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  tui: TuiConfig;
}

export interface TuiConfig {
  hideTopChrome: boolean;
  hideRightPanel: boolean;
}

const defaultConfig: AppConfig = {
  tui: {
    hideTopChrome: false,
    hideRightPanel: false
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
  const tui = parsed.tui ?? {};
  return {
    tui: {
      hideTopChrome: booleanValue(tui.hide_top_chrome, base.tui.hideTopChrome),
      hideRightPanel: booleanValue(tui.hide_right_panel, base.tui.hideRightPanel)
    }
  };
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
    const keyMatch = /^([A-Za-z0-9_-]+)\s*=\s*(true|false)$/i.exec(line);
    if (!keyMatch || !section) {
      continue;
    }
    result[section] ??= {};
    result[section][keyMatch[1] ?? ""] = (keyMatch[2] ?? "").toLowerCase() === "true";
  }

  return result;
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
