import { ansi, bg, fg } from "./ansi.js";
import { fit } from "./text.js";

export const theme = {
  color: {
    primary: fg(0, 130, 202),
    primarySoft: fg(94, 180, 232),
    primaryBg: bg(0, 104, 176),
    panelBg: bg(5, 46, 74),
    selectedBg: bg(181, 196, 255),
    selectedFg: fg(12, 38, 67),
    emotionSelectedBorder: fg(91, 207, 140),
    textOnPrimary: fg(245, 250, 255),
    muted: fg(139, 152, 166),
    rule: fg(181, 196, 255),
    notice: fg(245, 101, 101),
    danger: fg(245, 101, 101),
    ok: fg(91, 207, 140)
  },
  border: {
    horizontal: "─",
    vertical: "│",
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    teeLeft: "├",
    teeRight: "┤",
    teeTop: "┬",
    teeBottom: "┴",
    cross: "┼"
  },
  marker: {
    selected: "●",
    normal: "•",
    pointer: "›"
  },
  quote: {
    prefix: "│ "
  }
} as const;

export function styled(content: string, style: string): string {
  return `${style}${content}${ansi.reset}`;
}

export const textStyle = {
  primary(content: string): string {
    return styled(content, theme.color.primary);
  },
  primaryBold(content: string): string {
    return styled(content, `${theme.color.primary}${ansi.bold}`);
  },
  primarySoft(content: string): string {
    return styled(content, theme.color.primarySoft);
  },
  primarySoftBold(content: string): string {
    return styled(content, `${theme.color.primarySoft}${ansi.bold}`);
  },
  primaryBar(content: string): string {
    return styled(content, `${theme.color.primaryBg}${theme.color.textOnPrimary}${ansi.bold}`);
  },
  muted(content: string): string {
    return styled(content, theme.color.muted);
  },
  notice(content: string): string {
    return styled(content, theme.color.notice);
  },
  noticeBold(content: string): string {
    return styled(content, `${theme.color.notice}${ansi.bold}`);
  },
  danger(content: string): string {
    return styled(content, theme.color.danger);
  },
  dangerBold(content: string): string {
    return styled(content, `${theme.color.danger}${ansi.bold}`);
  },
  ok(content: string): string {
    return styled(content, theme.color.ok);
  },
  onPrimary(content: string): string {
    return styled(content, theme.color.textOnPrimary);
  },
  rule(content: string): string {
    return styled(content, theme.color.rule);
  }
} as const;

export function selectedLine(content: string, width: number, focused = true): string {
  if (!focused) {
    return textStyle.primarySoft(fit(content, width));
  }
  return styled(fit(content, width), `${theme.color.selectedBg}${theme.color.selectedFg}${ansi.bold}`);
}

export function panelLine(content: string, width: number): string {
  return styled(fit(content, width), theme.color.panelBg);
}

export function ruleLine(width: number): string {
  return textStyle.rule(theme.border.horizontal.repeat(Math.max(0, width)));
}
