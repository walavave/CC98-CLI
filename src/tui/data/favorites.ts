import { CachedCc98Client } from "../cached-client.js";
import type { FavoriteGroup, FavoriteListState, TuiState } from "../tui-model.js";
import { getStatus } from "../tui-model.js";
import { topicItem } from "./items.js";
import { prepareListView } from "./navigation-state.js";
import { asArray, asNumber, asObject, isAbortError } from "./utils.js";

export async function openMyFavorites(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  const size = 10;
  prepareListView(state, { title: "我的收藏", status: "正在读取我的收藏...", pushParent });
  state.currentFavorites = {
    title: "我的收藏",
    groups: [],
    groupId: 0,
    loaded: 0,
    size,
    hasMore: false,
    focus: "tabs"
  };
  state.currentFeed = { kind: "me-favorites", title: "我的收藏", loaded: 0, size, hasMore: false };
  render();
  await loadFavoriteView(client, state, render, force, signal);
}

export async function loadFavoriteView(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force: boolean,
  signal?: AbortSignal
): Promise<void> {
  const favorites = state.currentFavorites;
  if (!favorites) {
    return;
  }

  favorites.loaded = 0;
  favorites.hasMore = false;
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  state.items = [];
  state.itemIndex = 0;
  state.scroll = 0;
  state.imageViewer = undefined;
  state.status = "正在读取我的收藏...";
  render();

  try {
    favorites.groups = await fetchFavoriteGroups(client, force, signal);
    let activeGroupId = favorites.groupId;
    if (activeGroupId !== -1 && !favorites.groups.some((group) => group.id === activeGroupId)) {
      activeGroupId = 0;
      favorites.groupId = 0;
    }

    if (activeGroupId === -1) {
      favorites.loaded = 0;
      favorites.hasMore = false;
      state.items = [];
      state.status = "新建分组：Enter 确认  Tab 返回分组列表";
      if (state.currentFeed) {
        state.currentFeed.loaded = 0;
        state.currentFeed.hasMore = false;
      }
      return;
    }

    const topics = asArray(await client.getFavoriteTopics(0, favorites.size + 1, 0, activeGroupId, force, signal));
    const items = topics.slice(0, favorites.size).map((topic) => topicItem(topic));
    state.items = items;
    favorites.loaded = items.length;
    favorites.hasMore = topics.length > favorites.size;
    if (state.currentFeed) {
      state.currentFeed.loaded = items.length;
      state.currentFeed.hasMore = topics.length > favorites.size;
    }
    const name = favoriteGroupName(favorites, activeGroupId);
    state.status = `收藏 · ${name}：d 取消收藏  a 管理分组  s 移动分组`;
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

export async function fetchFavoriteGroups(
  client: CachedCc98Client,
  force: boolean,
  signal?: AbortSignal
): Promise<FavoriteGroup[]> {
  const raw = await client.getFavoriteGroups(force, signal);
  let entries = asArray(raw);
  if (entries.length === 0) {
    const object = asObject(raw);
    entries = asArray(object.groups ?? object.Groups ?? object.data ?? object.Data);
  }
  return entries.map((entry) => {
    const group = asObject(entry);
    const id = asNumber(group.id ?? group.Id ?? group.groupId ?? group.GroupId) ?? 0;
    const name = String(group.name ?? group.Name ?? "分组").trim() || "分组";
    return { id, name };
  });
}

export function switchFavoriteGroup(state: TuiState, groupId: number): boolean {
  const favorites = state.currentFavorites;
  if (!favorites || favorites.groupId === groupId) {
    return false;
  }
  favorites.groupId = groupId;
  favorites.focus = "tabs";
  favorites.loaded = 0;
  favorites.hasMore = false;
  state.items = [];
  state.itemIndex = 0;
  state.scroll = 0;
  state.loading = false;
  state.loadingMore = false;
  state.error = undefined;
  state.imageViewer = undefined;
  return true;
}

export function adjacentFavoriteGroup(state: TuiState, offset: number): number {
  const favorites = state.currentFavorites;
  if (!favorites) {
    return 0;
  }
  // 与渲染层 favoriteTabs 一致：默认分组固定放第一个，过滤掉 API 返回的 id 0 重复项
  const tabs = [
    0,
    ...favorites.groups.filter((group) => group.id !== 0).map((group) => group.id),
    -1
  ];
  const currentIndex = Math.max(0, tabs.indexOf(favorites.groupId));
  return tabs[(currentIndex + offset + tabs.length) % tabs.length] ?? 0;
}

export function favoriteGroupName(favorites: FavoriteListState, groupId: number): string {
  if (groupId === -1) {
    return "+";
  }
  const group = favorites.groups.find((entry) => entry.id === groupId);
  return group?.name ?? (groupId === 0 ? "默认分组" : `#${groupId}`);
}

export async function handleCreateFavoriteGroup(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  name: string
): Promise<void> {
  try {
    await client.createFavoriteGroup(name);
    state.notification = { message: `已创建分组「${name}」`, expiresAt: Date.now() + 2200 };
    if (state.currentFavorites) {
      state.currentFavorites.groupId = 0;
    }
    await loadFavoriteView(client, state, render, true);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "创建分组失败";
    render();
  }
}

export async function handleRenameFavoriteGroup(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  groupId: number,
  name: string
): Promise<void> {
  try {
    await client.updateFavoriteGroup(groupId, name);
    state.notification = { message: `已重命名为「${name}」`, expiresAt: Date.now() + 2200 };
    if (state.currentFavorites) {
      state.currentFavorites.groupId = 0;
    }
    await loadFavoriteView(client, state, render, true);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "重命名失败";
    render();
  }
}

export async function handleDeleteFavoriteGroup(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  groupId: number
): Promise<void> {
  try {
    await client.deleteFavoriteGroup(groupId);
    state.notification = { message: "已删除分组", expiresAt: Date.now() + 2200 };
    if (state.currentFavorites) {
      state.currentFavorites.groupId = 0;
    }
    await loadFavoriteView(client, state, render, true);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "删除分组失败";
    render();
  }
}

export async function favoriteToGroup(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  groupId: number
): Promise<void> {
  const topic = state.topic;
  if (!topic) {
    return;
  }
  try {
    await client.favoriteTopic(topic.topicId, groupId);
    topic.isFavorite = true;
    state.notification = { message: "已收藏到分组", expiresAt: Date.now() + 2200 };
    state.status = getStatus(state);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "收藏失败";
  } finally {
    render();
  }
}

export async function moveFavoriteToGroup(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  topicId: number,
  groupId: number
): Promise<void> {
  try {
    await client.favoriteTopic(topicId, groupId);
    const name = state.currentFavorites
      ? favoriteGroupName(state.currentFavorites, groupId)
      : `#${groupId}`;
    state.notification = { message: `已移动到分组「${name}」`, expiresAt: Date.now() + 2200 };
    // 强制刷新当前分组列表：被移动的帖子会从当前分组消失
    await loadFavoriteView(client, state, render, true);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "移动分组失败";
    render();
  }
}

export async function toggleBoardFavorite(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  boardId: number
): Promise<void> {
  try {
    const me = asObject(await client.getMe(true));
    const customBoards = asArray(me.customBoards ?? me.CustomBoards)
      .filter((id): id is number => typeof id === "number");
    const isFavorite = customBoards.includes(boardId);
    if (isFavorite) {
      await client.removeBoardFavorite(boardId);
      state.notification = { message: "已取消收藏版面", expiresAt: Date.now() + 2200 };
    } else {
      await client.addBoardFavorite(boardId);
      state.notification = { message: "已收藏版面", expiresAt: Date.now() + 2200 };
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "版面收藏操作失败";
  } finally {
    render();
  }
}

export async function unfavoriteTopicFromList(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  topicId: number
): Promise<void> {
  try {
    await client.unfavoriteTopic(topicId);
    state.items = state.items.filter((item) => item.topicId !== topicId);
    const favorites = state.currentFavorites;
    if (favorites) {
      favorites.loaded = Math.max(0, favorites.loaded - 1);
    }
    if (state.currentFeed?.kind === "me-favorites") {
      state.currentFeed.loaded = Math.max(0, state.currentFeed.loaded - 1);
    }
    state.itemIndex = Math.min(Math.max(0, state.items.length - 1), state.itemIndex);
    state.notification = { message: "已取消收藏", expiresAt: Date.now() + 2200 };
    state.status = getStatus(state);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "取消收藏失败";
  } finally {
    render();
  }
}
