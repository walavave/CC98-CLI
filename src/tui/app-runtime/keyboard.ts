import type { RuntimeContext } from "./context.js";
import { jumpToTopicFloor, openTopic } from "../app-data.js";
import { ensureEmotionPreviews, getEmotionCategory } from "../emotion-catalog.js";
import { isPrintableInput } from "../account-modal.js";
import { focusSearchInput, handleContentFocus, handleNavFocus, handleSettingsMode } from "./content.js";
import { handleImageModal } from "./image-viewer.js";
import {
  closeComposeModal,
  closeEmotionPicker,
  handleComposeBackspace,
  handleAccountModal,
  handleConfirmModal,
  handleLoginModal,
  insertComposeText,
  moveComposeCursor,
  moveEmotionGrid,
  moveEmotionSidebar
} from "./modals.js";
import { handleTopicMode } from "./topic.js";

export function createKeyHandler(context: RuntimeContext): (key: string) => void {
  return (key) => {
    const { keymap, state, close, render } = context;
    const keyAction = keymap.feed(key);

    if (key === "\u0003" || key === "q") {
      close();
      return;
    }

    if (state.modal === "help") {
      if (key === "h" || key === "\x1b[D" || key === "\x1b" || key === "?" || key === "\r") {
        state.modal = null;
        render();
      }
      return;
    }

    if (state.modal === "account") {
      handleAccountModal(context, key);
      return;
    }

    if (state.modal === "login") {
      handleLoginModal(context, key);
      return;
    }

    if (state.modal === "confirm") {
      handleConfirmModal(context, key);
      return;
    }

    if (state.modal === "image") {
      handleImageModal(context, key);
      return;
    }

    if (state.modal === "compose") {
      handleComposeModal(context, key, keyAction);
      return;
    }

    if (state.modal === "emotion-picker") {
      handleEmotionPickerModal(context, key);
      return;
    }

    if (key === "?") {
      state.modal = "help";
      render();
      return;
    }

    if (keyAction === "search.focus-input") {
      void focusSearchInput(context);
      return;
    }

    if (state.mode === "topic") {
      handleTopicMode(context, key, keyAction);
      return;
    }

    if (state.mode === "settings") {
      handleSettingsMode(context, key);
      return;
    }

    if (state.focus === "nav") {
      handleNavFocus(context, key);
      return;
    }

    handleContentFocus(context, key);
  };
}

function handleComposeModal(context: RuntimeContext, key: string, keyAction: string | undefined): void {
  const { state, render } = context;
  const compose = state.composeDialog;
  if (!compose || compose.submitting) {
    return;
  }
  if (key === "\x1b") {
    closeComposeModal(context);
    return;
  }
  if (key === "\x7f") {
    handleComposeBackspace(context);
    render();
    return;
  }
  if (key === "\x1b[D") {
    moveComposeCursor(context, -1);
    render();
    return;
  }
  if (key === "\x1b[C") {
    moveComposeCursor(context, 1);
    render();
    return;
  }
  if (keyAction === "compose.open-emotion") {
    state.modal = "emotion-picker";
    state.status = "表情：方向键选择  Enter 插入  其它键关闭";
    render();
    void warmEmotionPicker(context);
    return;
  }
  if (key === "\r") {
    void submitCompose(context);
    return;
  }
  if (key === "\t") {
    insertComposeText(context, "  ");
    render();
    return;
  }
  if (key === "\n") {
    insertComposeText(context, "\n");
    render();
    return;
  }
  if (key === "\x0b") {
    insertComposeText(context, "\n");
    render();
    return;
  }
  if (isPrintableComposeInput(key)) {
    insertComposeText(context, key);
    render();
  }
}

