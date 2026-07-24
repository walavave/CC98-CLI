import type { TuiConfig } from "../../config.js";
import { imagePreviewRows } from "../media/image-preview.js";
import { blank, cellWidth, fit, truncate, wrapText } from "../render-core/text.js";
import {
  genderStyled,
  noticeLineStyle,
  ruleLine,
  selectedLine,
  selectedLineStyle,
  styled,
  textStyle,
  theme
} from "../render-core/theme.js";
import {
  currentTopicLine,
  getStatus,
  type ContentItem,
  type TuiState
} from "../tui-model.js";
import { getRenderedTopicVisibleScroll } from "../topic-scroll.js";

export interface TopicDrawResult {
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
  const headerRows = state.currentBoardDirectory ? 3 : 2;
  const contentRow = rowIndex - headerRows;
  if (contentRow < 0) {
    return undefined;
  }

  const wrapDetail = shouldWrapListDetail(state);
  const inlineDetail = shouldInlineListDetail(state);
  const contentHeight = Math.max(1, height - headerRows);
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

export function drawMain(state: TuiState, width: number, height: number, config: TuiConfig): TopicDrawResult {
  if (state.mode === "topic") {
    return drawTopic(state, width, height, config);
  }

  if (state.currentFollowing) {
    return drawFollowing(state, width, height);
  }

  if (state.currentSearch) {
    return drawSearch(state, width, height);
  }

  if (state.currentBoardDirectory) {
    return drawBoardDirectory(state, width, height);
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
  const imageOverlays: Array<{ row: number; token: string }> = [];
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
    if (itemValue.chatContent) {
      const cc = itemValue.chatContent;
      for (let li = 0; li < cc.lines.length; li += 1) {
        const renderedLine = cc.lines[li];
        if (renderedLine.startsWith("[image ")) {
          const imgMatch = /\[image (\d+)/.exec(renderedLine);
          const imgIndex = imgMatch ? Number(imgMatch[1]) : undefined;
          const preview = imgIndex ? cc.previews[imgIndex - 1] : undefined;
          const imageRows = Math.max(1, preview?.rows ?? 1);
          if (preview && preview.token) {
            imageOverlays.push({ row: rows.length, token: preview.token });
            for (let r = 0; r < imageRows; r += 1) {
              rows.push(fit(textStyle.muted(`  `), width));
            }
          } else {
            rows.push(fit(textStyle.primarySoft(`  ${renderedLine}`), width));
          }
          // Skip filler blank lines from imageBlock padding
          while (li + 1 < cc.lines.length && cc.lines[li + 1].trim() === "") {
            li += 1;
          }
        } else {
          rows.push(fit(textStyle.muted(`  ${renderedLine}`), width));
        }
      }
    } else {
      for (const detailLine of getListItemDetailLines(itemValue, width, wrapDetail, inlineDetail)) {
        rows.push(fit(textStyle.muted(`  ${detailLine}`), width));
      }
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

  return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays };
}

function drawBoardDirectory(state: TuiState, width: number, height: number): TopicDrawResult {
  const directory = state.currentBoardDirectory;
  if (!directory) return { rows: blank(height, width), imageOverlays: [] };

  const rows = [textStyle.primaryBold(` ${state.viewTitle}`)];
  const active = directory.sectionIndex;
  const tabs = visibleBoardSectionIndexes(directory, width)
    .map((index) => drawSearchTab(directory.sections[index]?.title ?? "", index === active));
  rows.push(fit(` ${tabs.join(" ")}`, width));
  rows.push(ruleLine(Math.max(0, width - 1)));

  const contentHeight = Math.max(1, height - 3);
  const scroll = getListScroll(state, contentHeight, width, false, true);
  const visible = getVisibleItems(state.items, scroll, contentHeight, width, false, true);
  for (const { item, index } of visible) {
    const isActive = index === state.itemIndex && state.focus === "content" && directory.focus === "results";
    const marker = isActive ? theme.marker.selected : theme.marker.normal;
    const title = fit(` ${marker} ${renderListItemTitle(item, true)}`, width);
    rows.push(isActive ? selectedLine(title, width, true) : textStyle.muted(title));
    if (item.meta) rows.push(fit(textStyle.muted(`  ${item.meta}`), width));
  }
  if (visible.length === 0) rows.push(textStyle.muted(" 暂无版面"));
  const lastVisibleIndex = visible.at(-1)?.index ?? scroll - 1;
  if (lastVisibleIndex < state.items.length - 1 && rows.length < height) {
    rows.push(fit(textStyle.muted(`  ↓ 还有 ${state.items.length - lastVisibleIndex - 1} 项`), width));
  }
  return { rows: rows.concat(blank(height - rows.length, width)).slice(0, height), imageOverlays: [] };
}

export function visibleBoardSectionIndexes(
  directory: NonNullable<TuiState["currentBoardDirectory"]>,
  width: number
): number[] {
  if (directory.sections.length === 0) return [];
  const tabWidth = (index: number) => cellWidth(`[${directory.sections[index]?.title ?? ""}]`) + 1;
  const available = Math.max(1, width - 1);
  let start = Math.min(directory.sectionIndex, directory.sections.length - 1);
  let end = start;
  let used = tabWidth(start);
  while (start > 0 && used + tabWidth(start - 1) <= available) {
    start -= 1;
    used += tabWidth(start);
  }
  while (end + 1 < directory.sections.length && used + tabWidth(end + 1) <= available) {
    end += 1;
    used += tabWidth(end);
  }
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

export function drawStatusBar(state: TuiState, width: number): string {
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

function drawTopic(state: TuiState, width: number, height: number, config: TuiConfig): TopicDrawResult {
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
  const visibleScroll = getRenderedTopicVisibleScroll(state, viewport, config);
  const body = topic.lines.slice(visibleScroll, visibleScroll + viewport);

  for (let index = 0; index < body.length; index += 1) {
    const bodyLine = body[index] ?? "";
    const lineEntry = currentTopicLine(topic, visibleScroll + index);
    const isCurrentLine = visibleScroll + index === state.scroll;
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
    } else if (lineEntry?.kind === "vote-option") {
      rows.push(isCurrentLine
        ? selectedLine(bodyLine, width, true)
        : topicBodyLine(bodyLine, width, topic.vote?.selectedItems.includes(lineEntry.voteOptionId ?? -1) ? textStyle.primarySoftBold : undefined));
    } else if (lineEntry?.kind === "vote-action") {
      rows.push(isCurrentLine
        ? selectedLine(bodyLine, width, true)
        : topicBodyLine(bodyLine, width, textStyle.primary));
    } else if (lineEntry?.kind === "vote-info") {
      rows.push(topicBodyLine(bodyLine, width, textStyle.muted));
    } else if (lineEntry?.kind === "rating") {
      rows.push(topicBodyLine(bodyLine, width, textStyle.notice));
    } else if (bodyLine.startsWith("[image ")) {
      rows.push(topicBodyLine(bodyLine, width, textStyle.primarySoft));
    } else if (bodyLine.startsWith(theme.quote.prefix)) {
      rows.push(topicBodyLine(bodyLine, width, textStyle.muted));
    } else if (/^#\d+ /.test(bodyLine)) {
      const headerStyle = lineEntry?.isHot ? textStyle.hot : textStyle.ok;
      rows.push(topicBodyLine(bodyLine, width, headerStyle));
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
  const content = fit(title, width);
  if (active) {
    const style = isUnread ? noticeLineStyle() : selectedLineStyle(focused);
    return genderStyled(content, style);
  }
  if (isUnread) {
    return genderStyled(content, noticeLineStyle());
  }
  return genderStyled(content, theme.color.muted);
}

/** Compute the rendered row count for a chat content block, accounting for image preview expansion. */
function computeChatContentHeight(cc: { lines: string[]; previews: Array<{ rows?: number } | undefined> }): number {
  let h = 0;
  for (let li = 0; li < cc.lines.length; li += 1) {
    const line = cc.lines[li];
    if (line.startsWith("[image ")) {
      const m = /\[image (\d+)/.exec(line);
      const idx = m ? Number(m[1]) : undefined;
      const pv = idx ? cc.previews[idx - 1] : undefined;
      h += Math.max(1, pv?.rows ?? 1);
      // Skip filler blank lines from imageBlock padding
      while (li + 1 < cc.lines.length && cc.lines[li + 1].trim() === "") {
        li += 1;
      }
    } else {
      h += 1;
    }
  }
  return h;
}

function getListItemHeight(
  itemValue: { meta?: string; detail?: string; topicId?: number; chatContent?: { lines: string[]; previews: Array<{ rows?: number } | undefined> } },
  width: number,
  wrapDetail: boolean,
  inlineDetail: boolean
): number {
  const detailHeight = itemValue.chatContent
    ? computeChatContentHeight(itemValue.chatContent)
    : getListItemDetailLines(itemValue, width, wrapDetail, inlineDetail).length;
  return 1 + (itemValue.meta ? 1 : 0) + detailHeight;
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

function drawSearchHeader(title: string, search: NonNullable<TuiState["currentSearch"]>, width: number): string {
  const titleText = ` ${title}`;
  const tabs = searchKinds(search).map((entry) => drawSearchTab(searchTabLabel(entry, search), entry === search.kind));
  return fit(`${textStyle.primaryBold(titleText)} ${tabs.join(" ")}`, width);
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
    ? styled(content, selectedLineStyle(true))
    : textStyle.onPrimary(content);
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
      return `版内：${search?.board?.title ?? `#${search?.board?.boardId ?? ""}`}`;
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
    hints.push("c 评论", "C 引用评", "a 赞", "s 踩", "d 收藏", "u 用户页", "z 进版", "x 复制链接");
    if (state.topic?.vote) {
      hints.push("Enter 投票操作");
    }
  }
  hints.push("f 搜索", "r 刷新", "? 帮助", "q 退出");
  return hints.join(" ");
}
