import { restorePreviousView } from "../app-data.js";
import { getStatus, navItems, type TuiState } from "../tui-model.js";

export function showNotification(state: TuiState, message: string, durationMs = 3200): void {
  state.notification = {
    message,
    expiresAt: Date.now() + durationMs
  };
}

export function leaveTopicMode(state: TuiState): void {
  state.mode = "list";
  state.focus = "content";
  state.viewTitle = state.currentBoard?.title
    ?? state.currentChat?.title
    ?? state.currentUser?.title
    ?? state.currentSearch?.title
    ?? navItems[state.navIndex]?.label
    ?? state.viewTitle;
  state.status = getStatus(state);
}

export function enterContentMode(state: TuiState, resetIndex = false): void {
  if (navItems[state.navIndex]?.id === "settings") {
    state.mode = "settings";
  }
  state.focus = "content";
  if (state.currentSearch && (resetIndex || state.items.length === 0)) {
    state.currentSearch.focus = "input";
  }
  if (resetIndex) {
    state.itemIndex = 0;
  }
  state.status = getStatus(state);
}

export function leaveContentMode(state: TuiState): void {
  if (state.history.length > 0) {
    restorePreviousView(state);
    return;
  }
  state.mode = "list";
  state.focus = "nav";
  state.status = getStatus(state);
}
