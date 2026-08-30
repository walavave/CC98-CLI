import {
  type FollowingListState,
  type ListSnapshot,
  type SearchListState,
  type TopicReaderState,
  type TuiState,
  type ViewSnapshot
} from "../tui-model.js";
import { clearTopicViewportAnchor } from "../topic-scroll.js";

export function createSearchState(board?: SearchListState["board"]): SearchListState {
  return {
    title: "搜索",
    kind: board ? "board-topic" : "topic",
    board,
    query: "",
    draft: "",
    loaded: 0,
    size: 10,
    hasMore: false,
    searched: false,
    focus: "input"
  };
}

export function createFollowingState(): FollowingListState {
  return {
    title: "关注",
    kind: "board",
    loaded: 0,
    size: 12,
    hasMore: false,
    focus: "tabs"
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

export function pushCurrentViewSnapshot(state: TuiState): void {
  state.history.push(snapshotCurrentView(state));
  if (state.history.length > state.historyLimit) {
    state.history = [];
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
    pushCurrentViewSnapshot(state);
  }

  state.mode = "list";
  state.focus = "content";
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  state.itemIndex = 0;
  state.scroll = 0;
  clearTopicViewportAnchor(state);
  state.topic = undefined;
  state.imageViewer = undefined;
  state.currentBoard = options.currentBoard;
  state.currentFeed = undefined;
  state.currentChat = options.currentChat;
  state.currentUser = options.currentUser;
  state.currentSearch = undefined;
  state.currentFollowing = undefined;
  state.currentFavorites = undefined;
  state.currentBoardDirectory = undefined;
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
        topicViewportScroll: state.topicViewportScroll,
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
    scroll: state.scroll,
    status: state.status,
    currentBoard: state.currentBoard,
    currentFeed: state.currentFeed,
    currentChat: state.currentChat,
    currentSearch: state.currentSearch,
    currentFollowing: state.currentFollowing,
    currentFavorites: state.currentFavorites,
    currentBoardDirectory: state.currentBoardDirectory,
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
  clearTopicViewportAnchor(state);
  state.imageViewer = undefined;
  state.currentBoard = snapshot.currentBoard;
  state.currentFeed = snapshot.currentFeed;
  state.currentChat = snapshot.currentChat;
  state.currentSearch = snapshot.currentSearch;
  state.currentFollowing = snapshot.currentFollowing;
  state.currentFavorites = snapshot.currentFavorites;
  state.currentBoardDirectory = snapshot.currentBoardDirectory;
  state.currentUser = snapshot.currentUser;
  state.viewTitle = snapshot.title;
  state.items = snapshot.items;
  state.itemIndex = snapshot.itemIndex;
  state.scroll = snapshot.scroll;
  state.status = snapshot.status;
}

function applyTopicSnapshot(
  state: TuiState,
  snapshot: {
    viewTitle: string;
    status: string;
    scroll: number;
    topicViewportScroll?: number;
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
  state.topicViewportScroll = snapshot.topicViewportScroll;
  state.topic = snapshot.topic;
  state.imageViewer = undefined;
  state.currentBoard = snapshot.list.currentBoard;
  state.currentFeed = snapshot.list.currentFeed;
  state.currentChat = snapshot.list.currentChat;
  state.currentUser = snapshot.list.currentUser;
  state.currentSearch = snapshot.list.currentSearch;
  state.currentFollowing = snapshot.list.currentFollowing;
  state.currentFavorites = snapshot.list.currentFavorites;
  state.currentBoardDirectory = snapshot.list.currentBoardDirectory;
  state.viewTitle = snapshot.viewTitle;
  state.status = snapshot.status;
}
