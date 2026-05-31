import {
  drawAccountModal,
  drawConfirmModal,
  drawLoginModal
} from "./account-modal.js";
import type { TuiConfig } from "../config.js";
import { Canvas } from "./canvas.js";
import { imagePreviewRows } from "./image-preview.js";
import { center, fill, length, pad, rect, split } from "./layout.js";
import type { TerminalFrame, TerminalImageOverlay } from "./terminal.js";
import { blank, cellWidth, fit, truncate } from "./text.js";
import { ruleLine, selectedLine, textStyle, theme } from "./theme.js";
import {
  currentTopicLine,
  getStatus,
  navItems,
  type TuiState
} from "./tui-model.js";

interface TopicDrawResult {
  rows: string[];
  imageOverlays: Array<{ row: number; token: string }>;
}

export function getSidebarWidth(totalWidth: number, preferred?: number): number {
  const fallback = totalWidth < 56 ? 0 : totalWidth < 90 ? 14 : 18;
  if (preferred === undefined || preferred <= 0 || totalWidth < 56) {
    return fallback;
  }
  return Math.max(10, Math.min(preferred, Math.max(10, Math.floor(totalWidth * 0.35))));
}

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
  const main = drawMain(state, mainArea.width, mainArea.height);
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

  const baseLines = canvas.toLines();
  if (state.modal === "help") {
    return { text: drawHelpModal(baseLines, width, height) };
  }
  if (state.modal === "account") {
    return { text: drawAccountModal(baseLines, state.accountModal, width, height) };
  }
  if (state.modal === "login") {
    return { text: drawLoginModal(baseLines, state.loginForm, width, height) };
  }
  if (state.modal === "confirm" && state.confirmDialog) {
    return { text: drawConfirmModal(baseLines, state.confirmDialog, width, height) };
  }
  if (state.modal === "image" && state.imageViewer) {
    return drawImageModal(baseLines, state, width, height);
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
    const label = ` ${nav.label}`;
    const hint = width > 16 ? ` ${nav.hint}` : "";
    const text = fit(`${label}${hint}`, width);
    if (active && focused) {
      rows.push(selectedLine(text, width, true));
    } else if (active) {
      rows.push(selectedLine(text, width, true));
    } else {
      rows.push(`${textStyle.primary(label)}${textStyle.muted(fit(hint, Math.max(0, width - cellWidth(label))))}`);
    }
  }
  return rows;
}

function drawMain(state: TuiState, width: number, height: number): TopicDrawResult {
  if (state.mode === "topic") {
    return drawTopic(state, width, height);
  }

  if (state.currentSearch) {
    return drawSearch(state, width, height);
  }

  if (state.loading) {
    return { rows: [
      textStyle.primaryBold(` ${state.viewTitle}`),
      fit(textStyle.muted(" 正在加载..."), width),
      ruleLine(Math.max(0, width - 1)),
      textStyle.muted(` ${"· ".repeat(Math.max(1, Math.floor((width - 2) / 2))).slice(0, width - 1)}`)
    ].concat(blank(height - 4, width)).slice(0, height), imageOverlays: [] };
  }

  if (state.error) {
    return { rows: [
      textStyle.primaryBold(` ${state.viewTitle}`),
      ruleLine(Math.max(0, width - 1)),
      textStyle.danger(" 请求失败"),
      fit(` ${state.error}`, width)
    ].concat(blank(height - 4, width)).slice(0, height), imageOverlays: [] };
  }

  const rows: string[] = [];
  rows.push(textStyle.primaryBold(` ${state.viewTitle}`));
  rows.push(ruleLine(Math.max(0, width - 1)));

  const itemHeight = 2;
  const visibleCapacity = Math.max(1, Math.floor(Math.max(1, height - 2) / itemHeight));
  const scroll = getListScroll(state, visibleCapacity);
  const visible = state.items.slice(scroll, scroll + visibleCapacity);
  visible.forEach((itemValue, offset) => {
    if (rows.length + itemHeight > height) {
      return;
    }
    const index = scroll + offset;
    const active = index === state.itemIndex && (state.focus === "content" || state.mode === "settings");
    const marker = active ? theme.marker.selected : theme.marker.normal;
    const title = fit(` ${marker} ${listItemTitle(itemValue)}`, width);
    rows.push(active ? selectedLine(title, width, state.focus === "content" || state.mode === "settings") : textStyle.muted(title));

    rows.push(itemValue.meta ? fit(textStyle.muted(`  ${itemValue.meta}`), width) : " ".repeat(width));
  });

  if (visible.length === 0) {
    rows.push(textStyle.muted(" 暂无数据"));
  }

  if (scroll + visibleCapacity < state.items.length && rows.length < height) {
    rows.push(fit(textStyle.muted(`  ↓ 还有 ${state.items.length - scroll - visibleCapacity} 项`), width));
  }

  return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
}

