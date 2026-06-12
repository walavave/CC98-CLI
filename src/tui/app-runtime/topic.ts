import { spawn } from "node:child_process";
import type { TuiConfig } from "../../config.js";
import { openBoard, openUserProfile } from "../data/content.js";
import { jumpRelativeTopicFloor, jumpToTopicFloor, loadNextTopicPage, openTopic, updateTopicVote } from "../data/topic.js";
import { currentTopicLine, currentTopicPost, getStatus, type TopicVoteState, type TuiState } from "../tui-model.js";
import { clearTopicViewportAnchor } from "../topic-scroll.js";
import type { RuntimeContext } from "./context.js";
import { openTopicImageViewer, stepTopicImageViewer } from "./image-viewer.js";
import { openComposeModal, openRatingDialog } from "./modals.js";
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
  if (key === "\r" && state.topic && !state.topic.floorInput) {
    void handleTopicEnter(context);
    return;
  }
  if ((key === "]" || key === "】" || keyAction === "topic.next-reply") && state.topic) {
    moveTopicFloor(state, render, 1);
    return;
  }
  if ((key === "[" || key === "【" || keyAction === "topic.previous-reply") && state.topic) {
    moveTopicFloor(state, render, -1);
    return;
  }
  if (key === "z") {
    void openCurrentTopicBoard(context);
    return;
  }
  if ((key === "A" || key === "S") && state.topic) {
    const post = currentTopicPost(state.topic, state.scroll);
    if (!post?.id) {
      state.status = "当前楼层不可评分";
      render();
      return;
    }
    void openRatingDialog(context, post.id, key === "A" ? 1 : 2);
    return;
  }
  if (keyAction === "topic.like-post" || keyAction === "topic.dislike-post") {
    const isLike = keyAction === "topic.like-post";
    void reactToCurrentTopicPost(context, isLike);
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
    moveTopicFloor(state, render, 1);
    if (wasAtEnd && state.topic?.hasMore && !state.loadingMore) {
      void loadNextTopicPage(client, state, render, config, nextSignal(), true);
    }
    return;
  }
  if (key === "k") {
    moveTopicFloor(state, render, -1);
    return;
  }
  if (key === "\x1b[B") {
    moveTopicLine(state, render, 1);
    return;
  }
  if (key === "\x1b[A") {
    moveTopicLine(state, render, -1);
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

async function handleTopicEnter(context: RuntimeContext): Promise<void> {
  const { state } = context;
  const topic = state.topic;
  if (!topic?.vote) {
    return;
  }
  const line = topic.posts.flatMap((post) => post.lines).find((entry) => entry.line === state.scroll);
  if (!line) {
    return;
  }
  if (line.kind === "vote-option" && line.voteOptionId !== undefined) {
    toggleTopicVoteSelection(context, line.voteOptionId);
    return;
  }
  if (line.kind === "vote-action") {
    if (line.voteAction === "submit") {
      await submitTopicVote(context);
    } else if (line.voteAction === "reset") {
      resetTopicVoteSelection(context);
    }
  }
}

function moveTopicFloor(state: TuiState, render: () => void, delta: number): void {
  clearTopicViewportAnchor(state);
  jumpRelativeTopicFloor(state, delta);
  state.status = getStatus(state);
  render();
}

function moveTopicLine(state: TuiState, render: () => void, delta: number): void {
  clearTopicViewportAnchor(state);
  const maxScroll = Math.max(0, (state.topic?.lines.length ?? 0) - 1);
  state.scroll = Math.max(0, Math.min(maxScroll, state.scroll + delta));
  state.status = getStatus(state);
  render();
}

function toggleTopicVoteSelection(context: RuntimeContext, optionId: number): void {
  const { state, render } = context;
  const topic = state.topic;
  const vote = topic?.vote;
  if (!topic || !vote) {
    return;
  }
  if (!vote.canVote) {
    state.status = "当前投票不可参与";
    render();
    return;
  }

  const exists = vote.selectedItems.includes(optionId);
  if (exists) {
    vote.selectedItems = vote.selectedItems.filter((item) => item !== optionId);
  } else {
    if (vote.selectedItems.length >= vote.maxVoteCount) {
      state.status = `最多只能选择 ${vote.maxVoteCount} 项`;
      render();
      return;
    }
    vote.selectedItems = [...vote.selectedItems, optionId];
  }

  updateTopicVote(topic, vote, context.config, state.sidebarWidth);
  state.status = getStatus(state);
  render();
}

function resetTopicVoteSelection(context: RuntimeContext): void {
  const { state, render } = context;
  const topic = state.topic;
  const vote = topic?.vote;
  if (!topic || !vote) {
    return;
  }
  vote.selectedItems = vote.myRecord?.items ?? [];
  updateTopicVote(topic, vote, context.config, state.sidebarWidth);
  state.status = "已重置投票选择";
  render();
}

async function submitTopicVote(context: RuntimeContext): Promise<void> {
  const { state, client, render } = context;
  const topic = state.topic;
  const vote = topic?.vote;
  if (!topic || !vote) {
    return;
  }
  if (!vote.canVote) {
    state.status = "当前投票不可参与";
    render();
    return;
  }
  if (vote.selectedItems.length === 0) {
    state.status = "请先选择至少一个投票项";
    render();
    return;
  }

  vote.isSubmitting = true;
  state.status = "正在提交投票...";
  render();

  try {
    await client.submitTopicVote(topic.topicId, vote.selectedItems);
    const latest = await client.getTopicVote(topic.topicId, true);
    const nextVote = parseTopicVoteForRuntime(latest);
    if (!nextVote) {
      throw new Error("投票成功，但刷新结果失败");
    }
    updateTopicVote(topic, nextVote, context.config, state.sidebarWidth);
    showNotification(state, "投票成功");
    state.status = getStatus(state);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "投票失败";
  } finally {
    if (topic.vote) {
      topic.vote.isSubmitting = false;
    }
    render();
  }
}

function parseTopicVoteForRuntime(raw: unknown): TopicVoteState | undefined {
  const vote = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const items = Array.isArray(vote.voteItems) ? vote.voteItems : [];
  if (typeof vote.topicId !== "number" || items.length === 0) {
    return undefined;
  }
  const myRecord = typeof vote.myRecord === "object" && vote.myRecord !== null
    ? vote.myRecord as Record<string, unknown>
    : undefined;
  const myItems = Array.isArray(myRecord?.items)
    ? myRecord.items.filter((item): item is number => typeof item === "number")
    : [];
  return {
    topicId: vote.topicId,
    voteItems: items
      .map((item) => typeof item === "object" && item !== null ? item as Record<string, unknown> : {})
      .map((item) => ({
        id: typeof item.id === "number" ? item.id : 0,
        description: typeof item.description === "string" ? item.description : "",
        count: typeof item.count === "number" ? item.count : 0
      }))
      .filter((item) => item.id > 0 && item.description),
    expiredTime: typeof vote.expiredTime === "string" ? vote.expiredTime : "",
    isAvailable: vote.isAvailable === true,
    maxVoteCount: typeof vote.maxVoteCount === "number" && vote.maxVoteCount > 0 ? vote.maxVoteCount : 1,
    canVote: vote.canVote === true,
    myRecord: myRecord ? {
      userId: typeof myRecord.userId === "number" ? myRecord.userId : undefined,
      userName: typeof myRecord.userName === "string" ? myRecord.userName : undefined,
      items: myItems,
      ip: typeof myRecord.ip === "string" ? myRecord.ip : undefined,
      time: typeof myRecord.time === "string" ? myRecord.time : undefined
    } : undefined,
    needVote: vote.needVote === true,
    voteUserCount: typeof vote.voteUserCount === "number" && vote.voteUserCount >= 0 ? vote.voteUserCount : 0,
    selectedItems: myItems,
    isSubmitting: false
  };
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
