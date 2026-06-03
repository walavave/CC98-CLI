import { executeSearch, loadNextChatPage, loadNextSearchPage, loadNextUserTopicPage, openBoard, openChat, openTopic, openUserProfile } from "../app-data.js";
import { isPrintableInput } from "../account-modal.js";
import { getStatus, navItems, settingsItems } from "../tui-model.js";
import type { RuntimeContext } from "./context.js";
import { checkUpdate, openAccountOrLoginModal, requestCacheCleanup, requestLogout } from "./modals.js";
import { enterContentMode, leaveContentMode } from "./state.js";

export async function focusSearchInput(context: RuntimeContext): Promise<void> {
  const { state, render, load, abortCurrent } = context;
  const searchNavIndex = navItems.findIndex((item) => item.id === "search");
  if (searchNavIndex < 0) {
    return;
  }

  if (state.navIndex === searchNavIndex && state.currentSearch) {
    abortCurrent();
    state.mode = "list";
    state.focus = "content";
    state.loading = false;
    state.loadingMore = false;
    state.error = undefined;
    state.topic = undefined;
    state.imageViewer = undefined;
    state.currentSearch.focus = "input";
    state.viewTitle = state.currentSearch.title;
    state.status = getStatus(state);
    render();
    return;
  }

  abortCurrent();
  state.navIndex = searchNavIndex;
  await load();
  if (navItems[state.navIndex]?.id !== "search" || !state.currentSearch) {
    return;
  }
  state.mode = "list";
  state.focus = "content";
  state.currentSearch.focus = "input";
  state.status = getStatus(state);
  render();
}

export function handleSettingsMode(context: RuntimeContext, key: string): void {
  const { state, render, load } = context;
  if (key === "j" || key === "\x1b[B") {
    state.itemIndex = Math.min(settingsItems.length - 1, state.itemIndex + 1);
    render();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.itemIndex = Math.max(0, state.itemIndex - 1);
    render();
    return;
  }
  if (key === "h" || key === "\x1b[D") {
    leaveContentMode(state);
    render();
    return;
  }
  if (key !== "l" && key !== "\x1b[C" && key !== "\r") {
    return;
  }
  const selected = settingsItems[state.itemIndex];
  if (selected?.meta === "help") {
    state.modal = "help";
    render();
    return;
  }
  if (selected?.meta === "cache") {
    requestCacheCleanup(context);
    return;
  }
  if (selected?.meta === "logout") {
    requestLogout(context);
    return;
  }
  if (selected?.meta === "account") {
    openAccountOrLoginModal(context);
    return;
  }
  if (selected?.meta === "update") {
    checkUpdate(context);
    return;
  }
  void load(true);
}

export function handleNavFocus(context: RuntimeContext, key: string): void {
  const { state, render, load } = context;
  if (key === "j" || key === "\x1b[B") {
    state.navIndex = Math.min(navItems.length - 1, state.navIndex + 1);
    void load();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.navIndex = Math.max(0, state.navIndex - 1);
    void load();
    return;
  }
  if (key === "l" || key === "\x1b[C" || key === "\r") {
    if (!state.loading && (state.items.length > 0 || state.currentSearch)) {
      enterContentMode(state, key === "\r");
      render();
    }
    return;
  }
  if (key === "r") {
    void load(true);
  }
}

export function handleContentFocus(context: RuntimeContext, key: string): void {
  const { state, render, client, nextSignal, abortCurrent, load } = context;
  if (state.currentSearch) {
    handleSearchContentFocus(context, key);
    return;
  }
  if (key === "j" || key === "\x1b[B") {
    state.itemIndex = Math.min(Math.max(0, state.items.length - 1), state.itemIndex + 1);
    render();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.itemIndex = Math.max(0, state.itemIndex - 1);
    render();
    return;
  }
  if (key === "h" || key === "\x1b[D" || key === "\x1b") {
    abortCurrent();
    leaveContentMode(state);
    render();
    return;
  }
  if (key === "l" || key === "\x1b[C" || key === "\r") {
    if (openSelectedItem(context)) {
      return;
    }
    state.status = "当前条目不可进入";
    render();
    return;
  }
  if ((key === "n" || key === " ") && state.currentChat) {
    void loadNextChatPage(client, state, render, nextSignal());
    return;
  }
  if ((key === "n" || key === " ") && state.currentUser) {
    void loadNextUserTopicPage(client, state, render, nextSignal());
    return;
  }
  if (key === "r") {
    if (state.currentBoard) {
      void openBoard(client, state, state.currentBoard.boardId, state.currentBoard.title, render, true, nextSignal(), false);
      return;
    }
    if (state.currentChat) {
      void openChat(client, state, state.currentChat.userId, state.currentChat.title, render, true, nextSignal(), false);
      return;
    }
    if (state.currentUser) {
      void openUserProfile(client, state, state.currentUser.userId, render, true, nextSignal(), false);
      return;
    }
    void load(true);
  }
}

