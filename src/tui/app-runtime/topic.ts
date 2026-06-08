import { spawn } from "node:child_process";
import type { TuiConfig } from "../../config.js";
import { openBoard, openUserProfile } from "../data/content.js";
import { jumpRelativeTopicFloor, jumpToTopicFloor, loadNextTopicPage, openTopic } from "../data/topic.js";
import { currentTopicPost, getStatus, type TuiState } from "../tui-model.js";
import type { RuntimeContext } from "./context.js";
import { openTopicImageViewer, stepTopicImageViewer } from "./image-viewer.js";
import { openComposeModal } from "./modals.js";
import { leaveTopicMode, showNotification } from "./state.js";

export function handleTopicMode(context: RuntimeContext, key: string, keyAction: string | undefined): void {
  const { state, render, client, config, nextSignal, abortCurrent } = context;
  if (keyAction === "compose.open" && !state.topic?.floorInput) {
    openComposeModal(context);
    return;
  }
  if (key === "C" && !state.topic?.floorInput) {
    openComposeQuoteModal(context);
    return;
  }
  if (key === ":" && state.topic && !state.topic.floorInput) {
    state.topic.floorInput = ":";
    state.status = "跳转到楼层：输入数字后 Enter 确认  Esc 取消";
    render();
    return;
  }
  if (/^\d$/.test(key) && state.topic?.floorInput.startsWith(":")) {
    if (state.topic.floorInput === ":" && key === "0") {
      return;
    }
    state.topic.floorInput = `${state.topic.floorInput}${key}`.slice(0, 7);
    state.status = `跳转到 ${state.topic.floorInput.slice(1)} 楼：Enter 确认  Esc 取消`;
    render();
    return;
  }
  if (key === "\x7f" && state.topic?.floorInput) {
    state.topic.floorInput = state.topic.floorInput.slice(0, -1);
    state.status = state.topic.floorInput
      ? state.topic.floorInput === ":"
        ? "跳转到楼层：输入数字后 Enter 确认  Esc 取消"
        : `跳转到 ${state.topic.floorInput.slice(1)} 楼：Enter 确认  Esc 取消`
      : getStatus(state);
    render();
    return;
  }
  if (key === "\r" && state.topic?.floorInput) {
    const floor = Number(state.topic.floorInput.slice(1));
    state.topic.floorInput = "";
    if (Number.isInteger(floor) && floor > 0) {
      void jumpToTopicFloor(client, state, floor, render, config, nextSignal());
    } else {
      state.status = getStatus(state);
      render();
    }
    return;
  }
  if ((key === "]" || key === "】" || keyAction === "topic.next-reply") && state.topic) {
    jumpRelativeTopicFloor(state, 1);
    state.status = getStatus(state);
    render();
    return;
  }
  if ((key === "[" || key === "【" || keyAction === "topic.previous-reply") && state.topic) {
    jumpRelativeTopicFloor(state, -1);
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "z") {
    void openCurrentTopicBoard(context);
    return;
  }
  if (keyAction === "topic.like-post") {
    void reactToCurrentTopicPost(context, true);
    return;
  }
  if (key === "x") {
    void copyCurrentTopicLink(context);
    return;
  }
  if (keyAction === "topic.dislike-post") {
    void reactToCurrentTopicPost(context, false);
    return;
  }
  if (key === "d" || keyAction === "topic.favorite-topic") {
    void toggleCurrentTopicFavorite(context);
    return;
  }
  if (key === "u") {
    void openCurrentPostUserProfile(context);
    return;
  }
  if (key === "h" || key === "\x1b[D") {
    abortCurrent();
    leaveTopicMode(state);
    render();
    return;
  }
  if (key === "\x1b" && state.topic?.floorInput) {
    state.topic.floorInput = "";
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "j") {
    const wasAtEnd = isAtTopicEnd(state, config, context.getSize().rows);
    jumpRelativeTopicFloor(state, 1);
    state.status = getStatus(state);
    render();
    if (wasAtEnd && state.topic?.hasMore && !state.loadingMore) {
      void loadNextTopicPage(client, state, render, config, nextSignal(), true);
    }
    return;
  }
  if (key === "k") {
    jumpRelativeTopicFloor(state, -1);
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "\x1b[B") {
    const maxScroll = Math.max(0, (state.topic?.lines.length ?? 0) - 1);
    state.scroll = Math.min(maxScroll, state.scroll + 1);
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "\x1b[A") {
    state.scroll = Math.max(0, state.scroll - 1);
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === " ") {
    void openTopicImageViewer(context);
    return;
  }
  if (key === "n") {
    void loadNextTopicPage(client, state, render, config, nextSignal());
    return;
  }
  if (key === "\x1b[C") {
    void stepTopicImageViewer(context, 1);
    return;
  }
  if (key === "r" && state.topic) {
    void openTopic(client, state, state.topic.topicId, render, config, true, nextSignal(), state.topic.board, false);
  }
}

