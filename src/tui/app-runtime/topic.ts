import type { TuiConfig } from "../../config.js";
import { jumpRelativeTopicFloor, jumpToTopicFloor, loadNextTopicPage, openTopic, openUserProfile } from "../app-data.js";
import { currentTopicPost, getStatus, type TuiState } from "../tui-model.js";
import type { RuntimeContext } from "./context.js";
import { openTopicImageViewer, stepTopicImageViewer } from "./image-viewer.js";
import { openComposeModal } from "./modals.js";
import { leaveTopicMode, showNotification } from "./state.js";

export function handleTopicMode(context: RuntimeContext, key: string, keyAction: string | undefined): void {
  const { state, render, client, config, nextSignal, abortCurrent } = context;
  if (key === config.composeKey && !state.topic?.floorInput) {
    openComposeModal(context);
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
  if (key === "a" || keyAction === "topic.like-post") {
    void reactToCurrentTopicPost(context, true);
    return;
  }
  if (key === "s" || keyAction === "topic.dislike-post") {
    void reactToCurrentTopicPost(context, false);
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
    void openTopic(client, state, state.topic.topicId, render, config, true, nextSignal());
  }
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