function handleEmotionPickerModal(context: RuntimeContext, key: string): void {
  const { state, render } = context;
  const compose = state.composeDialog;
  if (!compose) {
    state.modal = null;
    render();
    return;
  }

  if (key === "\r") {
    const entry = getCurrentEmotionEntry(compose);
    if (entry) {
      insertComposeText(context, entry.code);
    }
    closeEmotionPicker(context);
    render();
    return;
  }

  if (key === "\x1b") {
    closeEmotionPicker(context);
    render();
    return;
  }

  if (key === "\x1b[A" || key === "k") {
    if (compose.emotionFocus === "sidebar") {
      moveEmotionSidebar(context, -1);
    } else {
      moveEmotionGrid(context, -getEmotionGridColumns(context));
    }
    render();
    void warmEmotionPicker(context);
    return;
  }

  if (key === "\x1b[B" || key === "j") {
    if (compose.emotionFocus === "sidebar") {
      moveEmotionSidebar(context, 1);
    } else {
      moveEmotionGrid(context, getEmotionGridColumns(context));
    }
    render();
    void warmEmotionPicker(context);
    return;
  }

  if (key === "\x1b[D" || key === "h") {
    if (compose.emotionFocus === "grid") {
      const columns = getEmotionGridColumns(context);
      if (compose.emotionSelectedIndex % columns === 0) {
        compose.emotionFocus = "sidebar";
      } else {
        moveEmotionGrid(context, -1);
      }
      render();
      void warmEmotionPicker(context);
      return;
    }
  }

  if (key === "\x1b[C" || key === "l") {
    if (compose.emotionFocus === "sidebar") {
      compose.emotionFocus = "grid";
      render();
      void warmEmotionPicker(context);
      return;
    }
    moveEmotionGrid(context, 1);
    render();
    void warmEmotionPicker(context);
    return;
  }

  closeEmotionPicker(context);
  if (key === "\x7f") {
    handleComposeBackspace(context);
  } else if (isPrintableComposeInput(key)) {
    insertComposeText(context, key);
  }
  render();
}

function isPrintableComposeInput(key: string): boolean {
  return key === " " || isPrintableInput(key);
}

function getCurrentEmotionEntry(compose: NonNullable<RuntimeContext["state"]["composeDialog"]>) {
  const category = getEmotionCategory(compose.emotionCategoryIndex);
  return category.entries[compose.emotionSelectedIndex];
}

function getEmotionGridColumns(context: RuntimeContext): number {
  const width = context.getSize().columns;
  const modalWidth = Math.min(Math.max(1, width - 2), Math.max(56, Math.floor(width * 0.78)));
  const innerWidth = Math.max(1, modalWidth - 2);
  const sidebarWidth = Math.max(8, Math.min(12, Math.floor(innerWidth * 0.2)));
  const gridWidth = Math.max(1, innerWidth - sidebarWidth - 1);
  return Math.max(1, Math.floor(gridWidth / 11));
}

async function submitCompose(context: RuntimeContext): Promise<void> {
  const { client, state, render, config, nextSignal } = context;
  const compose = state.composeDialog;
  const topic = state.topic;
  if (!compose || !topic) {
    return;
  }

  const content = compose.draft.trim();
  if (!content) {
    state.status = "评论内容不能为空";
    render();
    return;
  }
  const payload = config.postSignature ? `${content}${config.postSignature}` : content;

  compose.submitting = true;
  state.status = "正在发送评论...";
  render();

  try {
    const result = await client.replyTopic(topic.topicId, payload);
    const floor = typeof result === "object" && result !== null && typeof (result as { floor?: unknown }).floor === "number"
      ? (result as { floor: number }).floor
      : undefined;
    state.composeDialog = undefined;
    state.modal = null;
    await openTopic(client, state, topic.topicId, render, config, true, nextSignal());
    if (floor && state.topic) {
      await jumpToTopicFloor(client, state, floor, render, config, nextSignal());
    }
    state.status = floor ? `已发送到 ${floor} 楼` : "评论已发送";
    render();
  } catch (error) {
    compose.submitting = false;
    state.status = `评论发送失败：${error instanceof Error ? error.message : String(error)}`;
    render();
  }
}

async function warmEmotionPicker(context: RuntimeContext): Promise<void> {
  const compose = context.state.composeDialog;
  if (!compose || context.state.modal !== "emotion-picker") {
    return;
  }

  const category = getEmotionCategory(compose.emotionCategoryIndex);
  const columns = getEmotionGridColumns(context);
  const pageRows = getEmotionGridRows(context);
  const pageSize = columns * pageRows;
  const start = Math.max(0, Math.floor(compose.emotionSelectedIndex / pageSize) * pageSize);
  const visible = category.entries.slice(start, start + pageSize);
  try {
    await ensureEmotionPreviews(visible, 9);
  } catch {
    return;
  }
  if (context.state.modal === "emotion-picker") {
    context.render();
  }
}

function getEmotionGridRows(context: RuntimeContext): number {
  const rows = context.getSize().rows;
  const modalHeight = Math.min(Math.max(1, rows - 2), Math.max(18, Math.floor(rows * 0.72)));
  return Math.max(1, Math.floor(Math.max(1, modalHeight - 4) / 5));
}
