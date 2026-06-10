import type { TuiConfig } from "../config.js";
import { Canvas } from "./render-core/canvas.js";
import { center, fill, length, pad, rect, split } from "./render-core/layout.js";
import type { TerminalFrame, TerminalImageOverlay } from "./render-core/terminal.js";
import { cellWidth, fit } from "./render-core/text.js";
import { ruleLine, selectedLine, selectedNoticeLine, textStyle, theme } from "./render-core/theme.js";
import {
  navItems,
  type TuiState
} from "./tui-model.js";
import { getSidebarWidth, getRenderedListItemIndexAtRow, getRenderedSearchItemIndexAtRow, drawMain, drawStatusBar } from "./renderer/content.js";
import { drawModalFrame } from "./renderer/modals.js";

export { getSidebarWidth, getRenderedListItemIndexAtRow, getRenderedSearchItemIndexAtRow };

export function draw(state: TuiState, size: { columns: number; rows: number }, config: TuiConfig): TerminalFrame {
  const width = Math.max(1, size.columns);
  const height = Math.max(1, size.rows);
  const canvas = new Canvas(width, height);

  if (width < 24 || height < 8) {
    canvas.drawLines(rect(width, height), [
      textStyle.primaryBar(" CC98 "),
      textStyle.muted("窗口太小"),
      textStyle.muted("q 退出")
    ]);
    return { text: canvas.toString() };
  }

  const outer = rect(width, Math.max(0, height - 1));
  canvas.frame(outer);
  const root = pad(outer, 1);
  const verticalLayout = config.hideTopChrome
    ? [fill()]
    : [length(1), length(1), length(1), length(1), fill()];
  const areas = split(root, "vertical", verticalLayout);
  const headerArea = config.hideTopChrome ? undefined : areas[0];
  const headerRuleArea = config.hideTopChrome ? undefined : areas[1];
  const overviewArea = config.hideTopChrome ? undefined : areas[2];
  const overviewRuleArea = config.hideTopChrome ? undefined : areas[3];
  const bodyArea = config.hideTopChrome ? areas[0] : areas[4];
  const statusArea = rect(width, 1, 0, height - 1);

  if (headerArea && headerRuleArea && overviewArea && overviewRuleArea) {
    canvas.drawLines(headerArea, [header(headerArea.width, state)]);
    canvas.horizontalRule(headerRuleArea);
    canvas.drawLines(overviewArea, drawOverview(state, overviewArea.width, overviewArea.height));
    canvas.horizontalRule(overviewRuleArea);
    canvas.junction(outer.x, headerRuleArea.y, theme.border.teeLeft);
    canvas.junction(outer.x + outer.width - 1, headerRuleArea.y, theme.border.teeRight);
    canvas.junction(outer.x, overviewRuleArea.y, theme.border.teeLeft);
    canvas.junction(outer.x + outer.width - 1, overviewRuleArea.y, theme.border.teeRight);
  }

  const sidebarWidth = getSidebarWidth(width, state.sidebarWidth);
  const bodyColumns = split(bodyArea, "horizontal", [
    length(sidebarWidth),
    length(sidebarWidth > 0 ? 1 : 0),
    fill()
  ]);

  const [sidebarArea, sidebarRuleArea, mainArea] = bodyColumns;

  let imageOverlays: TerminalImageOverlay[] = [];

  if (sidebarArea.width > 0) {
    canvas.drawLines(sidebarArea, drawSidebar(state, sidebarArea.width, sidebarArea.height));
  }
  const main = drawMain(state, mainArea.width, mainArea.height, config);
  canvas.drawLines(mainArea, main.rows);
  imageOverlays = main.imageOverlays.map((overlay) => ({
    row: mainArea.y + overlay.row + 1,
    column: mainArea.x + 2,
    token: overlay.token
  }));
  if (sidebarRuleArea.width > 0) {
    canvas.verticalRule(sidebarRuleArea);
    canvas.junction(sidebarRuleArea.x, bodyArea.y - 1, theme.border.teeTop);
  }
  if (sidebarRuleArea.width > 0) {
    canvas.junction(sidebarRuleArea.x, outer.y + outer.height - 1, theme.border.teeBottom);
  }
  canvas.drawLines(statusArea, [drawStatusBar(state, statusArea.width)]);

  const modalFrame = drawModalFrame(canvas.toLines(), state, width, height);
  if (modalFrame) {
    return modalFrame;
  }

  return { text: canvas.toString(), imageOverlays };
}

function header(width: number, state: TuiState): string {
  const account = state.account ? `@${state.account}` : "未登录";
  const title = ` CC98 ${state.viewTitle} `;
  const padding = Math.max(1, width - cellWidth(title) - cellWidth(account));
  return textStyle.primaryBar(fit(`${title}${" ".repeat(padding)}${account}`, width));
}

function drawOverview(state: TuiState, width: number, height: number): string[] {
  const summary = state.overview.length > 0
    ? state.overview.map((entry) => `${entry.title} ${entry.detail ?? "-"}`).join("  ")
    : "全站概览会在读取十大时更新";
  return [fit(textStyle.primarySoft(` ${summary}`), width)].slice(0, height);
}

function drawSidebar(state: TuiState, width: number, height: number): string[] {
  const rows: string[] = [];
  for (let index = 0; index < height; index += 1) {
    const nav = navItems[index];
    if (!nav) {
      rows.push(" ".repeat(width));
      continue;
    }

    const active = index === state.navIndex;
    const focused = state.focus === "nav";
    const hasUnread = (nav.id === "messages" && (state.unreadSummary?.messageCount ?? 0) > 0)
      || (nav.id === "notifications" && (state.unreadSummary?.notificationCount ?? 0) > 0);
    const label = ` ${nav.label}`;
    const hint = width > 16 ? ` ${nav.hint}` : "";
    const text = fit(`${label}${hint}`, width);
    if (active && focused) {
      rows.push(hasUnread
        ? selectedNoticeLine(text, width)
        : selectedLine(text, width, true));
    } else if (active) {
      rows.push(hasUnread
        ? selectedNoticeLine(text, width)
        : selectedLine(text, width, true));
    } else {
      const labelStyle = hasUnread ? textStyle.noticeBold : textStyle.primary;
      const hintStyle = hasUnread ? textStyle.notice : textStyle.muted;
      rows.push(`${labelStyle(label)}${hintStyle(fit(hint, Math.max(0, width - cellWidth(label))))}`);
    }
  }
  return rows;
}
