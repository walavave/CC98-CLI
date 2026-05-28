import {
  drawAccountModal,
  drawConfirmModal,
  drawLoginModal
} from "./account-modal.js";
import type { TuiConfig } from "../config.js";
import { Canvas } from "./canvas.js";
import { imagePreviewRows } from "./image-preview.js";
import { center, fill, length, min, pad, percentage, rect, split } from "./layout.js";
import type { TerminalFrame, TerminalImageOverlay } from "./terminal.js";
import { blank, cellWidth, fit, truncate, wrapText } from "./text.js";
import { ruleLine, selectedLine, textStyle, theme } from "./theme.js";
import {
  currentTopicLine,
  currentTopicPost,
  getStatus,
  lineKindLabel,
  mascotMini,
  navItems,
  type MenuItem,
  type TopicReaderState,
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
  const showRight = width >= 78 && !config.hideRightPanel;
  const bodyColumns = showRight
    ? split(bodyArea, "horizontal", [
      length(sidebarWidth),
      length(sidebarWidth > 0 ? 1 : 0),
      min(24),
      length(1),
      percentage(30)
    ])
    : split(bodyArea, "horizontal", [
      length(sidebarWidth),
      length(sidebarWidth > 0 ? 1 : 0),
      fill()
    ]);

  const [sidebarArea, sidebarRuleArea, mainArea] = bodyColumns;
  const rightRuleArea = showRight ? bodyColumns[3] : undefined;
  const rightArea = showRight ? bodyColumns[4] : undefined;

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
  if (rightArea && rightRuleArea && rightArea.width > 0 && rightRuleArea.width > 0) {
    canvas.drawLines(rightArea, drawRight(state, rightArea.width, rightArea.height));
  }

  if (sidebarRuleArea.width > 0) {
    canvas.verticalRule(sidebarRuleArea);
    canvas.junction(sidebarRuleArea.x, bodyArea.y - 1, theme.border.teeTop);
  }
  if (rightArea && rightRuleArea && rightArea.width > 0 && rightRuleArea.width > 0) {
    canvas.verticalRule(rightRuleArea);
    canvas.junction(rightRuleArea.x, bodyArea.y - 1, theme.border.teeTop);
  }
  if (sidebarRuleArea.width > 0) {
    canvas.junction(sidebarRuleArea.x, outer.y + outer.height - 1, theme.border.teeBottom);
  }
  if (rightArea && rightRuleArea && rightArea.width > 0 && rightRuleArea.width > 0) {
    canvas.junction(rightRuleArea.x, outer.y + outer.height - 1, theme.border.teeBottom);
  }
  canvas.drawLines(statusArea, [drawStatusBar(state, statusArea.width)]);

  const baseLines = canvas.toLines();
  if (state.modal === "help") {
    return { text: drawHelpModal(baseLines, width, height) };
  }
  if (state.modal === "menu") {
    return { text: drawMenuModal(baseLines, state, width, height) };
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
      rows.push(sidebarSelectedLine(text, width, true));
    } else if (active) {
      rows.push(sidebarSelectedLine(text, width, false));
    } else {
      rows.push(`${textStyle.primary(label)}${textStyle.muted(fit(hint, Math.max(0, width - cellWidth(label))))}`);
    }
  }
  return rows;
}

function sidebarSelectedLine(content: string, width: number, focused: boolean): string {
  return selectedLine(content, width, true);
}

