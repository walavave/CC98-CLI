import {
  type ListSnapshot,
  type SearchListState,
  type TopicReaderState,
  type TuiState,
  type ViewSnapshot
} from "../tui-model.js";

export function createSearchState(): SearchListState {
  return {
    title: "搜索",
    query: "",
    draft: "",
    loaded: 0,
    size: 10,
    hasMore: false,
    searched: false,
    focus: "input"
  };
}

export function restorePreviousView(state: TuiState): void {
  const snapshot = state.history.pop();
  if (!snapshot) {
    return;
  }
  if (snapshot.kind === "topic") {
    applyTopicSnapshot(state, snapshot.value);
  } else {
    applyListSnapshot(state, snapshot.value);
  }
}

export function prepareListView(
  state: TuiState,
  options: {
    title: string;
    status: string;
    currentBoard?: TuiState["currentBoard"];
    currentChat?: TuiState["currentChat"];
    currentUser?: TuiState["currentUser"];
    pushParent: boolean;
  }
): void {
  if (options.pushParent) {
    state.history.push(snapshotCurrentView(state));
    if (state.history.length > state.historyLimit) {
      state.history = [];
    }
  }

  state.mode = "list";
  state.focus = "content";
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  state.itemIndex = 0;
  state.scroll = 0;
  state.topic = undefined;
  state.imageViewer = undefined;
  state.currentBoard = options.currentBoard;
  state.currentFeed = undefined;
  state.currentChat = options.currentChat;
  state.currentUser = options.currentUser;
  state.currentSearch = undefined;
  state.viewTitle = options.title;
  state.items = [];
  state.status = options.status;
}

function snapshotCurrentView(state: TuiState): ViewSnapshot {
  if (state.mode === "topic" && state.topic) {
    return {
      kind: "topic",
      value: {
        viewTitle: state.viewTitle,
        status: state.status,
        scroll: state.scroll,
        topic: state.topic,
        list: snapshotCurrentList(state)
      }
    };
  }

  return {
    kind: "list",
    value: snapshotCurrentList(state)
  };
}

function snapshotCurrentList(state: TuiState): ListSnapshot {
  return {
    title: state.viewTitle,
    items: state.items,
    itemIndex: state.itemIndex,
    status: state.status,
    currentBoard: state.currentBoard,
    currentFeed: state.currentFeed,
    currentChat: state.currentChat,
    currentSearch: state.currentSearch,
    currentUser: state.currentUser
  };
}

function applyListSnapshot(state: TuiState, snapshot: ListSnapshot): void {
  state.mode = "list";
  state.focus = "content";
  state.loading = false;
  state.loadingMore = false;
  state.error = undefined;
  state.topic = undefined;
  state.imageViewer = undefined;
  state.currentBoard = snapshot.currentBoard;
  state.currentFeed = snapshot.currentFeed;
  state.currentChat = snapshot.currentChat;
  state.currentSearch = snapshot.currentSearch;
  state.currentUser = snapshot.currentUser;
  state.viewTitle = snapshot.title;
  state.items = snapshot.items;
  state.itemIndex = snapshot.itemIndex;
  state.status = snapshot.status;
}

function applyTopicSnapshot(
  state: TuiState,
  snapshot: {
    viewTitle: string;
    status: string;
    scroll: number;
    topic: TopicReaderState;
    list: ListSnapshot;
  }
): void {
  state.mode = "topic";
  state.focus = "content";
  state.loading = false;
  state.loadingMore = false;
  state.error = undefined;
  state.items = snapshot.list.items;
  state.itemIndex = snapshot.list.itemIndex;
  state.scroll = snapshot.scroll;
  state.topic = snapshot.topic;
  state.imageViewer = undefined;
  state.currentBoard = snapshot.list.currentBoard;
  state.currentFeed = snapshot.list.currentFeed;
  state.currentChat = snapshot.list.currentChat;
  state.currentUser = snapshot.list.currentUser;
  state.currentSearch = snapshot.list.currentSearch;
  state.viewTitle = snapshot.viewTitle;
  state.status = snapshot.status;
}
