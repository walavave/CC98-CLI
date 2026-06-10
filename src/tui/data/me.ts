import type { TuiState } from "../tui-model.js";
import { CachedCc98Client } from "../cached-client.js";
import { describeFeedStatus } from "./feed-status.js";
import { basicUserItem, historyTopicItem, recentPostItem, topicItem } from "./items.js";
import { prepareListView } from "./navigation-state.js";
import { asArray, asNumber, asObject, isAbortError } from "./utils.js";
import { buildUserProfileItems, describeUserProfileStatus } from "./view-items.js";

export async function openMyProfile(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  try {
    const size = 10;
    prepareListView(state, {
      title: "个人主页",
      status: "正在读取个人主页...",
      currentUser: { userId: 0, title: "个人主页", loaded: 0, size, hasMore: true, isFollowed: false },
      pushParent
    });
    state.currentFeed = { kind: "me-profile", title: "个人主页", loaded: 0, size, hasMore: true };
    const currentUser = state.currentUser;
    if (!currentUser) {
      return;
    }
    render();

    const [meRaw, topicsRaw] = await Promise.all([
      client.getMe(force, signal),
      client.getRecentTopics(undefined, 0, currentUser.size + 1, force, signal)
    ]);
    const me = asObject(meRaw);
    const topics = asArray(topicsRaw);
    const topicItems = topics.slice(0, size).map((topic) => topicItem(topic));
    const userId = asNumber(me.userId ?? me.userID ?? me.id ?? me.Id) ?? 0;
    const name = String(me.name ?? me.userName ?? me.username ?? (userId ? `#${userId}` : "个人主页")).trim() || "个人主页";

    currentUser.userId = userId;
    currentUser.title = name;
    currentUser.loaded = topicItems.length;
    currentUser.hasMore = topics.length > size;
    currentUser.isFollowed = false;
    if (state.currentFeed) {
      state.currentFeed.title = name;
      state.currentFeed.loaded = topicItems.length;
      state.currentFeed.hasMore = topics.length > size;
    }
    state.viewTitle = name;
    state.items = [...buildUserProfileItems(me), ...topicItems];
    state.status = describeUserProfileStatus(state);
    state.loading = false;
    render();
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "个人主页读取失败；h 返回左栏  r 重试";
    state.loading = false;
    render();
  }
}

export async function openMyFavoriteTopics(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  const size = 10;
  prepareListView(state, { title: "我的收藏", status: "正在读取我的收藏...", pushParent });
  state.currentFeed = { kind: "me-favorites", title: "我的收藏", loaded: 0, size, hasMore: true };
  render();

  try {
    const topics = asArray(await client.getFavoriteTopics(0, size + 1, 1, 0, force, signal));
    const items = topics.slice(0, size).map((topic) => topicItem(topic));
    state.items = items;
    if (state.currentFeed) {
      state.currentFeed.loaded = items.length;
      state.currentFeed.hasMore = topics.length > size;
      state.status = describeFeedStatus(state.currentFeed);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "我的收藏读取失败；h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

export async function openMyReplies(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  const size = 10;
  prepareListView(state, { title: "我的回复", status: "正在读取我的回复...", pushParent });
  state.currentFeed = { kind: "me-replies", title: "我的回复", loaded: 0, size, hasMore: true };
  render();

  try {
    const response = asObject(await client.getRecentPosts(0, size + 1, force, signal));
    const posts = asArray(response.data ?? response.posts ?? response);
    const items = posts.slice(0, size).map((post) => recentPostItem(post));
    state.items = items;
    if (state.currentFeed) {
      state.currentFeed.loaded = items.length;
      state.currentFeed.hasMore = posts.length > size;
      state.status = describeFeedStatus(state.currentFeed);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "我的回复读取失败；h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

export async function openMyHistory(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  const size = 10;
  prepareListView(state, { title: "我的足迹", status: "正在读取我的足迹...", pushParent });
  state.currentFeed = { kind: "me-history", title: "我的足迹", loaded: 0, size, hasMore: true };
  render();

  try {
    const response = asObject(await client.getBrowseHistory(0, size + 1, force, signal));
    const records = asArray(response.data ?? response.posts ?? response);
    const items = records.slice(0, size).map((record) => historyTopicItem(record));
    state.items = items;
    if (state.currentFeed) {
      state.currentFeed.loaded = items.length;
      state.currentFeed.hasMore = records.length > size;
      state.status = describeFeedStatus(state.currentFeed);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "我的足迹读取失败；h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

export async function openMyFans(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  const size = 10;
  prepareListView(state, { title: "我的粉丝", status: "正在读取我的粉丝...", pushParent });
  state.currentFeed = { kind: "me-fans", title: "我的粉丝", loaded: 0, size, hasMore: true };
  render();

  try {
    const ids = asArray(await client.getFriendIds("follower", 0, size, force, signal)).filter((id): id is number => typeof id === "number");
    const users = asArray(await client.getUsers(ids));
    const items = users.map((user) => basicUserItem(user));
    state.items = items;
    if (state.currentFeed) {
      state.currentFeed.loaded = items.length;
      state.currentFeed.hasMore = ids.length === size;
      state.status = describeFeedStatus(state.currentFeed);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "我的粉丝读取失败；h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}