function listItemTitle(itemValue: { title: string; detail?: string }): string {
  if (!itemValue.detail) {
    return itemValue.title;
  }
  if ("topicId" in itemValue && itemValue.topicId !== undefined) {
    return itemValue.title;
  }
  return `${itemValue.title}  ${truncate(itemValue.detail, 80)}`;
}

function getListScroll(state: TuiState, visibleCapacity: number): number {
  const maxScroll = Math.max(0, state.items.length - visibleCapacity);
  const current = Math.min(Math.max(0, state.scroll), maxScroll);
  if (state.itemIndex < current) {
    return state.itemIndex;
  }
  if (state.itemIndex >= current + visibleCapacity) {
    return Math.min(maxScroll, state.itemIndex - visibleCapacity + 1);
  }
  return current;
}

function drawSearch(state: TuiState, width: number, height: number): TopicDrawResult {
  const search = state.currentSearch;
  if (!search) {
    return { rows: blank(height, width), imageOverlays: [] };
  }

  const rows: string[] = [];
  rows.push(textStyle.primaryBold(` ${state.viewTitle}`));

  const inputText = search.draft || "";
  const placeholder = inputText ? "" : "输入关键词后按 Enter";
  const inputLabel = ` 搜索> ${inputText || placeholder}`;
  if (search.focus === "input" && state.focus === "content") {
    rows.push(selectedLine(fit(inputLabel, width), width, true));
  } else if (inputText) {
    rows.push(textStyle.primary(fit(inputLabel, width)));
  } else {
    rows.push(textStyle.muted(fit(inputLabel, width)));
  }

  rows.push(ruleLine(Math.max(0, width - 1)));

  if (state.loading) {
    rows.push(fit(textStyle.muted(" 正在搜索..."), width));
    return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
  }

  const itemHeight = 2;
  const visibleCapacity = Math.max(1, Math.floor(Math.max(1, height - 3) / itemHeight));
  const scroll = getListScroll(state, visibleCapacity);
  const visible = state.items.slice(scroll, scroll + visibleCapacity);

  if (visible.length === 0) {
    rows.push(textStyle.muted(search.searched ? " 暂无搜索结果" : " 在输入框中输入关键词并按 Enter"));
    return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
  }

  visible.forEach((itemValue, offset) => {
    if (rows.length + itemHeight > height) {
      return;
    }
    const index = scroll + offset;
    const active = index === state.itemIndex && state.focus === "content" && search.focus === "results";
    const marker = active ? theme.marker.selected : theme.marker.normal;
    const title = fit(` ${marker} ${listItemTitle(itemValue)}`, width);
    rows.push(active ? selectedLine(title, width, true) : textStyle.muted(title));
    rows.push(itemValue.meta ? fit(textStyle.muted(`  ${itemValue.meta}`), width) : " ".repeat(width));
  });

  if (scroll + visibleCapacity < state.items.length && rows.length < height) {
    rows.push(fit(textStyle.muted(`  ↓ 还有 ${state.items.length - scroll - visibleCapacity} 项`), width));
  } else if (search.hasMore && rows.length < height) {
    rows.push(fit(textStyle.muted("  ↓ 到底自动继续加载，或按 n/Space"), width));
  }

  return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
}

