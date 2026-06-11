import type { TuiConfig } from "../config.js";
import type { TuiState } from "./tui-model.js";

export function clearTopicViewportAnchor(state: TuiState): void {
  state.topicViewportScroll = undefined;
}

export function setTopicScrollLine(state: TuiState, line: number): void {
  clearTopicViewportAnchor(state);
  const maxScroll = Math.max(0, (state.topic?.lines.length ?? 0) - 1);
  state.scroll = Math.max(0, Math.min(maxScroll, line));
}

export function getRenderedTopicVisibleScroll(
  state: TuiState,
  viewport: number,
  config: TuiConfig
): number {
  const maxScroll = Math.max(0, (state.topic?.lines.length ?? 0) - viewport);
  if (state.topicViewportScroll !== undefined) {
    return Math.max(0, Math.min(maxScroll, state.topicViewportScroll));
  }
  return getTopicVisibleScroll(state.scroll, viewport, maxScroll, config);
}

export function getTopicVisibleScroll(scroll: number, viewport: number, maxScroll: number, config: TuiConfig): number {
  const current = Math.min(Math.max(0, scroll), Math.max(0, maxScroll + viewport - 1));
  if (!config.topicScrollAtViewportEdge || viewport <= 0) {
    return Math.min(current, maxScroll);
  }
  return Math.max(0, Math.min(maxScroll, current - viewport + 1));
}
