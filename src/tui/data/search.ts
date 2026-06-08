import { CachedCc98Client } from "../cached-client.js";
import type { SearchKind, SearchListState, TuiState } from "../tui-model.js";
import { basicUserItem, boardItem, topicItem } from "./items.js";
import { asArray, asObject, isAbortError } from "./utils.js";

export async function executeSearch(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  force = false,
  signal?: AbortSignal
): Promise<void> {
  const search = state.currentSearch;
  if (!search) {
    return;
  }

  const query = search.draft.trim();
  search.query = query;
  state.error = undefined;
  state.itemIndex = 0;
  state.scroll = 0;
  state.imageViewer = undefined;

  if (!query) {
    resetSearchResults(state, search.kind);
    render();
    return;
  }

  state.loading = true;
  state.loadingMore = false;
  state.status = `正在搜索${searchKindLabel(search.kind)} “${query}”...`;
  render();

  try {
    const items = await searchItems(client, search, query, 0, search.size, force, signal);
    state.items = items.items;
    search.loaded = items.received;
    search.hasMore = items.hasMore;
    search.searched = true;
    search.focus = state.items.length > 0 ? "results" : "input";
    state.status = describeSearchStatus(search.kind, state.items.length, search.hasMore, query);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "搜索失败；Enter 重试  上键切换类型  h 返回左栏";
  } finally {
    state.loading = false;
    render();
  }
}

export async function loadNextSearchPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  signal?: AbortSignal
): Promise<void> {
  const search = state.currentSearch;
  if (!search || !search.query || state.loading || state.loadingMore || !search.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.error = undefined;
  state.status = `正在加载${searchKindLabel(search.kind)} “${search.query}” 的更多结果...`;
  render();

  try {
    const next = await searchItems(client, search, search.query, search.loaded, search.size, false, signal);
    state.items = [...state.items, ...next.items];
    search.loaded += next.received;
    search.hasMore = next.hasMore;
    if (state.items.length > 0) {
      search.focus = "results";
    }
    state.status = search.hasMore
      ? `搜索结果：${state.items.length} 项  j/k 选择  Enter 打开  n/Space 继续加载  上键切换类型`
      : `搜索结果：${state.items.length} 项  已全部加载  上键切换类型`;
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "加载更多搜索结果失败；n/Space 重试";
  } finally {
    state.loadingMore = false;
    render();
  }
}

export function switchSearchKind(state: TuiState, kind: SearchKind): boolean {
  const search = state.currentSearch;
  if (!search || search.kind === kind || (kind === "board-topic" && !search.board)) {
    return false;
  }

  search.kind = kind;
  search.query = "";
  search.loaded = 0;
  search.hasMore = false;
  search.searched = false;
  search.focus = "input";
  state.items = [];
  state.itemIndex = 0;
  state.scroll = 0;
  state.loading = false;
  state.loadingMore = false;
  state.error = undefined;
  state.imageViewer = undefined;
  state.status = initialSearchStatus(kind);
  return true;
}

function resetSearchResults(state: TuiState, kind: SearchKind): void {
  const search = state.currentSearch;
  if (!search) {
    return;
  }
  search.query = "";
  search.loaded = 0;
  search.hasMore = false;
  search.searched = false;
  search.focus = "input";
  state.items = [];
  state.loading = false;
  state.loadingMore = false;
  state.status = initialSearchStatus(kind);
}

async function searchItems(
  client: CachedCc98Client,
  search: SearchListState,
  query: string,
  from: number,
  size: number,
  force: boolean,
  signal?: AbortSignal
): Promise<{ items: TuiState["items"]; received: number; hasMore: boolean }> {
  switch (search.kind) {
    case "topic": {
      const topics = asArray(await client.searchTopics(query, from, size, force, signal));
      return {
        items: topics.map((topic) => topicItem(topic)),
        received: topics.length,
        hasMore: topics.length === size
      };
    }
    case "board-topic": {
      const board = search.board;
      if (!board) {
        return { items: [], received: 0, hasMore: false };
      }
      const boardFallback = {
        boardId: board.boardId,
        title: board.title || `#${board.boardId}`
      };
      const topics = asArray(await client.searchTopicsInBoard(board.boardId, query, from, size, force, signal));
      return {
        items: topics.map((topic) => topicItem(topic, boardFallback)),
        received: topics.length,
        hasMore: topics.length === size
      };
    }
    case "board": {
      const boards = asArray(await client.searchBoards(query, force, signal));
      return {
        items: boards.map((board) => boardItem(board)),
        received: boards.length,
        hasMore: false
      };
    }
    case "user": {
      const result = await client.searchUsers(query, force, signal);
      const users = Array.isArray(result)
        ? result
        : Object.keys(asObject(result)).length > 0
          ? [result]
          : [];
      return {
        items: users.map((user) => basicUserItem(user)),
        received: users.length,
        hasMore: false
      };
    }
  }
}

function describeSearchStatus(kind: SearchKind, count: number, hasMore: boolean, query: string): string {
  if (count === 0) {
    return `未找到 “${query}” 的相关${searchKindLabel(kind)}`;
  }
  if (hasMore) {
    return `搜索结果：${count} 项  j/k 选择  Enter 打开  n/Space 继续加载  上键切换类型`;
  }
  return `搜索结果：${count} 项  j/k 选择  Enter 打开  上键切换类型`;
}

export function initialSearchStatus(kind: SearchKind): string {
  return `搜索${searchKindLabel(kind)}：输入关键词后 Enter 执行  上键切换类型  j 进入结果  h 返回左栏`;
}

export function searchKindLabel(kind: SearchKind): string {
  switch (kind) {
    case "topic":
      return "主题";
    case "board":
      return "版面";
    case "user":
      return "用户";
    case "board-topic":
      return "版内";
  }
}
