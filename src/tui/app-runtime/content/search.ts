import { openBoard, openChat, openUserProfile } from "../../data/content.js";
import { executeSearch, loadNextSearchPage, switchSearchKind } from "../../data/search.js";
import { openTopic } from "../../data/topic.js";
import { isPrintableInput, isPrintableTextInput } from "../../account-modal.js";
import type { RuntimeContext } from "../context.js";
import type { SearchKind } from "../../tui-model.js";
import { leaveContentMode } from "../state.js";

export function handleSearchContentFocus(context: RuntimeContext, key: string): void {
  const { state, render, client, nextSignal, abortCurrent, load } = context;
  const search = state.currentSearch;
  if (!search) {
    return;
  }

  if ((search.focus !== "tabs" && (key === "h" || key === "\x1b[D")) || key === "\x1b") {
    abortCurrent();
    leaveContentMode(state);
    render();
    return;
  }

  if (search.focus === "input") {
    if (key === "k" || key === "\x1b[A") {
      search.focus = "tabs";
      render();
      return;
    }
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
    if (isPrintableInput(key) || isPrintableTextInput(key)) {
      search.draft = `${search.draft}${key}`;
      render();
    }
    return;
  }

  if (search.focus === "tabs") {
    if (key === "j" || key === "\x1b[B" || key === "\t" || key === "\r") {
      search.focus = "input";
      render();
      return;
    }
    if (key === "h" || key === "\x1b[D" || key === "l" || key === "\x1b[C") {
      abortCurrent();
      if (switchSearchKind(state, adjacentSearchKind(search.kind, searchKinds(search), key === "h" || key === "\x1b[D" ? -1 : 1))) {
        search.focus = "tabs";
      }
      render();
      return;
    }
    if (isPrintableInput(key) || isPrintableTextInput(key)) {
      search.focus = "input";
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
    if (openSearchSelectedItem(context)) {
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
  if (isPrintableInput(key) || isPrintableTextInput(key)) {
    search.focus = "input";
    search.draft = `${search.draft}${key}`;
    render();
  }
}

function searchKinds(search: NonNullable<RuntimeContext["state"]["currentSearch"]>): SearchKind[] {
  return search.board ? ["topic", "board", "user", "board-topic"] : ["topic", "board", "user"];
}

function adjacentSearchKind(current: SearchKind, kinds: SearchKind[], offset: number): SearchKind {
  const currentIndex = Math.max(0, kinds.indexOf(current));
  return kinds[(currentIndex + offset + kinds.length) % kinds.length] ?? current;
}

export function isAtSearchEnd(state: RuntimeContext["state"]): boolean {
  return Boolean(
    state.currentSearch &&
    state.currentSearch.focus === "results" &&
    state.items.length > 0 &&
    state.itemIndex >= state.items.length - 1
  );
}

function openSearchSelectedItem(context: RuntimeContext): boolean {
  const { state, render, client, config, nextSignal } = context;
  const selected = state.items[state.itemIndex];
  if (selected?.topicId !== undefined) {
    const boardContext = selected.boardId !== undefined && selected.boardTitle
      ? { boardId: selected.boardId, title: selected.boardTitle }
      : state.currentSearch?.kind === "board-topic" ? state.currentSearch.board : state.currentBoard;
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
