import { spawn } from "node:child_process";
import { downloadUrlToDownloads } from "../media/downloads.js";
import { extractFirstHttpUrl, isDownloadLikeUrl, parseCc98TopicLink, shortUrl } from "../link.js";
import { fill, length, pad, rect, split } from "../render-core/layout.js";
import { getRenderedListItemIndexAtRow, getRenderedSearchItemIndexAtRow, getSidebarWidth } from "../renderer.js";
import { cellWidth } from "../render-core/text.js";
import { getStatus, navItems, settingsItems } from "../tui-model.js";
import type { MouseEvent } from "../render-core/terminal.js";
import type { RuntimeContext } from "./context.js";
import { jumpToTopicFloor, openTopic } from "../data/topic.js";
import { loadFollowingKind, switchFollowingKind } from "../data/following.js";
import { switchSearchKind } from "../data/search.js";
import { enterContentMode, showNotification } from "./state.js";

export async function handleTopicClick(
  context: RuntimeContext,
  event: MouseEvent,
  columns: number,
  rows: number
): Promise<void> {
  const { state, render } = context;
  if (state.mode !== "topic" || !state.topic || state.loading || state.error) {
    return;
  }

  const mainArea = getMainAreaRect(columns, rows, context.config, state.sidebarWidth);
  if (!withinRect(event.column, event.row, mainArea)) {
    return;
  }

  const bodyRow = event.row - (mainArea.y + 1);
  const bodyLineIndex = bodyRow - 3;
  if (bodyLineIndex < 0) {
    return;
  }

  const absoluteLine = state.scroll + bodyLineIndex;
  const lineEntry = state.topic.posts
    .flatMap((post) => post.lines)
    .find((entry) => entry.line === absoluteLine);
  const url = lineEntry?.linkUrl ?? extractFirstHttpUrl(lineEntry?.text) ?? lineEntry?.imageUrl;
  if (!url) {
    return;
  }

  const cc98Topic = parseCc98TopicLink(url);
  if (cc98Topic) {
    if (state.topic?.topicId === cc98Topic.topicId && cc98Topic.floor !== undefined) {
      state.status = `正在跳转到 ${cc98Topic.floor} 楼...`;
      render();
      await jumpToTopicFloor(context.client, state, cc98Topic.floor, render, context.config, context.nextSignal());
      return;
    }
    context.abortCurrent();
    state.status = `正在打开帖子 #${cc98Topic.topicId}...`;
    render();
    await openTopic(context.client, state, cc98Topic.topicId, render, context.config, true, context.nextSignal());
    if (cc98Topic.floor !== undefined) {
      await jumpToTopicFloor(context.client, state, cc98Topic.floor, render, context.config, context.nextSignal());
    }
    return;
  }

  if (!isDownloadLikeUrl(url)) {
    state.status = `正在打开 ${shortUrl(url)}...`;
    render();

    try {
      await openExternalUrl(url);
      showNotification(state, `已在浏览器打开 ${shortUrl(url)}`);
    } catch (error) {
      state.status = error instanceof Error ? error.message : "打开失败";
    } finally {
      render();
    }
    return;
  }

  state.status = `正在下载 ${shortUrl(url)}...`;
  render();

  try {
    const savedPath = await downloadUrlToDownloads(url);
    showNotification(state, `已下载到 ${savedPath}`);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "下载失败";
  } finally {
    render();
  }
}

