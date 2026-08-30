import { loadNextFeedPage } from "../../data/content.js";
import {
  adjacentFavoriteGroup,
  loadFavoriteView,
  switchFavoriteGroup,
  unfavoriteTopicFromList
} from "../../data/favorites.js";
import { openTopic } from "../../data/topic.js";
import type { RuntimeContext } from "../context.js";
import { openFavoriteGroupMenu, startCreateFavoriteGroup } from "../modals.js";
import { leaveContentMode } from "../state.js";

export function handleFavoriteContentFocus(context: RuntimeContext, key: string): void {
  const { state, render, client, nextSignal, abortCurrent } = context;
  const favorites = state.currentFavorites;
  if (!favorites) {
    return;
  }

  if ((favorites.focus !== "tabs" && (key === "h" || key === "\x1b[D")) || key === "\x1b") {
    abortCurrent();
    leaveContentMode(state);
    render();
    return;
  }

  if (key === "o") {
    openFavoriteGroupMenu(context);
    return;
  }

  if (favorites.focus === "tabs") {
    if (key === "j" || key === "\x1b[B" || key === "\t" || key === "\r") {
      if (favorites.groupId === -1) {
        startCreateFavoriteGroup(context);
      } else if (state.items.length > 0) {
        favorites.focus = "results";
        render();
      }
      return;
    }
    if (key === "h" || key === "\x1b[D" || key === "l" || key === "\x1b[C") {
      abortCurrent();
      const nextGroupId = adjacentFavoriteGroup(state, key === "h" || key === "\x1b[D" ? -1 : 1);
      if (switchFavoriteGroup(state, nextGroupId)) {
        void loadFavoriteView(client, state, render, false, nextSignal());
      } else {
        render();
      }
      return;
    }
    if (key === "r") {
      void loadFavoriteView(client, state, render, true, nextSignal());
      return;
    }
    return;
  }

  if (key === "j" || key === "\x1b[B") {
    const wasAtEnd = isAtFavoritesEnd(state);
    state.itemIndex = Math.min(Math.max(0, state.items.length - 1), state.itemIndex + 1);
    render();
    if (wasAtEnd && favorites.hasMore && !state.loadingMore && !state.loading) {
      void loadNextFeedPage(client, state, render, nextSignal());
    }
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    if (state.itemIndex === 0) {
      favorites.focus = "tabs";
    } else {
      state.itemIndex = Math.max(0, state.itemIndex - 1);
    }
    render();
    return;
  }
  if (key === "l" || key === "\x1b[C" || key === "\r") {
    if (openFavoriteSelectedItem(context)) {
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
  if (key === "d") {
    const selected = state.items[state.itemIndex];
    if (selected?.topicId !== undefined) {
      void unfavoriteTopicFromList(client, state, render, selected.topicId);
    }
    return;
  }
  if (key === "r") {
    void loadFavoriteView(client, state, render, true, nextSignal());
  }
}

export function isAtFavoritesEnd(state: RuntimeContext["state"]): boolean {
  return Boolean(
    state.currentFavorites &&
    state.currentFavorites.focus === "results" &&
    state.items.length > 0 &&
    state.itemIndex >= state.items.length - 1
  );
}

function openFavoriteSelectedItem(context: RuntimeContext): boolean {
  const { state, render, client, config, nextSignal } = context;
  const selected = state.items[state.itemIndex];
  if (selected?.topicId !== undefined) {
    const boardContext = selected.boardId !== undefined
      ? { boardId: selected.boardId, title: selected.boardTitle }
      : state.currentBoard;
    void openTopic(client, state, selected.topicId, render, config, true, nextSignal(), boardContext);
    return true;
  }
  return false;
}
