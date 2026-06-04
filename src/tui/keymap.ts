import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TuiAction =
  | "search.focus-input"
  | "compose.open-emotion"
  | "topic.next-reply"
  | "topic.previous-reply"
  | "topic.like-post"
  | "topic.dislike-post"
  | "topic.favorite-topic";

interface KeyBinding {
  on: string[][];
  run: TuiAction;
}

interface MatchState {
  binding: KeyBinding;
  index: number;
}

export interface TuiKeymap {
  feed(key: string): TuiAction | undefined;
}

const defaultBindings: KeyBinding[] = [
  { on: [expandKeyToken("f")], run: "search.focus-input" },
  { on: [expandKeyToken("<C-a>")], run: "compose.open-emotion" },
  { on: [expandKeyToken("a")], run: "topic.like-post" },
  { on: [expandKeyToken("s")], run: "topic.dislike-post" },
  { on: [expandKeyToken("d")], run: "topic.favorite-topic" },
  { on: [expandKeyToken("<A-Down>")], run: "topic.next-reply" },
  { on: [expandKeyToken("<A-Up>")], run: "topic.previous-reply" }
];

export function loadTuiKeymap(): TuiKeymap {
  const loadedBindings = loadBindingsFromFile(getKeymapFilePath());
  return createTuiKeymap(loadedBindings.length > 0 ? [...loadedBindings, ...defaultBindings] : defaultBindings);
}

export function getKeymapFilePath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfigHome, "cc98-cli", "keymap.toml");
}

function createTuiKeymap(bindings: KeyBinding[]): TuiKeymap {
  let pending: MatchState[] = [];

  return {
    feed(key: string): TuiAction | undefined {
      const advanced = pending
        .filter((state) => matchesKey(state.binding.on[state.index], key))
        .map((state) => ({ binding: state.binding, index: state.index + 1 }));
      const started = bindings
        .filter((binding) => matchesKey(binding.on[0], key))
        .map((binding) => ({ binding, index: 1 }));
      const nextStates = [...advanced, ...started];
      const completed = nextStates
        .filter((state) => state.index >= state.binding.on.length)
        .sort((left, right) => right.binding.on.length - left.binding.on.length);

      pending = nextStates.filter((state) => state.index < state.binding.on.length);

      if (completed.length > 0) {
        pending = [];
        return completed[0]?.binding.run;
      }

      if (!key.startsWith("\x1b")) {
        pending = pending.filter((state) => state.binding.on.length > 1);
      }

      return undefined;
    }
  };
}

function loadBindingsFromFile(path: string): KeyBinding[] {
  if (!existsSync(path)) {
    return [];
  }

  try {
    const content = readFileSync(path, "utf8");
    return parseKeymap(content);
  } catch {
    return [];
  }
}

function parseKeymap(input: string): KeyBinding[] {
  const section = extractSection(input, "tui");
  if (!section) {
    return [];
  }

  const arrayContent = extractArrayValue(section, "prepend_keymap");
  if (!arrayContent) {
    return [];
  }

  return extractInlineTables(arrayContent)
    .map(parseInlineBinding)
    .filter((binding): binding is KeyBinding => binding !== undefined);
}

function extractSection(input: string, name: string): string | undefined {
  const lines = input.split(/\r?\n/);
  const sectionHeader = `[${name}]`;
  let start = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === sectionHeader) {
      start = index + 1;
      break;
    }
  }

  if (start < 0) {
    return undefined;
  }

  const body: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      break;
    }
    body.push(line);
  }

  return body.join("\n");
}

function extractInlineTables(input: string): string[] {
  const tables: string[] = [];
  let depth = 0;
  let start = -1;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tables.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return tables;
}

function extractArrayValue(input: string, key: string): string | undefined {
  const keyMatch = new RegExp(`${escapeRegExp(key)}\\s*=\\s*\\[`, "m").exec(input);
  if (!keyMatch) {
    return undefined;
  }

  const start = (keyMatch.index ?? 0) + keyMatch[0].length - 1;
  let depth = 0;
  let inQuote = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    const previous = index > 0 ? input[index - 1] : "";
    if (char === "\"" && previous !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start + 1, index);
      }
    }
  }

  return undefined;
}

function parseInlineBinding(table: string): KeyBinding | undefined {
  const onValue = extractField(table, "on");
  const runValue = extractField(table, "run");
  if (!onValue || !runValue) {
    return undefined;
  }

  const run = normalizeRunAction(parseTomlString(runValue));
  if (!run) {
    return undefined;
  }

  const keys = parseOnValue(onValue);
  if (keys.length === 0) {
    return undefined;
  }

  return { on: keys.map(expandKeyToken), run };
}

function extractField(table: string, name: string): string | undefined {
  const match = new RegExp(`${escapeRegExp(name)}\\s*=\\s*(\\[[^\\]]*\\]|"(?:[^"\\\\]|\\\\.)*")`).exec(table);
  return match?.[1];
}

function parseOnValue(value: string): string[] {
  if (value.startsWith("[")) {
    return Array.from(value.matchAll(/"(?:[^"\\]|\\.)*"/g), (match) => parseTomlString(match[0] ?? ""));
  }
  return [parseTomlString(value)];
}

function parseTomlString(value: string): string {
  return value.slice(1, -1)
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function normalizeRunAction(value: string): TuiAction | undefined {
  switch (value) {
    case "search.focus-input":
    case "compose.open-emotion":
    case "topic.next-reply":
    case "topic.previous-reply":
    case "topic.like-post":
    case "topic.dislike-post":
    case "topic.favorite-topic":
      return value;
    default:
      return undefined;
  }
}

function expandKeyToken(token: string): string[] {
  const normalized = token.trim();
  const control = expandControlKeyToken(normalized);
  if (control) {
    return control;
  }
  switch (normalized.toLowerCase()) {
    case "<a-down>":
    case "<m-down>":
    case "<alt-down>":
    case "<option-down>":
      return ["\x1b[1;3B", "\x1b\x1b[B"];
    case "<a-up>":
    case "<m-up>":
    case "<alt-up>":
    case "<option-up>":
      return ["\x1b[1;3A", "\x1b\x1b[A"];
    case "<down>":
      return ["\x1b[B"];
    case "<up>":
      return ["\x1b[A"];
    case "<left>":
      return ["\x1b[D"];
    case "<right>":
      return ["\x1b[C"];
    case "<enter>":
      return ["\r"];
    case "<esc>":
      return ["\x1b"];
    case "<tab>":
      return ["\t"];
    case "<space>":
      return [" "];
    case "<backspace>":
      return ["\x7f"];
    default:
      return [normalized];
  }
}

function expandControlKeyToken(token: string): string[] | undefined {
  const match = /^<c-(.+)>$/i.exec(token);
  if (!match) {
    return undefined;
  }

  const key = (match[1] ?? "").trim().toLowerCase();
  switch (key) {
    case "i":
      return ["\t"];
    case "j":
      return ["\n"];
    case "k":
      return ["\x0b"];
    case "m":
      return ["\r"];
    case "[":
      return ["\x1b"];
    case "\\":
      return ["\x1c"];
    case "]":
      return ["\x1d"];
    case "^":
      return ["\x1e"];
    case "_":
      return ["\x1f"];
    case "space":
      return ["\x00"];
    default:
      if (key.length === 1 && key >= "a" && key <= "z") {
        return [String.fromCharCode(key.charCodeAt(0) - 96)];
      }
      return undefined;
  }
}

function matchesKey(candidates: string[], key: string): boolean {
  return candidates.includes(key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
