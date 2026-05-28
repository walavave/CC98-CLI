import { ansi } from "./ansi.js";
import type { Rect } from "./layout.js";
import { cellWidth, fit, graphemes } from "./text.js";
import { theme } from "./theme.js";

interface Cell {
  text: string;
  style: string[];
  continuation?: boolean;
}

export class Canvas {
  private readonly cells: Cell[][];

  constructor(readonly width: number, readonly height: number) {
    this.cells = Array.from({ length: Math.max(0, height) }, () =>
      Array.from({ length: Math.max(0, width) }, () => ({ text: " ", style: [] }))
    );
  }

  clear(area: Rect): void {
    this.fill(area, " ");
  }

  drawLines(area: Rect, lines: string[]): void {
    if (area.width <= 0 || area.height <= 0) {
      return;
    }
    for (let offset = 0; offset < area.height; offset += 1) {
      const y = area.y + offset;
      if (y < 0 || y >= this.height) {
        continue;
      }
      this.drawText(area.x, y, area.width, lines[offset] ?? "");
    }
  }

  verticalRule(area: Rect): void {
    this.fill(area, theme.border.vertical, theme.color.rule);
  }

  horizontalRule(area: Rect): void {
    this.fill(area, theme.border.horizontal, theme.color.rule);
  }

  border(area: Rect, rows: string[], options: { fill?: string } = {}): void {
    if (area.width < 2 || area.height < 2) {
      this.clear(area);
      return;
    }

    const innerWidth = Math.max(0, area.width - 2);
    const fill = options.fill ?? "";
    const borderStyle = theme.color.rule;

    this.setCell(area.x, area.y, theme.border.topLeft, borderStyle);
    this.setCell(area.x + area.width - 1, area.y, theme.border.topRight, borderStyle);
    this.setCell(area.x, area.y + area.height - 1, theme.border.bottomLeft, borderStyle);
    this.setCell(area.x + area.width - 1, area.y + area.height - 1, theme.border.bottomRight, borderStyle);

    this.fill({ x: area.x + 1, y: area.y, width: innerWidth, height: 1 }, theme.border.horizontal, borderStyle);
    this.fill({ x: area.x + 1, y: area.y + area.height - 1, width: innerWidth, height: 1 }, theme.border.horizontal, borderStyle);
    this.fill({ x: area.x, y: area.y + 1, width: 1, height: area.height - 2 }, theme.border.vertical, borderStyle);
    this.fill({ x: area.x + area.width - 1, y: area.y + 1, width: 1, height: area.height - 2 }, theme.border.vertical, borderStyle);

    const innerArea = { x: area.x + 1, y: area.y + 1, width: innerWidth, height: area.height - 2 };
    if (fill) {
      this.fill(innerArea, " ", fill);
    } else {
      this.clear(innerArea);
    }
    this.drawLines(innerArea, rows.map((row) => fit(row, innerWidth)));
  }

  overlay(area: Rect, rows: string[], options: { fill?: string } = {}): void {
    this.clear(area);
    this.border(area, rows, options);
  }

  toString(): string {
    return this.cells.map((row) => {
      let output = "";
      let currentStyle = "";
      for (const cell of row) {
        if (cell.continuation) {
          continue;
        }
        const style = cell.style.join("");
        if (style !== currentStyle) {
          output += style || ansi.reset;
          currentStyle = style;
        }
        output += cell.text;
      }
      return `${output}${ansi.reset}`;
    }).slice(0, this.height).join("\n");
  }

  toLines(): string[] {
    return this.toString().split("\n");
  }

  private fill(area: Rect, text: string, style = ""): void {
    const glyph = text || " ";
    const styles = style ? [style] : [];
    for (let y = Math.max(0, area.y); y < Math.min(this.height, area.y + area.height); y += 1) {
      for (let x = Math.max(0, area.x); x < Math.min(this.width, area.x + area.width); x += 1) {
        this.clearWideAt(x, y);
        this.cells[y][x] = { text: glyph, style: styles };
      }
    }
  }

  private setCell(x: number, y: number, text: string, style = ""): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }
    this.clearWideAt(x, y);
    this.cells[y][x] = { text: text || " ", style: style ? [style] : [] };
  }

  private drawText(x: number, y: number, width: number, value: string): void {
    if (y < 0 || y >= this.height || width <= 0) {
      return;
    }
    const padded = fit(value, width);
    let currentStyle: string[] = [];
    let cellX = Math.max(0, x);
    let inEscape = false;
    let escape = "";

    for (const cluster of graphemes(padded)) {
      const char = cluster[0] ?? "";
      if (char === "\x1b") {
        inEscape = true;
        escape = cluster;
        continue;
      }
      if (inEscape) {
        escape += cluster;
        if (/[A-Za-z]/.test(cluster)) {
          currentStyle = applyStyle(currentStyle, escape);
          inEscape = false;
          escape = "";
        }
        continue;
      }

      const charWidth = cellWidth(cluster);
      if (cellX >= this.width || cellX >= x + width) {
        break;
      }
      if (cellX + charWidth > x + width || cellX + charWidth > this.width) {
        this.clearWideAt(cellX, y);
        this.cells[y][cellX] = { text: " ", style: [...currentStyle] };
        cellX += 1;
        continue;
      }
      this.clearWideAt(cellX, y);
      this.cells[y][cellX] = { text: cluster, style: [...currentStyle] };
      for (let offset = 1; offset < charWidth && cellX + offset < this.width; offset += 1) {
        this.clearWideAt(cellX + offset, y);
        this.cells[y][cellX + offset] = { text: "", style: [...currentStyle], continuation: true };
      }
      cellX += charWidth;
    }
  }

  private clearWideAt(x: number, y: number): void {
    const row = this.cells[y];
    if (!row || x < 0 || x >= this.width) {
      return;
    }
    if (row[x]?.continuation && x > 0) {
      row[x - 1] = { text: " ", style: [] };
    }
    if (row[x]?.text && cellWidth(row[x].text) > 1 && x + 1 < this.width) {
      row[x + 1] = { text: " ", style: [] };
    }
  }
}

function applyStyle(current: string[], escape: string): string[] {
  if (escape === ansi.reset) {
    return [];
  }
  if (!escape.endsWith("m")) {
    return current;
  }
  const codes = escape.slice(2, -1).split(";").map((value) => Number(value || "0"));
  if (codes.includes(0)) {
    return [];
  }
  const next = current.filter((entry) => !conflicts(entry, escape));
  next.push(escape);
  return next;
}

function conflicts(left: string, right: string): boolean {
  const leftCodes = left.slice(2, -1).split(";").map((value) => Number(value || "0"));
  const rightCodes = right.slice(2, -1).split(";").map((value) => Number(value || "0"));
  return styleGroup(leftCodes) === styleGroup(rightCodes);
}

function styleGroup(codes: number[]): string {
  const first = codes[0] ?? 0;
  if (first === 1 || first === 2 || first === 22) {
    return "weight";
  }
  if (first === 4 || first === 24) {
    return "underline";
  }
  if (first === 38 || (first >= 30 && first <= 37) || (first >= 90 && first <= 97)) {
    return "fg";
  }
  if (first === 48 || (first >= 40 && first <= 47) || (first >= 100 && first <= 107)) {
    return "bg";
  }
  return String(first);
}
