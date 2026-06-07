import { CachedCc98Client } from "../cached-client.js";
import type { FollowingKind, TuiState } from "../tui-model.js";
import { describeFeedStatus } from "./feed-status.js";
import { topicItem } from "./items.js";
import { asArray, isAbortError } from "./utils.js";

export async function loadFollowingKind(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  kind: FollowingKind,
  force = false,
  signal?: AbortSignal
): Promise<void> {
  const following = state.currentFollowing;
  if (!following) {
    return;
  }

  following.kind = kind;
  following.focus = "tabs";
  following.loaded = 0;
  following.hasMore = false;
  state.currentFeed = {
    kind: followFeedKind(kind),
    title: following.title,
    loaded: 0,
    size: following.size,
    hasMore: false
  };
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  state.items = [];
  state.itemIndex = 0;
  state.scroll = 0;
  state.imageViewer = undefined;
  state.status = `正在读取关注${followingKindLabel(kind)}...`;
  render();

  try {
    const topics = await loadFollowingItems(client, kind, 0, following.size + 1, force, signal);
    state.items = topics.slice(0, following.size).map((topic) => topicItem(topic));
    following.loaded = state.items.length;
    following.hasMore = topics.length > following.size;
    if (state.currentFeed) {
      state.currentFeed.loaded = state.items.length;
      state.currentFeed.hasMore = topics.length > following.size;
      state.status = describeFeedStatus(state.currentFeed);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = kind === "user" && isFollowingSelfError(state.error)
      ? "你正在关注自己"
      : `关注${followingKindLabel(kind)}读取失败；Enter 重试  h 返回左栏`;
  } finally {
    state.loading = false;
    render();
  }
}

export function switchFollowingKind(state: TuiState, kind: FollowingKind): boolean {
  const following = state.currentFollowing;
  if (!following || following.kind === kind) {
    return false;
  }
  following.kind = kind;
  following.focus = "tabs";
  following.loaded = 0;
  following.hasMore = false;
  state.items = [];
  state.itemIndex = 0;
  state.scroll = 0;
  state.loading = false;
  state.loadingMore = false;
  state.error = undefined;
  state.imageViewer = undefined;
  state.status = initialFollowingStatus(kind);
  return true;
}

export function followingKinds(): FollowingKind[] {
  return ["board", "user", "favorite"];
}

export function adjacentFollowingKind(current: FollowingKind, offset: number): FollowingKind {
  const kinds = followingKinds();
  const currentIndex = Math.max(0, kinds.indexOf(current));
  return kinds[(currentIndex + offset + kinds.length) % kinds.length] ?? current;
}

export function initialFollowingStatus(kind: FollowingKind): string {
  return `关注${followingKindLabel(kind)}：左右切换标签  j 进入结果  h 返回左栏`;
}

export function followingKindLabel(kind: FollowingKind): string {
  switch (kind) {
    case "board":
      return "版面";
    case "user":
      return "用户";
    case "favorite":
      return "收藏";
  }
}

function followFeedKind(kind: FollowingKind): NonNullable<TuiState["currentFeed"]>["kind"] {
  switch (kind) {
    case "board":
      return "following-board";
    case "user":
      return "following-user";
    case "favorite":
      return "following-favorite";
  }
}

async function loadFollowingItems(
  client: CachedCc98Client,
  kind: FollowingKind,
  from: number,
  size: number,
  force: boolean,
  signal?: AbortSignal
): Promise<unknown[]> {
  switch (kind) {
    case "board":
      return asArray(await client.getCustomBoardTopics(from, size, force, signal));
    case "user":
      return asArray(await client.getFolloweeTopics(from, size, force, signal));
    case "favorite":
      return asArray(await client.getFavoriteUpdates(from, size, force, signal));
  }
}

function isFollowingSelfError(message: string): boolean {
  return /关注自己|follow\s+yourself|cannot\s+follow\s+yourself|yourself/i.test(message);
}
