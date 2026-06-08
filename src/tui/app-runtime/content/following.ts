import { isPrintableInput } from "../../account-modal.js";
import { loadNextFeedPage } from "../../data/content.js";
import {
  adjacentFollowingKind,
  loadFollowingKind,
  switchFollowingKind
} from "../../data/following.js";
import { openBoard, openChat, openUserProfile } from "../../data/content.js";
import { openTopic } from "../../data/topic.js";
import type { RuntimeContext } from "../context.js";
import { leaveContentMode } from "../state.js";

export function handleFollowingContentFocus(context: RuntimeContext, key: string): void {
  const { state, render, client, nextSignal, abortCurrent } = context;
  const following = state.currentFollowing;
  if (!following) {
    return;
  }

  if ((following.focus !== "tabs" && (key === "h" || key === "\x1b[D")) || key === "\x1b") {
    abortCurrent();
    leaveContentMode(state);
    render();
    return;
  }

  if (following.focus === "tabs") {
    if (key === "j" || key === "\x1b[B" || key === "\t" || key === "\r") {
      if (state.items.length > 0) {
        following.focus = "results";
      }
      render();
      return;
    }
    if (key === "h" || key === "\x1b[D" || key === "l" || key === "\x1b[C") {
      abortCurrent();
      const nextKind = adjacentFollowingKind(following.kind, key === "h" || key === "\x1b[D" ? -1 : 1);
      if (switchFollowingKind(state, nextKind)) {
        void loadFollowingKind(client, state, render, nextKind, false, nextSignal());
      } else {
        render();
      }
      return;
    }
    if (key === "r") {
      void loadFollowingKind(client, state, render, following.kind, true, nextSignal());
      return;
    }
    if (isPrintableInput(key)) {
      following.focus = "results";
      render();
    }
    return;
  }

  if (key === "j" || key === "\x1b[B") {
    const wasAtEnd = isAtFollowingEnd(state);
    state.itemIndex = Math.min(Math.max(0, state.items.length - 1), state.itemIndex + 1);
    render();
    if (wasAtEnd && following.hasMore && !state.loadingMore && !state.loading) {
      void loadNextFeedPage(client, state, render, nextSignal());
    }
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    if (state.itemIndex === 0) {
      following.focus = "tabs";
    } else {
      state.itemIndex = Math.max(0, state.itemIndex - 1);
    }
    render();
    return;
  }
  if (key === "l" || key === "\x1b[C" || key === "\r") {
    if (openFollowingSelectedItem(context)) {
      return;
    }
    state.status = "当前条目不可进入";
    render();
    return;
  }
  if (key === "n" || key === " ") {
    void loadNextFeedPage(client, state, render, nextSignal());
    return;
  }
  if (key === "r") {
    void loadFollowingKind(client, state, render, following.kind, true, nextSignal());
  }
}

export function isAtFollowingEnd(state: RuntimeContext["state"]): boolean {
  return Boolean(
    state.currentFollowing &&
    state.currentFollowing.focus === "results" &&
    state.items.length > 0 &&
    state.itemIndex >= state.items.length - 1
  );
}

function openFollowingSelectedItem(context: RuntimeContext): boolean {
  const { state, render, client, config, nextSignal } = context;
  const selected = state.items[state.itemIndex];
  if (selected?.topicId !== undefined) {
    const boardContext = selected.boardId !== undefined
      ? { boardId: selected.boardId, title: selected.boardTitle }
      : state.currentBoard;
    void openTopic(client, state, selected.topicId, render, config, true, nextSignal(), boardContext);
    return true;
  }
  if (selected?.boardId !== undefined) {
    void openBoard(client, state, selected.boardId, selected.title || `#${selected.boardId}`, render, false, nextSignal());
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
