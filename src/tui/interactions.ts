import { getSidebarWidth } from "./renderer.js";
import { clearTopicViewportAnchor } from "./topic-scroll.js";
import { settingsItems, type TuiState } from "./tui-model.js";

export function getSidebarDividerColumn(totalWidth: number, preferred?: number): number {
  const sidebarWidth = getSidebarWidth(totalWidth, preferred);
  return sidebarWidth + 2;
}

export function clampSidebarWidth(value: number, totalWidth: number): number {
  const maxWidth = Math.max(10, Math.floor(totalWidth * 0.35));
  return Math.max(10, Math.min(value, maxWidth));
}

export function handleMouseScroll(state: TuiState, delta: number): void {
  if (state.mode === "topic" && state.topic) {
    clearTopicViewportAnchor(state);
    const maxScroll = Math.max(0, state.topic.lines.length - 1);
    state.scroll = Math.max(0, Math.min(maxScroll, state.scroll + delta));
    return;
  }
  if (state.mode === "settings") {
    state.itemIndex = Math.max(0, Math.min(settingsItems.length - 1, state.itemIndex + Math.sign(delta)));
    return;
  }
  if (state.items.length > 0) {
    state.itemIndex = Math.max(0, Math.min(state.items.length - 1, state.itemIndex + Math.sign(delta)));
  }
}
