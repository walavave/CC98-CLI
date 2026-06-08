import { CachedCc98Client } from "../cached-client.js";
import type { NoticeType, TuiState } from "../tui-model.js";
import { describeFeedStatus } from "./feed-status.js";
import { topicItem } from "./items.js";
import { prepareListView } from "./navigation-state.js";
import { asArray, asObject, isAbortError } from "./utils.js";
import {
  buildUserProfileItems,
  chatMessageItems,
  describeUserProfileStatus,
  loadFeedPageItems,
  loadNoticeItems
} from "./view-items.js";

export async function openBoard(
  client: CachedCc98Client,
  state: TuiState,
  boardId: number,
  boardTitle: string,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  prepareListView(state, {
    title: boardTitle,
    status: "正在读取版面帖子...",
    currentBoard: { boardId, title: boardTitle },
    pushParent
  });
  render();

  try {
    const topics = asArray(await client.getBoardTopics(boardId, 0, 12, false, force, signal));
    state.items = topics.map((topic) => topicItem(topic));
    state.status = "版面帖子：j/k 选择  l 打开帖子  h 返回  r 刷新";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

export async function openChat(
  client: CachedCc98Client,
  state: TuiState,
  userId: number,
  title: string,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  markChatReadLocally(state, userId);
  prepareListView(state, {
    title,
    status: "正在读取私信...",
    currentChat: { userId, title, loaded: 0, size: 20, hasMore: true },
    pushParent
  });
  const chat = state.currentChat;
  if (!chat) {
    return;
  }
  render();

  try {
    const messages = asArray(await client.getChatHistory(userId, 0, chat.size, force, signal));
    state.items = chatMessageItems(messages, title, userId);
    chat.loaded = messages.length;
    chat.hasMore = messages.length === chat.size;
    state.itemIndex = Math.max(0, state.items.length - 1);
    state.status = chat.hasMore
      ? "私信：j/k 滚动  c 私信  n/Space 更早消息  Esc/Backspace 返回联系人  h 返回左栏"
      : "私信：j/k 滚动  c 私信  Esc/Backspace 返回联系人  h 返回左栏";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "私信读取失败；Esc/Backspace 返回联系人  h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

function markChatReadLocally(state: TuiState, userId: number): void {
  const unreadCount = state.messageUnreadByUserId[userId] ?? 0;
  if (unreadCount <= 0) {
    return;
  }

  state.messageUnreadByUserId[userId] = 0;
  if (state.unreadSummary) {
    state.unreadSummary = {
      ...state.unreadSummary,
      messageCount: Math.max(0, state.unreadSummary.messageCount - unreadCount)
    };
  }

  state.items = state.items.map((item) => {
    if (item.chatUserId !== userId) {
      return item;
    }
    return {
      ...item,
      unread: false,
      unreadCount: 0
    };
  });
}

export async function openNoticeList(
  client: CachedCc98Client,
  state: TuiState,
  type: NoticeType,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  const title = noticeListTitle(type);
  prepareListView(state, {
    title,
    status: `正在读取${title}...`,
    pushParent
  });
  state.currentFeed = {
    kind: noticeFeedKind(type),
    title,
    loaded: 0,
    size: 12,
    hasMore: true
  };
  const feed = state.currentFeed;
  render();

  try {
    const notices = asArray(await client.getNotices(type, 0, feed.size + 1, force, signal));
    state.items = await loadNoticeItems(client, type, notices.slice(0, feed.size), force, signal);
    feed.loaded = state.items.length;
    feed.hasMore = notices.length > feed.size;
    state.status = describeFeedStatus(feed);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = `${title}读取失败；Esc/Backspace 返回  h 返回左栏  r 重试`;
  } finally {
    state.loading = false;
    render();
  }
}

export async function openUserProfile(
  client: CachedCc98Client,
  state: TuiState,
  userId: number,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  prepareListView(state, {
    title: `用户 #${userId}`,
    status: "正在读取用户信息...",
    currentUser: { userId, title: `用户 #${userId}`, loaded: 0, size: 10, hasMore: true, isFollowed: false },
    pushParent
  });
  const currentUser = state.currentUser;
  if (!currentUser) {
    return;
  }
  render();

  try {
    const [profileRaw, topicsRaw] = await Promise.all([
      client.getUserProfile(userId, force, signal),
      client.getRecentTopics(userId, 0, currentUser.size + 1, force, signal)
    ]);
    const profile = asObject(profileRaw);
    const recentTopics = asArray(topicsRaw);
    const topicItems = recentTopics.slice(0, currentUser.size).map((topic) => topicItem(topic));
    const name = String(profile.name ?? profile.userName ?? `#${userId}`).trim() || `#${userId}`;

    currentUser.title = name;
    currentUser.loaded = topicItems.length;
    currentUser.hasMore = recentTopics.length > currentUser.size;
    state.viewTitle = name;
    state.items = [...buildUserProfileItems(profile), ...topicItems];
    state.status = describeUserProfileStatus(state);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "用户页读取失败；Esc/Backspace 返回  h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

export async function loadNextChatPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  signal?: AbortSignal
): Promise<void> {
  if (!state.currentChat || state.loadingMore || !state.currentChat.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.status = "正在读取更早私信...";
  render();

  try {
    const chat = state.currentChat;
    const messages = asArray(await client.getChatHistory(chat.userId, chat.loaded, chat.size, false, signal));
    const olderItems = chatMessageItems(messages, chat.title, chat.userId);
    state.items = [...olderItems, ...state.items];
    state.itemIndex += olderItems.length;
    state.scroll += olderItems.length;
    chat.loaded += messages.length;
    chat.hasMore = messages.length === chat.size;
    state.status = chat.hasMore
      ? "私信：j/k 滚动  c 私信  n/Space 更早消息  Esc/Backspace 返回联系人  h 返回左栏"
      : "已到最早私信；j/k 滚动  c 私信  Esc/Backspace 返回联系人  h 返回左栏";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "更早私信读取失败；n/Space 重试  Esc/Backspace 返回联系人";
  } finally {
    state.loadingMore = false;
    render();
  }
}

export async function loadNextUserTopicPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  signal?: AbortSignal
): Promise<void> {
  const currentUser = state.currentUser;
  if (!currentUser || state.loadingMore || !currentUser.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.status = "正在加载更多主题...";
  render();

  try {
    const topics = asArray(await client.getRecentTopics(
      state.currentFeed?.kind === "me-profile" ? undefined : currentUser.userId,
      currentUser.loaded,
      currentUser.size + 1,
      false,
      signal
    ));
    const nextItems = topics.slice(0, currentUser.size).map((topic) => topicItem(topic));
    state.items = [...state.items, ...nextItems];
    currentUser.loaded += nextItems.length;
    currentUser.hasMore = topics.length > currentUser.size;
    state.status = describeUserProfileStatus(state);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "加载更多主题失败；n/Space 重试  Esc/Backspace 返回";
  } finally {
    state.loadingMore = false;
    render();
  }
}

export async function loadNextFeedPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  signal?: AbortSignal
): Promise<void> {
  const feed = state.currentFeed;
  if (!feed || state.loading || state.loadingMore || !feed.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.error = undefined;
  state.status = feed.kind === "messages"
    ? "正在读取更多联系人..."
    : feed.kind.startsWith("notifications-")
      ? "正在读取更多通知..."
      : "正在加载更多帖子...";
  render();

  try {
    const { items: nextItems, received } = await loadFeedPageItems(client, feed, false, signal);
    state.items = [...state.items, ...nextItems];
    if (feed.kind === "messages") {
      applyMessageUnreadState(state);
    }
    feed.loaded += nextItems.length;
    feed.hasMore = received > feed.size;
    state.status = describeFeedStatus(feed);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = feed.kind === "messages" || feed.kind === "me-fans"
      ? "加载更多联系人失败；n/Space 重试"
      : feed.kind.startsWith("notifications-")
        ? "加载更多通知失败；n/Space 重试"
      : "加载更多内容失败；n/Space 重试";
  } finally {
    state.loadingMore = false;
    render();
  }
}

function noticeFeedKind(type: NoticeType): NonNullable<TuiState["currentFeed"]>["kind"] {
  switch (type) {
    case "system":
      return "notifications-system";
    case "at":
      return "notifications-at";
    case "reply":
      return "notifications-reply";
  }
}

function applyMessageUnreadState(state: TuiState): void {
  state.messageUnreadByUserId = mergeMessageUnreadState(state);
}

export function mergeMessageUnreadState(state: TuiState): Record<number, number> {
  const nextCounts = { ...state.messageUnreadByUserId };
  state.items = state.items.map((item) => {
    if (item.chatUserId === undefined) {
      return item;
    }
    const currentUnread = item.unreadCount ?? (item.unread ? 1 : 0);
    const previousUnread = nextCounts[item.chatUserId];
    const unreadCount = previousUnread === 0 ? 0 : Math.max(currentUnread, previousUnread ?? 0);
    nextCounts[item.chatUserId] = unreadCount;
    return {
      ...item,
      unread: unreadCount > 0,
      unreadCount
    };
  });
  return nextCounts;
}

function noticeListTitle(type: NoticeType): string {
  switch (type) {
    case "system":
      return "系统通知";
    case "at":
      return "@通知";
    case "reply":
      return "回复通知";
  }
}