function drawTopic(state: TuiState, width: number, height: number): TopicDrawResult {
  if (state.loading && (!state.topic || state.topic.lines.length === 0)) {
    return { rows: [
      textStyle.primary(" 正在打开帖子..."),
      "",
      textStyle.muted(" 只加载第一页，不预取未读楼层。")
    ].concat(blank(height - 3, width)).slice(0, height), imageOverlays: [] };
  }

  if (state.error) {
    return { rows: [
      textStyle.danger(" 读取帖子失败"),
      fit(` ${state.error}`, width),
      "",
      textStyle.muted(" h/Esc 返回列表")
    ].concat(blank(height - 4, width)).slice(0, height), imageOverlays: [] };
  }

  const topic = state.topic;
  if (!topic) {
    return { rows: blank(height, width), imageOverlays: [] };
  }

  const rows: string[] = [];
  const imageOverlays: Array<{ row: number; token: string }> = [];
  rows.push(fit(textStyle.primaryBold(` ${topic.title}`), width));
  rows.push(fit(textStyle.muted(` ${topic.meta}`), width));
  rows.push(ruleLine(Math.max(0, width - 1)));

  const viewport = Math.max(0, height - rows.length - 1);
  const maxScroll = Math.max(0, topic.lines.length - viewport);
  state.scroll = Math.min(state.scroll, maxScroll);
  const body = topic.lines.slice(state.scroll, state.scroll + viewport);

  for (let index = 0; index < body.length; index += 1) {
    const bodyLine = body[index] ?? "";
    const lineEntry = currentTopicLine(topic, state.scroll + index);
    const imagePreview = lineEntry?.imagePreview;
    const previewHeight = Math.max(1, lineEntry?.imagePreviewRows ?? imagePreviewRows);
    const placeholderHeight = Math.max(1, lineEntry?.imageBlockRows ?? imagePlaceholderHeight(body, index));
    const imageFitsViewport = imagePreview !== undefined &&
      bodyLine.startsWith("[image ") &&
      previewHeight <= placeholderHeight &&
      index + placeholderHeight <= body.length;
    if (imageFitsViewport) {
      imageOverlays.push({ row: rows.length, token: imagePreview });
      rows.push(...Array.from({ length: placeholderHeight }, () => topicBodyLine("", width)));
      index += placeholderHeight - 1;
    } else if (bodyLine.startsWith("[image ")) {
      rows.push(topicBodyLine(bodyLine, width, textStyle.primarySoft));
    } else if (bodyLine.startsWith(theme.quote.prefix)) {
      rows.push(topicBodyLine(bodyLine, width, textStyle.muted));
    } else if (/^#\d+ /.test(bodyLine)) {
      rows.push(topicBodyLine(bodyLine, width, textStyle.ok));
    } else if (isTopicDivider(bodyLine)) {
      rows.push(topicBodyLine(bodyLine, width, textStyle.rule));
    } else {
      rows.push(topicBodyLine(bodyLine, width));
    }
  }

  const pageInfo = topic.hasMore
    ? `已载入 ${topic.loaded} 楼，n 下一页`
    : `已载入 ${topic.loaded} 楼，已到底`;
  rows.push(fit(textStyle.muted(`${pageInfo}${state.loadingMore ? " · 加载中" : ""}`), width));
  return {
    rows: rows.concat(blank(height - rows.length, width)).slice(0, height),
    imageOverlays
  };
}

function topicBodyLine(content: string, width: number, style?: (value: string) => string): string {
  const innerWidth = Math.max(0, width - 2);
  const padded = fit(content, innerWidth);
  return fit(` ${style ? style(padded) : padded} `, width);
}

function imagePlaceholderHeight(body: string[], start: number): number {
  let height = 1;
  for (let index = start + 1; index < body.length; index += 1) {
    const line = body[index] ?? "";
    if (line.startsWith("[image ") || line.trim() !== "") {
      break;
    }
    height += 1;
  }
  return height;
}

function isTopicDivider(content: string): boolean {
  return content.length >= 8 && [...content].every((char) => char === theme.border.horizontal);
}