export function handleSearchContentFocus(context: RuntimeContext, key: string): void {
  const { state, render, client, nextSignal, abortCurrent, load } = context;
  const search = state.currentSearch;
  if (!search) {
    return;
  }

  if (key === "h" || key === "\x1b[D" || key === "\x1b") {
    abortCurrent();
    leaveContentMode(state);
    render();
    return;
  }

  if (search.focus === "input") {
    if (key === "\x7f") {
      search.draft = search.draft.slice(0, -1);
      render();
      return;
    }
    if (key === "\r") {
      void executeSearch(client, state, render, false, nextSignal());
      return;
    }
    if ((key === "j" || key === "\x1b[B" || key === "\t") && state.items.length > 0) {
      search.focus = "results";
      render();
      return;
    }
    if (key === "r" && search.query) {
      search.draft = search.query;
      void executeSearch(client, state, render, true, nextSignal());
      return;
    }
    if (isPrintableInput(key)) {
      search.draft = `${search.draft}${key}`;
      render();
    }
    return;
  }

  if (key === "i" || key === "/" || key === "\t") {
    search.focus = "input";
    render();
    return;
  }
  if (key === "j" || key === "\x1b[B") {
    const wasAtEnd = isAtSearchEnd(state);
    state.itemIndex = Math.min(Math.max(0, state.items.length - 1), state.itemIndex + 1);
    render();
    if (wasAtEnd && search.hasMore && !state.loadingMore && !state.loading) {
      void loadNextSearchPage(client, state, render, nextSignal());
    }
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    if (state.itemIndex === 0) {
      search.focus = "input";
    } else {
      state.itemIndex = Math.max(0, state.itemIndex - 1);
    }
    render();
    return;
  }
  if (key === "l" || key === "\x1b[C" || key === "\r") {
    if (openSelectedItem(context)) {
      return;
    }
    state.status = "当前条目不可进入";
    render();
    return;
  }
  if (key === "n" || key === " ") {
    void loadNextSearchPage(client, state, render, nextSignal());
    return;
  }
  if (key === "r") {
    if (search.query) {
      search.draft = search.query;
      void executeSearch(client, state, render, true, nextSignal());
      return;
    }
    void load(true);
    return;
  }
  if (isPrintableInput(key)) {
    search.focus = "input";
    search.draft = `${search.draft}${key}`;
    render();
  }
}

export function isAtSearchEnd(state: RuntimeContext["state"]): boolean {
  return Boolean(
    state.currentSearch &&
    state.currentSearch.focus === "results" &&
    state.items.length > 0 &&
    state.itemIndex >= state.items.length - 1
  );
}

export function getContentListScroll(state: RuntimeContext["state"], visibleCapacity: number): number {
  const maxScroll = Math.max(0, state.items.length - visibleCapacity);
  const current = Math.min(Math.max(0, state.scroll), maxScroll);
  if (state.itemIndex < current) {
    return state.itemIndex;
  }
  if (state.itemIndex >= current + visibleCapacity) {
    return Math.min(maxScroll, state.itemIndex - visibleCapacity + 1);
  }
  return current;
}

function openSelectedItem(context: RuntimeContext): boolean {
  const { state, render, client, config, nextSignal } = context;
  const selected = state.items[state.itemIndex];
  if (selected?.topicId !== undefined) {
    void openTopic(client, state, selected.topicId, render, config, false, nextSignal());
    return true;
  }
  if (selected?.boardId !== undefined) {
    void openBoard(client, state, selected.boardId, selected.title, render, false, nextSignal());
    return true;
  }
  if (selected?.chatUserId !== undefined) {
    void openChat(client, state, selected.chatUserId, selected.title, render, false, nextSignal());
    return true;
  }
  if (selected?.userId !== undefined) {
    void openUserProfile(client, state, selected.userId, render, false, nextSignal());
    return true;
  }
  return false;
}
