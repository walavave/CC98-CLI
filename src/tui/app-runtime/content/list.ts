import {
  loadNextChatPage,
  loadNextFeedPage,
  loadNextUserTopicPage,
  openBoard,
  openChat,
  openNoticeList,
  openUserProfile
} from "../../data/content.js";
import { openTopic } from "../../data/topic.js";
import type { RuntimeContext } from "../context.js";
import { openSelectedMeItem, refreshCurrentMeView, toggleCurrentUserFollow } from "../me.js";
import { openComposeModal } from "../modals.js";
import { handleFollowingContentFocus } from "./following.js";
import { leaveContentMode } from "../state.js";
import { handleSearchContentFocus } from "./search.js";

export function handleContentFocus(context: RuntimeContext, key: string, keyAction: string | undefined): void {
  const { state, render, client, nextSignal, abortCurrent, load } = context;
  if (state.currentFollowing) {
    handleFollowingContentFocus(context, key);
    return;
  }
  if (state.currentSearch) {
    handleSearchContentFocus(context, key);
    return;
  }
  if (key === "j" || key === "\x1b[B") {
    const wasAtEnd = isAtListEnd(state);
    state.itemIndex = Math.min(Math.max(0, state.items.length - 1), state.itemIndex + 1);
    render();
    if (wasAtEnd && state.currentFeed?.hasMore && !state.loadingMore && !state.loading) {
      void loadNextFeedPage(client, state, render, nextSignal());
    }
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
    if (openSelectedMeItem(context) || openSelectedItem(context)) {
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
  if ((key === "n" || key === " ") && state.currentFeed) {
    void loadNextFeedPage(client, state, render, nextSignal());
    return;
  }
  if (key === "s" && state.currentUser && state.currentFeed?.kind !== "me-profile") {
    void openChat(client, state, state.currentUser.userId, state.currentUser.title, render, false, nextSignal());
    return;
  }
  if (key === "a" && state.currentUser) {
    void toggleCurrentUserFollow(context);
    return;
  }
  if (keyAction === "compose.open" && state.currentChat) {
    openComposeModal(context);
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
    if (state.currentFeed?.kind === "notifications-system") {
      void openNoticeList(client, state, "system", render, true, nextSignal(), false);
      return;
    }
    if (state.currentFeed?.kind === "notifications-at") {
      void openNoticeList(client, state, "at", render, true, nextSignal(), false);
      return;
    }
    if (state.currentFeed?.kind === "notifications-reply") {
      void openNoticeList(client, state, "reply", render, true, nextSignal(), false);
      return;
    }
    if (refreshCurrentMeView(context)) {
      return;
    }
    if (state.currentUser) {
      void openUserProfile(client, state, state.currentUser.userId, render, true, nextSignal(), false);
      return;
    }
    void load(true);
  }
}

export function isAtListEnd(state: RuntimeContext["state"]): boolean {
  return state.items.length > 0 && state.itemIndex >= state.items.length - 1;
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
  if (selected?.action === "notice.system") {
    void openNoticeList(client, state, "system", render, false, nextSignal());
    return true;
  }
  if (selected?.action === "notice.at") {
    void openNoticeList(client, state, "at", render, false, nextSignal());
    return true;
  }
  if (selected?.action === "notice.reply") {
    void openNoticeList(client, state, "reply", render, false, nextSignal());
    return true;
  }
  if (selected?.topicId !== undefined) {
    const boardContext = selected.boardId !== undefined && selected.boardTitle
      ? { boardId: selected.boardId, title: selected.boardTitle }
      : state.currentBoard;
    void openTopic(client, state, selected.topicId, render, config, true, nextSignal(), boardContext);
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