function drawStatusBar(state: TuiState, width: number): string {
  const notification = state.notification && state.notification.expiresAt > Date.now()
    ? state.notification.message
    : undefined;
  const left = state.focus === "nav" && !notification
    ? ""
    : notification ?? (state.status || getStatus(state));
  const right = getKeyHints(state);
  const padding = Math.max(1, width - cellWidth(left) - cellWidth(right) - 2);
  const leftText = notification || isNotificationStatus(left)
    ? textStyle.notice(` ${left}`)
    : textStyle.muted(` ${left}`);
  return fit(`${leftText}${textStyle.muted(`${" ".repeat(padding)}${right} `)}`, width);
}

function isNotificationStatus(status: string): boolean {
  return status.startsWith("已") ||
    status.startsWith("发现新版本 ") ||
    status.startsWith("当前已是最新版本 ") ||
    status === "缓存已清理";
}

function getKeyHints(state: TuiState): string {
  const hints = ["j/k ↑↓ 移动", "h← 返回", "l→ 进入", "Enter 确认"];
  if (state.currentChat) {
    hints.push("n 更多");
  }
  if (state.mode === "topic") {
    hints.push("a 赞", "s 踩");
  }
  hints.push("f 搜索", "r 刷新", "? 帮助", "q 退出");
  return hints.join(" ");
}

function drawHelpModal(baseLines: string[], width: number, height: number): string {
  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);
  const helpContent = [
    textStyle.primaryBold(" 快捷键帮助"),
    "",
    " 导航",
    "   j/k, ↑/↓    上下移动",
    "   l, →        进入下一层",
    "   h, ←        返回上一层",
    "   Enter       确认/执行",
    "",
    " 操作",
    "   f           跳到搜索框",
    "   r           刷新当前视图",
    "   n           加载更多",
    "   a / s       对当前楼层点赞 / 点踩",
    "   Space       帖子内看图",
    "   ←/→         预览切图",
    "   ?           显示/关闭帮助",
    "   q           退出程序",
    "",
    " 按任意键关闭"
  ];
  const area = center(rect(width, height), 50, Math.min(20, helpContent.length + 2));
  canvas.overlay(area, helpContent, { fill: theme.color.panelBg });
  return canvas.toString();
}

function drawImageModal(baseLines: string[], state: TuiState, width: number, height: number): TerminalFrame {
  const viewer = state.imageViewer;
  if (!viewer) {
    return { text: baseLines.join("\n") };
  }

  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);

  const modalWidth = Math.max(24, Math.min(width - 4, Math.floor(width * 0.92)));
  const modalHeight = Math.max(10, Math.min(height - 2, Math.floor(height * 0.9)));
  const area = center(rect(width, height), modalWidth, modalHeight);
  const imageArea = pad(area, 1);

  const rows = Array.from({ length: imageArea.height }, (_, index) => {
    if (viewer.loading && index === Math.floor(imageArea.height / 2)) {
      return fit(textStyle.muted(" 正在加载大图..."), imageArea.width);
    }
    if (viewer.error && index === Math.floor(imageArea.height / 2)) {
      return fit(textStyle.danger(" 图片加载失败"), imageArea.width);
    }
    return " ".repeat(imageArea.width);
  });

  canvas.overlay(area, rows, { fill: theme.color.panelBg });

  const overlayColumns = Math.min(imageArea.width, Math.max(1, viewer.renderSize?.columns ?? imageArea.width));
  const overlayRows = Math.min(imageArea.height, Math.max(1, viewer.renderSize?.rows ?? imageArea.height));
  const overlayColumnOffset = Math.max(0, Math.floor((imageArea.width - overlayColumns) / 2));
  const overlayRowOffset = Math.max(0, Math.floor((imageArea.height - overlayRows) / 2));

  return {
    text: canvas.toString(),
    imageOverlays: viewer.token && imageArea.width > 0 && imageArea.height > 0
      ? [{
        row: imageArea.y + overlayRowOffset + 1,
        column: imageArea.x + overlayColumnOffset + 1,
        token: viewer.token
      }]
      : []
  };
}
