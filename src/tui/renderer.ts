import {
  drawAccountModal,
  drawConfirmModal,
  drawLoginModal
} from "./account-modal.js";
import { ansi } from "./ansi.js";
import type { TuiConfig } from "../config.js";
import { Canvas } from "./canvas.js";
import { emotionCategories, getEmotionPreview, getEmotionCategory } from "./emotion-catalog.js";
import { imagePreviewRows } from "./image-preview.js";
import { center, fill, length, pad, rect, split } from "./layout.js";
import type { TerminalFrame, TerminalImageOverlay } from "./terminal.js";
import { blank, cellWidth, fit, truncate, wrapText } from "./text.js";
import { ruleLine, selectedLine, styled, textStyle, theme } from "./theme.js";
import {
  currentTopicLine,
  getStatus,
  navItems,
  type ContentItem,
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

export function getRenderedListItemIndexAtRow(
  state: TuiState,
  width: number,
  height: number,
  rowIndex: number
): number | undefined {
  const contentRow = rowIndex - 2;
  if (contentRow < 0) {
    return undefined;
  }

  const wrapDetail = shouldWrapListDetail(state);
  const inlineDetail = shouldInlineListDetail(state);
  const contentHeight = Math.max(1, height - 2);
  const scroll = getListScroll(state, contentHeight, width, wrapDetail, inlineDetail);
  let usedRows = 0;

  for (let index = scroll; index < state.items.length; index += 1) {
    const itemHeight = getListItemHeight(state.items[index], width, wrapDetail, inlineDetail);
    if (usedRows + itemHeight > contentHeight) {
      break;
    }
    if (contentRow >= usedRows && contentRow < usedRows + itemHeight) {
      return index;
    }
    usedRows += itemHeight;
  }

  return undefined;
}

export function getRenderedSearchItemIndexAtRow(
  state: TuiState,
  width: number,
  height: number,
  rowIndex: number
): number | undefined {
  const search = state.currentSearch;
  if (!search) {
    return undefined;
  }

  const contentRow = rowIndex - 3;
  if (contentRow < 0) {
    return undefined;
  }

  const contentHeight = Math.max(1, height - 3);
  const scroll = getListScroll(state, contentHeight, width, false, true);
  let usedRows = 0;

  for (let index = scroll; index < state.items.length; index += 1) {
    const itemHeight = getListItemHeight(state.items[index], width, false, true);
    if (usedRows + itemHeight > contentHeight) {
      break;
    }
    if (contentRow >= usedRows && contentRow < usedRows + itemHeight) {
      return index;
    }
    usedRows += itemHeight;
  }

  return undefined;
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
  if (state.modal === "compose" && state.composeDialog) {
    return { text: drawComposeModal(baseLines, state, width, height) };
  }
  if (state.modal === "emotion-picker" && state.composeDialog) {
    return drawEmotionPickerModal(baseLines, state, width, height);
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
        ? styled(fit(text, width), `${theme.color.selectedBg}${theme.color.notice}${ansi.bold}`)
        : selectedLine(text, width, true));
    } else if (active) {
      rows.push(hasUnread
        ? styled(fit(text, width), `${theme.color.selectedBg}${theme.color.notice}${ansi.bold}`)
        : selectedLine(text, width, true));
    } else {
      const labelStyle = hasUnread ? textStyle.noticeBold : textStyle.primary;
      const hintStyle = hasUnread ? textStyle.notice : textStyle.muted;
      rows.push(`${labelStyle(label)}${hintStyle(fit(hint, Math.max(0, width - cellWidth(label))))}`);
    }
  }
  return rows;
}

