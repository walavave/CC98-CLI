import { getStatus, navItems, settingsItems } from "../../tui-model.js";
import { createSearchState } from "../../data/navigation-state.js";
import type { RuntimeContext } from "../context.js";
import { checkUpdate, openAccountOrLoginModal, requestCacheCleanup, requestLogout } from "../modals.js";
import { enterContentMode, leaveContentMode } from "../state.js";

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

  const boardContext = state.currentBoard;
  abortCurrent();
  state.navIndex = searchNavIndex;
  await load();
  if (navItems[state.navIndex]?.id !== "search" || !state.currentSearch) {
    return;
  }
  if (boardContext) {
    state.currentSearch = createSearchState(boardContext);
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
