import { loadNextSearchPage, loadNextTopicPage } from "../app-data.js";
import type { MouseEvent } from "../terminal.js";
import type { TuiState } from "../tui-model.js";
import type { RuntimeContext } from "./context.js";
import { isAtSearchEnd } from "./content.js";
import { handleContentClick, handleSidebarClick, handleTopicClick } from "./interactions.js";
import { isAtTopicEnd } from "./topic.js";

export function createMouseHandler(
  context: RuntimeContext,
  handleScroll: (state: TuiState, delta: number) => void,
  clampSidebarWidth: (value: number, totalWidth: number) => number,
  getDividerColumn: () => number
): (event: MouseEvent) => void {
  let pendingScrollRender: ReturnType<typeof setTimeout> | undefined;
  const scheduleScrollRender = () => {
    if (pendingScrollRender) {
      clearTimeout(pendingScrollRender);
    }
    pendingScrollRender = setTimeout(() => {
      pendingScrollRender = undefined;
      context.render();
    }, 80);
  };
  return (event) => {
    const { state, render } = context;
    if (state.modal) {
      if (event.kind === "up") {
        state.draggingSidebarDivider = false;
      }
      return;
    }
    const size = context.getSize();
    const dividerColumn = getDividerColumn();
    const withinFrame = event.row >= 2 && event.row < size.rows - 1;
    if (event.kind === "down" && event.button === "wheel-up") {
      handleScroll(state, -3);
      scheduleScrollRender();
      return;
    }
    if (event.kind === "down" && event.button === "wheel-down") {
      const wasAtTopicEnd = isAtTopicEnd(state, context.config, size.rows);
      const wasAtSearchEnd = isAtSearchEnd(state);
      handleScroll(state, 3);
      scheduleScrollRender();
      if (wasAtTopicEnd && state.mode === "topic" && state.topic?.hasMore && !state.loadingMore) {
        void loadNextTopicPage(context.client, state, render, context.config, context.nextSignal(), true);
      } else if (wasAtSearchEnd && state.currentSearch?.hasMore && !state.loadingMore && !state.loading) {
        void loadNextSearchPage(context.client, state, render, context.nextSignal());
      }
      return;
    }
    if (event.kind === "down" && event.button === "left" && withinFrame && event.column === dividerColumn) {
      state.draggingSidebarDivider = true;
      return;
    }
    if (event.kind === "drag" && state.draggingSidebarDivider) {
      state.sidebarWidth = clampSidebarWidth(event.column - 1, size.columns);
      render();
      return;
    }
    if (event.kind === "up") {
      state.draggingSidebarDivider = false;
      if (event.button === "left") {
        if (handleSidebarClick(context, event, size.columns, size.rows)) {
          return;
        }
        if (handleContentClick(context, event, size.columns, size.rows)) {
          return;
        }
        void handleTopicClick(context, event, size.columns, size.rows);
      }
    }
  };
}