async function openExternalUrl(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await runCommand("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await runCommand("cmd", ["/c", "start", "", url]);
    return;
  }
  await runCommand("xdg-open", [url]);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

export function handleSidebarClick(
  context: RuntimeContext,
  event: MouseEvent,
  columns: number,
  rows: number
): boolean {
  const { state, render, load, abortCurrent } = context;
  if (state.mode === "topic") {
    return false;
  }

  const sidebarArea = getSidebarAreaRect(columns, rows, context.config, state.sidebarWidth);
  if (sidebarArea.width <= 0 || !withinRect(event.column, event.row, sidebarArea)) {
    return false;
  }

  const rowIndex = event.row - (sidebarArea.y + 1);
  if (rowIndex < 0 || rowIndex >= navItems.length) {
    return true;
  }

  const nextNavIndex = Math.max(0, Math.min(navItems.length - 1, rowIndex));
  if (state.navIndex === nextNavIndex && state.focus === "nav" && state.mode !== "settings") {
    return true;
  }

  abortCurrent();
  state.navIndex = nextNavIndex;
  state.focus = "nav";
  if (state.mode === "settings") {
    state.mode = "list";
  }
  state.status = getStatus(state);
  render();
  void load();
  return true;
}

export function handleContentClick(
  context: RuntimeContext,
  event: MouseEvent,
  columns: number,
  rows: number
): boolean {
  const { state, render } = context;
  if (state.mode === "topic" || state.loading || state.error) {
    return false;
  }

  const mainArea = getMainAreaRect(columns, rows, context.config, state.sidebarWidth);
  if (!withinRect(event.column, event.row, mainArea)) {
    return false;
  }

  if (navItems[state.navIndex]?.id === "settings" && state.mode !== "settings") {
    state.mode = "settings";
  }

  if (state.mode === "settings") {
    const rowIndex = event.row - (mainArea.y + 1) - 2;
    if (rowIndex < 0 || rowIndex >= settingsItems.length) {
      return true;
    }
    state.itemIndex = rowIndex;
    enterContentMode(state);
    render();
    return true;
  }

  if (state.currentSearch) {
    const rowIndex = event.row - (mainArea.y + 1);
    if (rowIndex === 0) {
      const kind = getSearchKindAtColumn(state.currentSearch, event.column - (mainArea.x + 1));
      if (kind) {
        switchSearchKind(state, kind);
        enterContentMode(state);
        render();
      }
      return true;
    }
    if (rowIndex === 1) {
      state.currentSearch.focus = "input";
      enterContentMode(state);
      render();
      return true;
    }
    if (rowIndex < 3) {
      return true;
    }
    const itemIndex = getRenderedSearchItemIndexAtRow(state, mainArea.width, mainArea.height, rowIndex);
    if (itemIndex === undefined) {
      return true;
    }
    state.itemIndex = itemIndex;
    state.currentSearch.focus = "results";
    enterContentMode(state);
    render();
    return true;
  }

  if (state.currentFollowing) {
    const rowIndex = event.row - (mainArea.y + 1);
    if (rowIndex === 0) {
      const kind = getFollowingKindAtColumn(state.currentFollowing, event.column - (mainArea.x + 1));
      if (kind) {
        if (switchFollowingKind(state, kind)) {
          render();
          void loadFollowingKind(context.client, state, render, kind, false, context.nextSignal());
        } else {
          state.currentFollowing.focus = "tabs";
          enterContentMode(state);
          render();
        }
      }
      return true;
    }
    if (rowIndex < 2) {
      return true;
    }
    const itemIndex = getRenderedListItemIndexAtRow(state, mainArea.width, mainArea.height, rowIndex);
    if (itemIndex === undefined) {
      return true;
    }
    state.itemIndex = itemIndex;
    state.currentFollowing.focus = "results";
    enterContentMode(state);
    render();
    return true;
  }

  const rowIndex = event.row - (mainArea.y + 1) - 2;
  if (rowIndex < 0) {
    return true;
  }

  const itemIndex = getRenderedListItemIndexAtRow(state, mainArea.width, mainArea.height, rowIndex + 2);
  if (itemIndex === undefined) {
    return true;
  }

  state.itemIndex = itemIndex;
  enterContentMode(state);
  render();
  return true;
}

function getMainAreaRect(
  columns: number,
  rows: number,
  config: RuntimeContext["config"],
  sidebarWidthOverride?: number
): { x: number; y: number; width: number; height: number } {
  const { mainArea } = getBodyColumnRects(columns, rows, config, sidebarWidthOverride);
  return mainArea;
}

function getSidebarAreaRect(
  columns: number,
  rows: number,
  config: RuntimeContext["config"],
  sidebarWidthOverride?: number
): { x: number; y: number; width: number; height: number } {
  const { sidebarArea } = getBodyColumnRects(columns, rows, config, sidebarWidthOverride);
  return sidebarArea;
}

function getBodyColumnRects(
  columns: number,
  rows: number,
  config: RuntimeContext["config"],
  sidebarWidthOverride?: number
): {
  sidebarArea: { x: number; y: number; width: number; height: number };
  mainArea: { x: number; y: number; width: number; height: number };
} {
  const width = Math.max(1, columns);
  const height = Math.max(1, rows);
  const outer = rect(width, Math.max(0, height - 1));
  const root = pad(outer, 1);
  const verticalLayout = config.hideTopChrome
    ? [fill()]
    : [length(1), length(1), length(1), length(1), fill()];
  const areas = split(root, "vertical", verticalLayout);
  const bodyArea = config.hideTopChrome ? areas[0] : areas[4];
  const sidebarWidth = getSidebarWidth(width, sidebarWidthOverride);
  const bodyColumns = split(bodyArea, "horizontal", [
    length(sidebarWidth),
    length(sidebarWidth > 0 ? 1 : 0),
    fill()
  ]);
  return {
    sidebarArea: bodyColumns[0],
    mainArea: bodyColumns[2]
  };
}

function withinRect(column: number, row: number, area: { x: number; y: number; width: number; height: number }): boolean {
  const x = column - 1;
  const y = row - 1;
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

function getSearchKindAtColumn(
  search: NonNullable<RuntimeContext["state"]["currentSearch"]>,
  zeroBasedColumn: number
): "topic" | "board" | "user" | "board-topic" | undefined {
  const tabs = [
    { kind: "topic" as const, label: "[主题]" },
    { kind: "board" as const, label: "[版面]" },
    { kind: "user" as const, label: "[用户]" },
    ...(search.board ? [{ kind: "board-topic" as const, label: `[版内：${search.board.title}]` }] : [])
  ];
  const start = cellWidth(` ${search.title} `);
  if (zeroBasedColumn < start) {
    return undefined;
  }

  let cursor = start;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    const end = cursor + cellWidth(tab.label);
    if (zeroBasedColumn >= cursor && zeroBasedColumn < end) {
      return tab.kind;
    }
    cursor = end + 1;
  }

  return undefined;
}

function getFollowingKindAtColumn(
  following: NonNullable<RuntimeContext["state"]["currentFollowing"]>,
  zeroBasedColumn: number
): "board" | "user" | "favorite" | undefined {
  const tabs = [
    { kind: "board" as const, label: "[版面]" },
    { kind: "user" as const, label: "[用户]" },
    { kind: "favorite" as const, label: "[收藏]" }
  ];
  const start = cellWidth(` ${following.title} `);
  if (zeroBasedColumn < start) {
    return undefined;
  }

  let cursor = start;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    const end = cursor + cellWidth(tab.label);
    if (zeroBasedColumn >= cursor && zeroBasedColumn < end) {
      return tab.kind;
    }
    cursor = end + 1;
  }
  return undefined;
}
