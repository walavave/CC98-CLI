import { stdin, stdout } from "node:process";
import { ansi, moveTo } from "./ansi.js";
import { getClearVisibleImageSequence, getImagePreviewSequence } from "../media/image-preview.js";

export interface TerminalSize {
  columns: number;
  rows: number;
}

export interface TerminalImageOverlay {
  row: number;
  column: number;
  token: string;
}

export interface TerminalFrame {
  text: string;
  imageOverlays?: TerminalImageOverlay[];
}

export type KeyHandler = (key: string) => void;
export interface MouseEvent {
  kind: "down" | "drag" | "up";
  button: "left" | "middle" | "right" | "wheel-up" | "wheel-down";
  row: number;
  column: number;
}
export type MouseHandler = (event: MouseEvent) => void;
export type ResizeHandler = () => void;

export class Terminal {
  private previousRawMode = false;
  private previousPaused = true;
  private previousHadImageOverlays = false;
  private previousImageOverlaySignature = "";
  private inputBuffer = "";
  private pendingEscapeTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly keyHandlers = new Set<KeyHandler>();
  private readonly mouseHandlers = new Set<MouseHandler>();
  private readonly resizeHandlers = new Set<ResizeHandler>();

  enter(): void {
    this.previousRawMode = stdin.isRaw;
    this.previousPaused = stdin.isPaused();
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write(`${ansi.enterAltScreen}${ansi.clear}${ansi.home}${ansi.hideCursor}${ansi.enableMouse}`);
    stdin.on("data", this.handleData);
    stdout.on("resize", this.handleResize);
  }

  exit(): void {
    stdin.off("data", this.handleData);
    stdout.off("resize", this.handleResize);
    if (this.pendingEscapeTimeout) {
      clearTimeout(this.pendingEscapeTimeout);
      this.pendingEscapeTimeout = undefined;
    }
    stdout.write(`${ansi.disableMouse}${ansi.reset}${ansi.clear}${ansi.home}${ansi.showCursor}${ansi.exitAltScreen}`);
    if (stdin.isTTY) {
      stdin.setRawMode(this.previousRawMode);
    }
    if (this.previousPaused) {
      stdin.pause();
    }
  }

  size(): TerminalSize {
    return {
      columns: stdout.columns || Number(process.env.COLUMNS) || 80,
      rows: stdout.rows || Number(process.env.LINES) || 24
    };
  }

  render(frame: string | TerminalFrame): void {
    const normalized = typeof frame === "string" ? { text: frame, imageOverlays: [] } : frame;
    const imageOverlays = normalized.imageOverlays ?? [];
    const hasImageOverlays = imageOverlays.length > 0;
    const nextImageOverlaySignature = imageOverlays
      .map((overlay) => `${overlay.row}:${overlay.column}:${overlay.token}`)
      .join("|");
    const overlaysChanged = nextImageOverlaySignature !== this.previousImageOverlaySignature;

    if ((this.previousHadImageOverlays || hasImageOverlays) && overlaysChanged) {
      const clearImages = getClearVisibleImageSequence();
      if (clearImages) {
        stdout.write(clearImages);
      }
    }
    stdout.write(`${ansi.home}${normalized.text}`);
    if (overlaysChanged) {
      for (const overlay of imageOverlays) {
        const sequence = getImagePreviewSequence(overlay.token);
        if (sequence) {
          stdout.write(`${moveTo(overlay.row, overlay.column)}${sequence}`);
        }
      }
    }
    this.previousHadImageOverlays = hasImageOverlays;
    this.previousImageOverlaySignature = nextImageOverlaySignature;
    stdout.write(ansi.home);
  }

  onKey(handler: KeyHandler): () => void {
    this.keyHandlers.add(handler);
    return () => this.keyHandlers.delete(handler);
  }

  onMouse(handler: MouseHandler): () => void {
    this.mouseHandlers.add(handler);
    return () => this.mouseHandlers.delete(handler);
  }

  onResize(handler: ResizeHandler): () => void {
    this.resizeHandlers.add(handler);
    return () => this.resizeHandlers.delete(handler);
  }