function drawMain(state: TuiState, width: number, height: number, config: TuiConfig): TopicDrawResult {
  if (state.mode === "topic") {
    return drawTopic(state, width, height);
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
    const title = fit(` ${marker} ${listItemTitle(itemValue, config)}`, width);
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

function listItemTitle(itemValue: { title: string; detail?: string }, config: TuiConfig): string {
  if (!config.hideRightPanel || !itemValue.detail) {
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
    const imageFitsViewport = index + imagePreviewRows <= body.length;
    if (lineEntry?.imagePreview && bodyLine.startsWith("[image ") && imageFitsViewport) {
      imageOverlays.push({ row: rows.length, token: lineEntry.imagePreview });
      rows.push(topicBodyLine("", width));
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
  if (state.mode === "topic") {
    hints.push("n 下页", "【/】楼层", "数字跳楼");
  } else if (state.currentChat) {
    hints.push("n 更多");
  }
  hints.push("r 刷新", "o 操作", "? 帮助", "q 退出");
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
    "   r           刷新当前视图",
    "   n, Space    加载更多",
    "   o           打开操作菜单",
    "   ?           显示/关闭帮助",
    "   q           退出程序",
    "",
    " 按任意键关闭"
  ];
  const area = center(rect(width, height), 50, Math.min(20, helpContent.length + 2));
  canvas.overlay(area, helpContent, { fill: theme.color.panelBg });
  return canvas.toString();
}

function drawMenuModal(baseLines: string[], state: TuiState, width: number, height: number): string {
  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);
  const rows = [
    textStyle.primaryBold(" 操作菜单"),
    ...state.menuItems.map((item: MenuItem, index) => {
      const active = index === state.menuIndex;
      const label = ` ${item.label}`;
      const key = `[${item.key}]`;
      const padding = Math.max(0, 28 - cellWidth(label) - cellWidth(key));
      const content = `${label}${" ".repeat(padding)}${key}`;
      return active ? selectedLine(content, 28, true) : content;
    })
  ];
  const area = center(rect(width, height), 32, rows.length + 2);
  canvas.overlay(area, rows, { fill: theme.color.panelBg });
  return canvas.toString();
}

function drawRight(state: TuiState, width: number, height: number): string[] {
  if (state.mode === "topic" && state.topic) {
    return drawTopicRight(state.topic, state.scroll, width, height);
  }
  if (state.focus === "nav") {
    return drawNavRight(state, width, height);
  }
  return drawItemRight(state, width, height);
}

function drawNavRight(state: TuiState, width: number, height: number): string[] {
  const rows: string[] = [];
  const nav = navItems[state.navIndex];
  rows.push(...mascotMini.map((row) => fit(textStyle.onPrimary(row), width)));
  rows.push(ruleLine(width));
  rows.push(fit(textStyle.primaryBold(` ${nav.label}`), width));
  rows.push(fit(textStyle.muted(` ${nav.hint}`), width));
  rows.push(ruleLine(width));

  if (state.loading) {
    rows.push(fit(textStyle.muted(" 正在读取栏目..."), width));
  } else if (state.error) {
    rows.push(fit(textStyle.danger(" 栏目读取失败"), width));
    rows.push(fit(` ${state.error}`, width));
  } else {
    rows.push(fit(textStyle.muted(" 当前内容"), width));
    rows.push(fit(textStyle.primarySoft(` ${state.items.length} 项`), width));
    if (state.stats.length > 0) {
      rows.push(ruleLine(width));
      state.stats.slice(0, 5).forEach((stat) => {
        rows.push(fit(textStyle.muted(` ${stat.title}`), width));
        rows.push(fit(textStyle.primarySoft(` ${stat.detail ?? "-"}`), width));
      });
    }
  }

  rows.push(ruleLine(width));
  rows.push(fit(textStyle.muted(" j/k 切换栏目"), width));
  rows.push(fit(textStyle.muted(" l/Enter 进入内容"), width));
  rows.push(fit(textStyle.muted(" r 刷新当前栏目"), width));
  return rows.concat(blank(height - rows.length, width)).slice(0, height);
}

function drawItemRight(state: TuiState, width: number, height: number): string[] {
  const rows: string[] = [];
  const selected = state.items[state.itemIndex];

  if (!selected) {
    rows.push(fit(textStyle.muted(" 暂无选中项"), width));
    return rows.concat(blank(height - rows.length, width)).slice(0, height);
  }

  rows.push(fit(textStyle.primaryBold(` ${selected.title}`), width));
  if (selected.meta) {
    wrapText(selected.meta, width - 2).slice(0, 3).forEach((row) => {
      rows.push(fit(textStyle.muted(` ${row}`), width));
    });
  }
  rows.push(ruleLine(width));

  if (selected.detail) {
    wrapText(selected.detail, width - 2).filter((row) => row.trim() !== "").slice(0, Math.max(0, height - rows.length - 8)).forEach((row) => {
      rows.push(fit(` ${row}`, width));
    });
  } else {
    rows.push(fit(textStyle.muted(" 没有摘要内容"), width));
  }

  rows.push(ruleLine(width));
  if (selected.topicId !== undefined) {
    rows.push(fit(textStyle.muted(` 主题 #${selected.topicId}`), width));
    if (selected.boardId !== undefined) {
      rows.push(fit(textStyle.muted(` 版面 #${selected.boardId}`), width));
    }
    rows.push(fit(textStyle.primarySoft(" l 打开阅读"), width));
  } else if (selected.boardId !== undefined) {
    rows.push(fit(textStyle.muted(` 版面 #${selected.boardId}`), width));
    rows.push(fit(textStyle.primarySoft(" l 读取主题"), width));
  } else if (selected.chatUserId !== undefined) {
    rows.push(fit(textStyle.muted(` 用户 #${selected.chatUserId}`), width));
    rows.push(fit(textStyle.primarySoft(" l 打开会话"), width));
  } else if (state.mode === "settings") {
    rows.push(fit(textStyle.primarySoft(" l/Enter 执行"), width));
  }

  return rows.concat(blank(height - rows.length, width)).slice(0, height);
}

function drawTopicRight(topic: TopicReaderState, scroll: number, width: number, height: number): string[] {
  const rows: string[] = [];
  const post = currentTopicPost(topic, scroll);
  const lineEntry = currentTopicLine(topic, scroll);
  rows.push(fit(textStyle.primaryBold(` ${topic.title}`), width));
  if (topic.meta) {
    wrapText(topic.meta, width - 2).slice(0, 2).forEach((row) => {
      rows.push(fit(textStyle.muted(` ${row}`), width));
    });
  }
  rows.push(ruleLine(width));

  if (post) {
    const floor = post.floor !== undefined ? `${post.floor} 楼` : "未知楼层";
    rows.push(fit(textStyle.primarySoft(` ${floor}`), width));
    rows.push(fit(textStyle.muted(` ${post.author}${post.time ? ` · ${post.time}` : ""}`), width));
    rows.push(fit(textStyle.muted(` 赞 ${post.likeCount}  踩 ${post.dislikeCount}${post.rating ? `  评分 ${post.rating}` : ""}`), width));
    rows.push(ruleLine(width));

    if (lineEntry) {
      rows.push(fit(textStyle.muted(` 当前行 ${lineEntry.row + 1}/${post.lines.length}`), width));
      rows.push(fit(textStyle.primarySoft(` ${lineKindLabel(lineEntry.kind)}`), width));
      if (lineEntry.imageUrl) {
        rows.push(fit(textStyle.muted(` 图片 ${lineEntry.imageIndex}`), width));
        wrapText(lineEntry.imageUrl, width - 2).slice(0, 2).forEach((row) => rows.push(fit(` ${row}`, width)));
      } else if (lineEntry.linkUrl) {
        rows.push(fit(textStyle.muted(` 链接 ${lineEntry.linkIndex}`), width));
        wrapText(lineEntry.linkUrl, width - 2).slice(0, 2).forEach((row) => rows.push(fit(` ${row}`, width)));
      } else if (lineEntry.text.trim()) {
        wrapText(lineEntry.text, width - 2).slice(0, 3).forEach((row) => rows.push(fit(` ${row}`, width)));
      }
    }

    rows.push(ruleLine(width));
    rows.push(fit(textStyle.muted(` 本楼 图片 ${post.imageCount}  链接 ${post.linkCount}`), width));
  }

  const hot = topic.posts
    .filter((entry) => entry.likeCount > 0)
    .sort((left, right) => right.likeCount - left.likeCount)
    .slice(0, 3);
  if (hot.length > 0 && rows.length < height - 5) {
    rows.push(ruleLine(width));
    rows.push(fit(textStyle.primaryBold(" 热门回复"), width));
    hot.forEach((entry) => {
      rows.push(fit(textStyle.muted(` #${entry.floor ?? "?"} ${entry.author} · ${entry.likeCount} 赞`), width));
      if (entry.preview) {
        rows.push(fit(` ${truncate(entry.preview, width - 2)}`, width));
      }
    });
  }

  rows.push(ruleLine(width));
  rows.push(fit(textStyle.muted(" j/k 行滚动  【/】楼层切换"), width));
  rows.push(fit(textStyle.muted(" 数字+Enter 跳楼  n 下一页"), width));
  if (topic.floorInput) {
    rows.push(fit(textStyle.ok(` 跳转：${topic.floorInput} 楼`), width));
  }
  return rows.concat(blank(height - rows.length, width)).slice(0, height);
}
