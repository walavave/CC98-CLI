import { CachedCc98Client } from "../cached-client.js";
import type { TuiState } from "../tui-model.js";
import { topicItem } from "./items.js";
import { asArray, isAbortError } from "./utils.js";

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
    search.loaded = 0;
    search.hasMore = false;
    search.searched = false;
    search.focus = "input";
    state.items = [];
    state.loading = false;
    state.loadingMore = false;
    state.status = "搜索：输入关键词后 Enter 执行  j 进入结果  h 返回左栏";
    render();
    return;
  }

  state.loading = true;
  state.loadingMore = false;
  state.status = `正在搜索 “${query}”...`;
  render();

  try {
    const topics = asArray(await client.searchTopics(query, 0, search.size, force, signal));
    state.items = topics.map((topic) => topicItem(topic));
    search.loaded = topics.length;
    search.hasMore = topics.length === search.size;
    search.searched = true;
    search.focus = state.items.length > 0 ? "results" : "input";
    state.status = state.items.length === 0
      ? `未找到 “${query}” 的相关帖子`
      : search.hasMore
        ? `搜索结果：${state.items.length} 项  j/k 选择  Enter 打开  n/Space 继续加载`
        : `搜索结果：${state.items.length} 项  j/k 选择  Enter 打开`;
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "搜索失败；Enter 重试  h 返回左栏";
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
  state.status = `正在加载 “${search.query}” 的更多结果...`;
  render();

  try {
    const topics = asArray(await client.searchTopics(search.query, search.loaded, search.size, false, signal));
    const nextItems = topics.map((topic) => topicItem(topic));
    state.items = [...state.items, ...nextItems];
    search.loaded += topics.length;
    search.hasMore = topics.length === search.size;
    if (state.items.length > 0) {
      search.focus = "results";
    }
    state.status = search.hasMore
      ? `搜索结果：${state.items.length} 项  j/k 选择  Enter 打开  n/Space 继续加载`
      : `搜索结果：${state.items.length} 项  已全部加载`;
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