function openComposeQuoteModal(context: RuntimeContext): void {
  const { state, render } = context;
  const topic = state.topic;
  if (!topic) {
    return;
  }

  const post = currentTopicPost(topic, state.scroll);
  if (!post) {
    state.status = "当前楼层没有可引用的内容";
    render();
    return;
  }

  openComposeModal(context, {
    initialDraft: buildQuotedReplyDraft(topic.topicId, post)
  });
}

function buildQuotedReplyDraft(topicId: number, post: NonNullable<TuiState["topic"]>["posts"][number]): string {
  const floor = post.floor ?? "?";
  const time = post.rawTime || post.time;
  const url = buildQuotedPostUrl(topicId, post.floor);
  return `[quote][b]以下是引用${floor}楼：用户${post.author}在${time}的发言：[color=blue][url=${url}]>>查看原帖<<[/url][/color][/b]
${post.rawContent}[/quote]`;
}

function buildQuotedPostUrl(topicId: number, floor: number | undefined): string {
  if (!floor || floor <= 0) {
    return `/topic/${topicId}`;
  }
  if (floor <= 10) {
    return `/topic/${topicId}#${floor}`;
  }

  const page = Math.floor((floor - 1) / 10) + 1;
  const anchorFloor = floor % 10 || 10;
  return `/topic/${topicId}/${page}#${anchorFloor}`;
}

export function isAtTopicEnd(state: TuiState, config: TuiConfig, totalRows: number): boolean {
  if (!state.topic) {
    return false;
  }
  const viewport = getTopicViewportHeight(config, totalRows);
  if (viewport <= 0) {
    return state.scroll >= Math.max(0, state.topic.lines.length - 1);
  }
  return state.scroll + viewport >= state.topic.lines.length;
}

function getTopicViewportHeight(config: TuiConfig, totalRows: number): number {
  const mainHeight = config.hideTopChrome
    ? Math.max(1, totalRows - 3)
    : Math.max(1, totalRows - 7);
  return Math.max(0, mainHeight - 4);
}

async function reactToCurrentTopicPost(context: RuntimeContext, isLike: boolean): Promise<void> {
  const { state, client, render } = context;
  const topic = state.topic;
  if (!topic || state.loadingMore) {
    return;
  }

  const post = currentTopicPost(topic, state.scroll);
  if (!post?.id) {
    state.status = "当前楼层不可赞踩";
    render();
    return;
  }

  state.status = isLike ? "正在点赞..." : "正在点踩...";
  render();

  try {
    await client.reactToPost(post.id, isLike);
    const latest = await client.getPostReactionState(post.id, true);
    if (typeof latest === "object" && latest !== null) {
      const reaction = latest as {
        likeCount?: unknown;
        dislikeCount?: unknown;
        likeState?: unknown;
      };
      if (typeof reaction.likeCount === "number" && Number.isFinite(reaction.likeCount)) {
        post.likeCount = reaction.likeCount;
      }
      if (typeof reaction.dislikeCount === "number" && Number.isFinite(reaction.dislikeCount)) {
        post.dislikeCount = reaction.dislikeCount;
      }
      post.likeState = reaction.likeState === 1 || reaction.likeState === 2 ? reaction.likeState : 0;
    }
    updateTopicPostHeader(post, topic);
    showNotification(
      state,
      post.likeState === 1 ? `已赞 ${post.floor ?? "?"} 楼` :
        post.likeState === 2 ? `已踩 ${post.floor ?? "?"} 楼` :
          `已取消 ${post.floor ?? "?"} 楼的赞踩`
    );
    state.status = getStatus(state);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = isLike ? "点赞失败" : "点踩失败";
  } finally {
    render();
  }
}