function drawMain(state: TuiState, width: number, height: number): TopicDrawResult {
  if (state.mode === "topic") {
    return drawTopic(state, width, height);
  }

  if (state.currentFollowing) {
    return drawFollowing(state, width, height);
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

  const contentHeight = Math.max(1, height - 2);
  const wrapDetail = shouldWrapListDetail(state);
  const inlineDetail = shouldInlineListDetail(state);
  const scroll = getListScroll(state, contentHeight, width, wrapDetail, inlineDetail);
  const visible = getVisibleItems(state.items, scroll, contentHeight, width, wrapDetail, inlineDetail);
  visible.forEach(({ item: itemValue, index }) => {
    const itemHeight = getListItemHeight(itemValue, width, wrapDetail, inlineDetail);
    if (rows.length + itemHeight > height) {
      return;
    }
    const active = index === state.itemIndex && (state.focus === "content" || state.mode === "settings");
    const marker = active ? theme.marker.selected : theme.marker.normal;
    const title = fit(` ${marker} ${renderListItemTitle(itemValue, inlineDetail)}`, width);
    const isUnread = Boolean(itemValue.unread || ((itemValue.unreadCount ?? 0) > 0));
    rows.push(renderListTitleRow(title, width, active, state.focus === "content" || state.mode === "settings", isUnread));

    if (itemValue.meta) {
      rows.push(fit(textStyle.muted(`  ${itemValue.meta}`), width));
    }
    for (const detailLine of getListItemDetailLines(itemValue, width, wrapDetail, inlineDetail)) {
      rows.push(fit(textStyle.muted(`  ${detailLine}`), width));
    }
  });

  if (visible.length === 0) {
    rows.push(textStyle.muted(" 暂无数据"));
  }

  const lastVisibleIndex = visible.at(-1)?.index ?? scroll - 1;
  if (lastVisibleIndex < state.items.length - 1 && rows.length < height) {
    rows.push(fit(textStyle.muted(`  ↓ 还有 ${state.items.length - lastVisibleIndex - 1} 项`), width));
  } else if (state.currentFeed?.hasMore && rows.length < height) {
    rows.push(fit(textStyle.muted("  ↓ 到底自动继续加载，或按 n/Space"), width));
  }

  return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
}

function listItemTitle(itemValue: { title: string; detail?: string }, inlineDetail: boolean): string {
  if (!itemValue.detail || !inlineDetail) {
    return itemValue.title;
  }
  if ("topicId" in itemValue && itemValue.topicId !== undefined) {
    return itemValue.title;
  }
  return `${itemValue.title}  ${truncate(itemValue.detail, 80)}`;
}

function renderListItemTitle(itemValue: { title: string; detail?: string; unreadCount?: number }, inlineDetail: boolean): string {
  const base = listItemTitle(itemValue, inlineDetail);
  if (!itemValue.unreadCount || itemValue.unreadCount <= 0) {
    return base;
  }
  return `${base} ${textStyle.noticeBold(`(${itemValue.unreadCount})`)}`;
}

function renderListTitleRow(
  title: string,
  width: number,
  active: boolean,
  focused: boolean,
  isUnread: boolean
): string {
  if (active) {
    if (isUnread) {
      return styled(fit(title, width), `${theme.color.selectedBg}${theme.color.notice}${ansi.bold}`);
    }
    return selectedLine(title, width, focused);
  }
  if (isUnread) {
    return textStyle.noticeBold(title);
  }
  return textStyle.muted(title);
}

function getListItemHeight(
  itemValue: { meta?: string; detail?: string; topicId?: number },
  width: number,
  wrapDetail: boolean,
  inlineDetail: boolean
): number {
  return 1 + (itemValue.meta ? 1 : 0) + getListItemDetailLines(itemValue, width, wrapDetail, inlineDetail).length;
}

function getVisibleItems(
  items: ContentItem[],
  scroll: number,
  availableRows: number,
  width: number,
  wrapDetail: boolean,
  inlineDetail: boolean
): Array<{ item: ContentItem; index: number }> {
  const visible: Array<{ item: ContentItem; index: number }> = [];
  let usedRows = 0;

  for (let index = scroll; index < items.length; index += 1) {
    const item = items[index];
    const itemHeight = getListItemHeight(item, width, wrapDetail, inlineDetail);
    if (usedRows + itemHeight > availableRows) {
      break;
    }
    visible.push({ item, index });
    usedRows += itemHeight;
  }

  return visible;
}

function isListItemVisible(
  items: ContentItem[],
  scroll: number,
  itemIndex: number,
  availableRows: number,
  width: number,
  wrapDetail: boolean,
  inlineDetail: boolean
): boolean {
  if (itemIndex < scroll) {
    return false;
  }

  let usedRows = 0;
  for (let index = scroll; index <= itemIndex && index < items.length; index += 1) {
    usedRows += getListItemHeight(items[index], width, wrapDetail, inlineDetail);
    if (usedRows > availableRows) {
      return false;
    }
  }

  return true;
}

function getListScroll(
  state: TuiState,
  availableRows: number,
  width: number,
  wrapDetail: boolean,
  inlineDetail: boolean
): number {
  const maxScroll = Math.max(0, state.items.length - 1);
  const current = Math.min(Math.max(0, state.scroll), maxScroll);
  if (state.itemIndex < current) {
    return state.itemIndex;
  }

  if (!isListItemVisible(state.items, current, state.itemIndex, availableRows, width, wrapDetail, inlineDetail)) {
    let next = current;
    while (next < state.itemIndex && !isListItemVisible(state.items, next, state.itemIndex, availableRows, width, wrapDetail, inlineDetail)) {
      next += 1;
    }
    return next;
  }
  return current;
}

function drawSearch(state: TuiState, width: number, height: number): TopicDrawResult {
  const search = state.currentSearch;
  if (!search) {
    return { rows: blank(height, width), imageOverlays: [] };
  }

  const rows: string[] = [];
  rows.push(drawSearchHeader(state.viewTitle, search, width));

  const inputText = search.draft || "";
  const placeholder = inputText ? "" : "输入关键词后按 Enter";
  const inputLabel = ` 搜索${searchTabLabel(search.kind)}> ${inputText || placeholder}`;
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

  const contentHeight = Math.max(1, height - 3);
  const scroll = getListScroll(state, contentHeight, width, false, true);
  const visible = getVisibleItems(state.items, scroll, contentHeight, width, false, true);

  if (visible.length === 0) {
    rows.push(textStyle.muted(search.searched ? " 暂无搜索结果" : " 在输入框中输入关键词并按 Enter；上键切换搜索类型"));
    return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
  }

  visible.forEach(({ item: itemValue, index }) => {
    const itemHeight = getListItemHeight(itemValue, width, false, true);
    if (rows.length + itemHeight > height) {
      return;
    }
    const active = index === state.itemIndex && state.focus === "content" && search.focus === "results";
    const marker = active ? theme.marker.selected : theme.marker.normal;
    const title = fit(` ${marker} ${renderListItemTitle(itemValue, true)}`, width);
    rows.push(active ? selectedLine(title, width, true) : textStyle.muted(title));
    if (itemValue.meta) {
      rows.push(fit(textStyle.muted(`  ${itemValue.meta}`), width));
    }
  });

  const lastVisibleIndex = visible.at(-1)?.index ?? scroll - 1;
  if (lastVisibleIndex < state.items.length - 1 && rows.length < height) {
    rows.push(fit(textStyle.muted(`  ↓ 还有 ${state.items.length - lastVisibleIndex - 1} 项`), width));
  } else if (search.hasMore && rows.length < height) {
    rows.push(fit(textStyle.muted("  ↓ 到底自动继续加载，或按 n/Space"), width));
  }

  return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
}

function drawFollowing(state: TuiState, width: number, height: number): TopicDrawResult {
  const following = state.currentFollowing;
  if (!following) {
    return { rows: blank(height, width), imageOverlays: [] };
  }

  const rows: string[] = [];
  rows.push(drawFollowingHeader(state.viewTitle, following, width));
  rows.push(ruleLine(Math.max(0, width - 1)));

  if (state.loading) {
    rows.push(fit(textStyle.muted(` 正在读取关注${followingTabLabel(following.kind)}...`), width));
    return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
  }

  const contentHeight = Math.max(1, height - 2);
  const scroll = getListScroll(state, contentHeight, width, false, true);
  const visible = getVisibleItems(state.items, scroll, contentHeight, width, false, true);

  if (visible.length === 0) {
    rows.push(textStyle.muted(` 暂无关注${followingTabLabel(following.kind)}内容`));
    return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
  }

  visible.forEach(({ item: itemValue, index }) => {
    const itemHeight = getListItemHeight(itemValue, width, false, true);
    if (rows.length + itemHeight > height) {
      return;
    }
    const active = index === state.itemIndex && state.focus === "content" && following.focus === "results";
    const marker = active ? theme.marker.selected : theme.marker.normal;
    const title = fit(` ${marker} ${renderListItemTitle(itemValue, true)}`, width);
    rows.push(active ? selectedLine(title, width, true) : textStyle.muted(title));
    if (itemValue.meta) {
      rows.push(fit(textStyle.muted(`  ${itemValue.meta}`), width));
    }
  });

  const lastVisibleIndex = visible.at(-1)?.index ?? scroll - 1;
  if (lastVisibleIndex < state.items.length - 1 && rows.length < height) {
    rows.push(fit(textStyle.muted(`  ↓ 还有 ${state.items.length - lastVisibleIndex - 1} 项`), width));
  } else if (following.hasMore && rows.length < height) {
    rows.push(fit(textStyle.muted("  ↓ 到底自动继续加载，或按 n/Space"), width));
  }

  return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
}

function drawSearchHeader(title: string, search: NonNullable<TuiState["currentSearch"]>, width: number): string {
  const titleText = ` ${title}`;
  const tabs = searchKinds(search).map((entry) => drawSearchTab(searchTabLabel(entry, search), entry === search.kind));
  const tabsText = tabs.join(" ");
  return fit(`${textStyle.primaryBold(titleText)} ${tabsText}`, width);
}

function drawFollowingHeader(title: string, following: NonNullable<TuiState["currentFollowing"]>, width: number): string {
  const titleText = ` ${title}`;
  const tabs = ["board", "user", "favorite"].map((entry) =>
    drawSearchTab(followingTabLabel(entry as NonNullable<TuiState["currentFollowing"]>["kind"]), entry === following.kind)
  );
  return fit(`${textStyle.primaryBold(titleText)} ${tabs.join(" ")}`, width);
}

function drawSearchTab(label: string, active: boolean): string {
  const content = `[${label}]`;
  return active
    ? styled(content, `${theme.color.selectedBg}${theme.color.selectedFg}${ansi.bold}`)
    : styled(content, theme.color.textOnPrimary);
}

function searchKinds(search: NonNullable<TuiState["currentSearch"]>): NonNullable<TuiState["currentSearch"]>["kind"][] {
  return search.board ? ["topic", "board", "user", "board-topic"] : ["topic", "board", "user"];
}

function followingTabLabel(kind: NonNullable<TuiState["currentFollowing"]>["kind"]): string {
  switch (kind) {
    case "board":
      return "版面";
    case "user":
      return "用户";
    case "favorite":
      return "收藏";
  }
}

function searchTabLabel(kind: NonNullable<TuiState["currentSearch"]>["kind"], search?: NonNullable<TuiState["currentSearch"]>): string {
  switch (kind) {
    case "topic":
      return "主题";
    case "board":
      return "版面";
    case "user":
      return "用户";
    case "board-topic":
      return `版内：${search?.board?.title ?? ""}`;
  }
}

function getListItemDetailLines(
  itemValue: { detail?: string; topicId?: number },
  width: number,
  wrapDetail: boolean,
  inlineDetail: boolean
): string[] {
  if (!itemValue.detail || inlineDetail) {
    return [];
  }
  if ("topicId" in itemValue && itemValue.topicId !== undefined) {
    return [];
  }
  const detailWidth = Math.max(1, width - 2);
  if (!wrapDetail) {
    return [truncate(itemValue.detail, detailWidth)];
  }
  return wrapText(itemValue.detail, detailWidth);
}

function shouldWrapListDetail(state: TuiState): boolean {
  return Boolean(state.currentChat);
}

function shouldInlineListDetail(state: TuiState): boolean {
  return !shouldWrapListDetail(state);
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
  const visibleScroll = Math.min(state.scroll, maxScroll);
  const body = topic.lines.slice(visibleScroll, visibleScroll + viewport);

  for (let index = 0; index < body.length; index += 1) {
    const bodyLine = body[index] ?? "";
    const lineEntry = currentTopicLine(topic, visibleScroll + index);
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
  const hints = ["j/k 楼层", "↑↓ 逐行", "h← 返回", "l→ 进入", "Enter 确认"];
  if (state.currentChat) {
    hints.push("c 私信", "n 更多");
  }
  if (state.currentUser) {
    hints.push("a 关注", "n 更多");
  }
  if (state.currentFeed) {
    hints.push("n 更多");
  }
  if (state.mode === "topic") {
    hints.push("c 评论", "a 赞", "s 踩", "d 收藏", "u 用户页");
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
    " 全局",
    "   q           退出程序",
    "   ?           打开/关闭帮助",
    "   j/k         上下移动选择",
    "   ↑/↓         按行滚动或移动",
    "   h/←/Esc     返回上一层/左栏",
    "   l/→/Enter   进入/确认/执行",
    "   r           刷新当前视图",
    "   n/Space     加载更多",
    "",
    " 导航与列表",
    "   f           跳到搜索输入框",
    "   s           用户页中打开与对方私信",
    "   a           用户页中关注/取关",
    "   Tab         搜索/关注页切换焦点",
    "   i 或 /      搜索结果中回到输入框",
    "",
    " 搜索页",
    "   Tabs 焦点   h/l 或 ←/→ 切换类型",
    "   Input 焦点  Enter 执行搜索",
    "   Results     Enter 打开条目",
    "",
    " 关注页",
    "   Tabs 焦点   h/l 或 ←/→ 切换 关注/版面/用户/收藏",
    "   Results     Enter 打开条目",
    "",
    " 主题页",
    "   j/k         按楼层跳转",
    "   [/ ]        上一回复 / 下一回复",
    "   Alt+↑/↓     上一回复 / 下一回复",
    "   :数字Enter  跳转到指定楼层",
    "   c           默认打开评论框，可在 keymap 中改 compose.open",
    "   a / s / d   赞 / 踩 / 收藏",
    "   u           打开当前楼层作者用户页",
    "   Space       打开图片预览",
    "   ←/→         切换预览图片",
    "",
    " 私信与评论框",
    "   c           默认打开私信框，可在 keymap 中改 compose.open",
    "   Enter       发送",
    "   Shift+Enter 换行",
    "   Ctrl+A      打开表情选择器",
    "   Backspace   删除前一个字符",
    "   Tab         插入两个空格",
    "",
    " 表情选择器",
    "   ↑/↓/j/k     上下移动",
    "   ←/→/h/l     切换分类或表情",
    "   Enter       插入表情",
    "   Esc         关闭选择器",
    "",
    " 账号与确认弹窗",
    "   j/k         上下移动选择",
    "   Tab         登录框切换字段",
    "   Enter       选择 / 下一项 / 提交",
    "   Esc         返回或取消",
    "",
    " 其它",
    "   Space       主题页看图；列表页等同 n",
    "",
    " 按任意键关闭"
  ];
  const area = center(rect(width, height), 68, Math.min(height - 2, helpContent.length + 2));
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

function drawComposeModal(baseLines: string[], state: TuiState, width: number, height: number): string {
  const compose = state.composeDialog;
  if (!compose) {
    return baseLines.join("\n");
  }

  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);

  const modalWidth = Math.min(Math.max(1, width - 2), Math.max(36, Math.floor(width * 0.72)));
  const modalHeight = Math.min(Math.max(1, height - 2), Math.max(10, Math.min(height - 6, 14)));
  const area = center(rect(width, height), modalWidth, modalHeight);
  const innerWidth = Math.max(1, area.width - 2);
  const draftHeight = Math.max(3, area.height - 5);
  const contentWidth = Math.max(1, innerWidth - 1);
  const draftView = buildComposeDraftView(compose.draftUnits, compose.cursorIndex, contentWidth, draftHeight);
  const rows = [
    fit(
      `${textStyle.primaryBold(compose.target.kind === "chat" ? " 发送私信" : " 发表评论")}${textStyle.muted(` ${compose.submitting ? "正在发送..." : "Enter 发送  Shift+Enter 换行  表情快捷键打开表情  Esc 取消"}`)}`,
      innerWidth
    ),
    ruleLine(Math.max(0, innerWidth))
  ];

  for (let index = 0; index < draftHeight; index += 1) {
    const line = draftView.lines[index] ?? "";
    if (line) {
      rows.push(fit(` ${line}`, innerWidth));
    } else if (compose.draft.length === 0 && index === 0) {
      rows.push(textStyle.muted(fit(" 输入评论内容", innerWidth)));
    } else {
      rows.push(" ".repeat(innerWidth));
    }
  }

  canvas.overlay(area, rows, { fill: theme.color.panelBg });
  return canvas.toString();
}

function buildComposeDraftView(
  draftUnits: string[],
  cursorIndex: number,
  width: number,
  viewportHeight: number
): { lines: string[] } {
  const logicalLines = splitComposeUnitsByNewline(draftUnits);
  const visualLines: string[] = [];
  let offset = 0;
  let cursorRow = 0;

  logicalLines.forEach((logicalLine, logicalIndex) => {
    const wrapped = wrapComposeLine(logicalLine, width);
    let segmentOffset = 0;
    wrapped.forEach((segment) => {
      const segmentStart = segmentOffset;
      const segmentEnd = segmentStart + segment.length;
      const hasCursor = cursorIndex >= offset + segmentStart && cursorIndex <= offset + segmentEnd;
      if (hasCursor) {
        cursorRow = visualLines.length;
      }
      visualLines.push(renderComposeCursor(
        segment,
        hasCursor ? cursorIndex - offset - segmentStart : undefined
      ));
      segmentOffset += segment.length;
    });

    offset += logicalLine.length;
    if (logicalIndex < logicalLines.length - 1) {
      if (cursorIndex === offset) {
        cursorRow = visualLines.length;
      }
      offset += 1;
    }
  });

  if (visualLines.length === 0) {
    visualLines.push(renderComposeCursor([], 0));
    cursorRow = 0;
  } else if (cursorIndex === draftUnits.length && draftUnits.at(-1) === "\n") {
    cursorRow = visualLines.length;
    visualLines.push(renderComposeCursor([], 0));
  }

  const start = Math.max(0, Math.min(cursorRow, Math.max(0, visualLines.length - viewportHeight)));
  const lines = visualLines.slice(start, start + viewportHeight);
  while (lines.length < viewportHeight) {
    lines.push("");
  }
  return { lines };
}

function splitComposeUnitsByNewline(units: string[]): string[][] {
  if (units.length === 0) {
    return [[]];
  }

  const lines: string[][] = [[]];
  for (const unit of units) {
    if (unit === "\n") {
      lines.push([]);
      continue;
    }
    lines[lines.length - 1]?.push(unit);
  }
  return lines;
}

function wrapComposeLine(units: string[], width: number): string[][] {
  if (units.length === 0) {
    return [[]];
  }

  const lines: string[][] = [];
  let current: string[] = [];
  let currentWidth = 0;
  for (const unit of units) {
    const unitWidth = cellWidth(unit);
    if (currentWidth + unitWidth > width && current.length > 0) {
      lines.push(current);
      current = [unit];
      currentWidth = unitWidth;
    } else {
      current.push(unit);
      currentWidth += unitWidth;
    }
  }
  lines.push(current);
  return lines;
}

function renderComposeCursor(units: string[], cursorColumn?: number): string {
  if (cursorColumn === undefined) {
    return units.join("");
  }
  const safeIndex = Math.max(0, Math.min(units.length, cursorColumn));
  const cursorStyle = `${theme.color.emotionSelectedBorder}`;
  const cursorGlyph = styled("|", cursorStyle);
  if (safeIndex === units.length) {
    return `${units.join("")}${cursorGlyph}`;
  }
  return `${units.slice(0, safeIndex).join("")}${cursorGlyph}${units.slice(safeIndex).join("")}`;
}

function drawEmotionPickerModal(baseLines: string[], state: TuiState, width: number, height: number): TerminalFrame {
  const compose = state.composeDialog;
  if (!compose) {
    return { text: baseLines.join("\n") };
  }

  const composeLayer = drawComposeModal(baseLines, state, width, height).split("\n");
  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), composeLayer);

  const modalWidth = Math.min(Math.max(1, width - 2), Math.max(56, Math.floor(width * 0.78)));
  const modalHeight = Math.min(Math.max(1, height - 2), Math.max(18, Math.floor(height * 0.72)));
  const area = center(rect(width, height), modalWidth, modalHeight);
  canvas.overlay(area, [], { fill: theme.color.panelBg });

  const inner = pad(area, 1);
  const cellWidthValue = 11;
  const cellHeight = 5;
  const sidebarWidth = Math.max(8, Math.min(12, Math.floor(inner.width * 0.2)));
  const gridArea = {
    x: inner.x + sidebarWidth + 1,
    y: inner.y,
    width: Math.max(1, inner.width - sidebarWidth - 1),
    height: inner.height
  };
  const columns = Math.max(1, Math.floor(gridArea.width / cellWidthValue));
  const previewColumns = Math.max(1, cellWidthValue - 2);
  const sidebarArea = {
    x: inner.x,
    y: inner.y,
    width: sidebarWidth,
    height: inner.height
  };
  const category = getEmotionCategory(compose.emotionCategoryIndex);
  const pageRows = Math.max(1, Math.floor(Math.max(1, gridArea.height - 1) / cellHeight));
  const pageSize = columns * pageRows;
  const start = Math.max(0, Math.floor(compose.emotionSelectedIndex / pageSize) * pageSize);
  const visible = category.entries.slice(start, start + pageSize);
  const imageOverlays: TerminalImageOverlay[] = [];

  const sidebarRows = emotionCategories.map((item, index) => {
    const selected = index === compose.emotionCategoryIndex;
    const row = fit(` ${item.label}`, sidebarArea.width);
    if (selected) {
      return selectedLine(row, sidebarArea.width, true);
    }
    return textStyle.muted(row);
  });
  canvas.drawLines(sidebarArea, sidebarRows.concat(blank(Math.max(0, sidebarArea.height - sidebarRows.length), sidebarArea.width)));
  canvas.verticalRule({ x: inner.x + sidebarWidth, y: inner.y, width: 1, height: inner.height });

  const title = fit(textStyle.primaryBold(` ${category.label} · ${visible.length}/${category.entries.length}`), gridArea.width);
  canvas.drawLines({ x: gridArea.x, y: gridArea.y, width: gridArea.width, height: 1 }, [title]);

  visible.forEach((entry, index) => {
    const localIndex = start + index;
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = gridArea.x + col * cellWidthValue;
    const y = gridArea.y + 1 + row * cellHeight;
    if (x + cellWidthValue > gridArea.x + gridArea.width || y + cellHeight > gridArea.y + gridArea.height) {
      return;
    }

    const selected = localIndex === compose.emotionSelectedIndex;
    const borderStyle = selected ? theme.color.emotionSelectedBorder : theme.color.muted;
    const box = { x, y, width: cellWidthValue, height: cellHeight };
    canvas.frame(box);

    const preview = getEmotionPreview(entry, previewColumns);
    if (preview) {
      imageOverlays.push({
        row: y + 2,
        column: x + 2,
        token: preview.token
      });
    } else {
      canvas.drawLines(
        { x: x + 1, y: y + 1, width: cellWidthValue - 2, height: 2 },
        [
          fit(selected ? textStyle.primarySoft(" 预览中") : textStyle.muted(" 预览中"), cellWidthValue - 2),
          " ".repeat(cellWidthValue - 2)
        ]
      );
    }

    if (selected) {
      tintBox(canvas, box, theme.color.emotionSelectedBorder);
    } else {
      tintBox(canvas, box, borderStyle);
    }
  });

  return {
    text: canvas.toString(),
    imageOverlays
  };
}

function tintBox(canvas: Canvas, area: { x: number; y: number; width: number; height: number }, style: string): void {
  canvas.drawLines(
    { x: area.x, y: area.y, width: area.width, height: 1 },
    [textStyleWithStyle(`${theme.border.topLeft}${theme.border.horizontal.repeat(Math.max(0, area.width - 2))}${theme.border.topRight}`, style)]
  );
  for (let row = 1; row < area.height - 1; row += 1) {
    canvas.drawLines({ x: area.x, y: area.y + row, width: 1, height: 1 }, [textStyleWithStyle(theme.border.vertical, style)]);
    canvas.drawLines({ x: area.x + area.width - 1, y: area.y + row, width: 1, height: 1 }, [textStyleWithStyle(theme.border.vertical, style)]);
  }
  canvas.drawLines(
    { x: area.x, y: area.y + area.height - 1, width: area.width, height: 1 },
    [textStyleWithStyle(`${theme.border.bottomLeft}${theme.border.horizontal.repeat(Math.max(0, area.width - 2))}${theme.border.bottomRight}`, style)]
  );
}

function textStyleWithStyle(content: string, style: string): string {
  return `${style}${content}\x1b[0m`;
}