  private readonly handleData = (chunk: Buffer | string): void => {
    if (this.pendingEscapeTimeout) {
      clearTimeout(this.pendingEscapeTimeout);
      this.pendingEscapeTimeout = undefined;
    }
    this.inputBuffer += chunk.toString("utf8");

    while (this.inputBuffer.length > 0) {
      const mouseSequence = consumeMouseSequence(this.inputBuffer);
      if (mouseSequence?.complete) {
        this.inputBuffer = this.inputBuffer.slice(mouseSequence.sequence.length);
        for (const handler of this.mouseHandlers) {
          handler(mouseSequence.event);
        }
        continue;
      }
      if (mouseSequence) {
        this.scheduleBufferedInputFlush();
        return;
      }

      const escapeSequence = consumeEscapeSequence(this.inputBuffer);
      if (escapeSequence?.complete) {
        this.inputBuffer = this.inputBuffer.slice(escapeSequence.sequence.length);
        for (const handler of this.keyHandlers) {
          handler(escapeSequence.sequence);
        }
        continue;
      }
      if (escapeSequence) {
        this.scheduleBufferedInputFlush();
        return;
      }

      const char = this.inputBuffer[0] ?? "";
      this.inputBuffer = this.inputBuffer.slice(1);
      for (const handler of this.keyHandlers) {
        handler(char);
      }
    }
  };

  private readonly handleResize = (): void => {
    for (const handler of this.resizeHandlers) {
      handler();
    }
  };

  private readonly scheduleBufferedInputFlush = (): void => {
    if (this.pendingEscapeTimeout) {
      clearTimeout(this.pendingEscapeTimeout);
    }
    this.pendingEscapeTimeout = setTimeout(() => {
      this.pendingEscapeTimeout = undefined;
      this.flushBufferedInput();
    }, 25);
  };

  private readonly flushBufferedInput = (): void => {
    if (!this.inputBuffer) {
      return;
    }
    if (this.inputBuffer === "\x1b") {
      this.inputBuffer = "";
      for (const handler of this.keyHandlers) {
        handler("\x1b");
      }
      return;
    }

    const fallback = this.inputBuffer;
    this.inputBuffer = "";
    for (const handler of this.keyHandlers) {
      handler(fallback);
    }
  };
}

function parseMouseEvent(input: string): MouseEvent | undefined {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(input);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  const suffix = match[4];
  const wheel = (code & 64) !== 0;
  const dragging = (code & 32) !== 0;
  const buttonCode = code & 3;
  const button = wheel
    ? buttonCode === 0 ? "wheel-up" : "wheel-down"
    : buttonCode === 0 ? "left" : buttonCode === 1 ? "middle" : "right";
  const kind: MouseEvent["kind"] = suffix === "m" ? "up" : dragging ? "drag" : "down";
  return { kind, button, row, column };
}

function consumeMouseSequence(input: string): { complete: true; sequence: string; event: MouseEvent } | { complete: false } | undefined {
  if (!input.startsWith("\x1b[<")) {
    return undefined;
  }
  const match = /^\x1b\[<\d+;\d+;\d+[Mm]/.exec(input);
  if (!match) {
    return isMouseSequencePrefix(input) ? { complete: false } : undefined;
  }
  const sequence = match[0] ?? "";
  const event = parseMouseEvent(sequence);
  if (!event) {
    return undefined;
  }
  return { complete: true, sequence, event };
}

function isMouseSequencePrefix(input: string): boolean {
  return /^\x1b\[<\d*(?:;\d*){0,2}$/.test(input);
}

function consumeEscapeSequence(input: string): { complete: true; sequence: string } | { complete: false } | undefined {
  if (!input.startsWith("\x1b")) {
    return undefined;
  }
  if (input === "\x1b") {
    return { complete: false };
  }
  if (input.startsWith("\x1b[<")) {
    return isMouseSequencePrefix(input) ? { complete: false } : undefined;
  }
  const match = /^\x1b(?:\[[0-9;?]*[A-Za-z~]|.)/.exec(input);
  if (!match) {
    return { complete: false };
  }
  return { complete: true, sequence: match[0] ?? "\x1b" };
}