function updateTopicPostHeader(post: NonNullable<TuiState["topic"]>["posts"][number], topic: NonNullable<TuiState["topic"]>): void {
  const floor = post.floor !== undefined ? `#${post.floor}` : "#?";
  const reaction = ` · ${post.likeCount} 赞 · ${post.dislikeCount} 踩`;
  const header = `${floor} ${post.author}${post.time ? ` · ${post.time}` : ""}${reaction}`;
  const headerLine = post.lines.find((entry) => entry.kind === "header");
  if (!headerLine) {
    return;
  }
  headerLine.text = header;
  if (headerLine.line >= 0 && headerLine.line < topic.lines.length) {
    topic.lines[headerLine.line] = header;
  }
}

async function openCurrentPostUserProfile(context: RuntimeContext): Promise<void> {
  const { state, client, render, nextSignal } = context;
  const topic = state.topic;
  if (!topic) {
    return;
  }

  const post = currentTopicPost(topic, state.scroll);
  if (!post?.userId) {
    state.status = "当前楼层没有可打开的用户页";
    render();
    return;
  }

  await openUserProfile(client, state, post.userId, render, false, nextSignal());
}

async function openCurrentTopicBoard(context: RuntimeContext): Promise<void> {
  const { state, client, render, nextSignal } = context;
  const board = state.topic?.board ?? state.currentBoard;
  if (!board) {
    state.status = "当前帖子没有可打开的版面";
    render();
    return;
  }

  await openBoard(client, state, board.boardId, board.title || `#${board.boardId}`, render, false, nextSignal());
}

async function copyCurrentTopicLink(context: RuntimeContext): Promise<void> {
  const { state, render } = context;
  const topicId = state.topic?.topicId;
  if (!topicId) {
    state.status = "当前帖子没有可复制的链接";
    render();
    return;
  }

  const url = `https://www.cc98.org/topic/${topicId}`;
  try {
    await copyToClipboard(url);
    showNotification(state, "已复制帖子链接");
    state.status = url;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = `复制失败：${url}`;
  } finally {
    render();
  }
}

async function copyToClipboard(value: string): Promise<void> {
  if (process.platform === "darwin") {
    await pipeClipboardInput("pbcopy", [], value);
    return;
  }
  if (process.platform === "win32") {
    await pipeClipboardInput("clip", [], value);
    return;
  }

  try {
    await pipeClipboardInput("wl-copy", [], value);
  } catch {
    await pipeClipboardInput("xclip", ["-selection", "clipboard"], value);
  }
}

function pipeClipboardInput(command: string, args: string[], value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";

    child.on("error", reject);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
    });

    child.stdin.end(value);
  });
}

async function toggleCurrentTopicFavorite(context: RuntimeContext): Promise<void> {
  const { state, client, render } = context;
  const topic = state.topic;
  if (!topic || state.loading || state.loadingMore) {
    return;
  }

  const nextFavoriteState = !topic.isFavorite;
  state.status = nextFavoriteState ? "正在收藏帖子..." : "正在取消收藏...";
  render();

  try {
    if (nextFavoriteState) {
      await client.favoriteTopic(topic.topicId);
    } else {
      await client.unfavoriteTopic(topic.topicId);
    }
    topic.isFavorite = nextFavoriteState;
    if (!nextFavoriteState && state.currentFeed?.kind === "me-favorites") {
      state.items = state.items.filter((item) => item.topicId !== topic.topicId);
      if (state.currentFeed.loaded > 0) {
        state.currentFeed.loaded = Math.max(0, state.currentFeed.loaded - 1);
      }
      state.itemIndex = Math.max(0, Math.min(state.itemIndex, state.items.length - 1));
    }
    showNotification(state, nextFavoriteState ? "已收藏当前帖子" : "已取消收藏当前帖子");
    state.status = getStatus(state);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = nextFavoriteState ? "收藏失败" : "取消收藏失败";
  } finally {
    render();
  }
}
