import { isEmotionAssetPath } from "../media/emotion-preview.js";
import { loadModalImagePreview, supportsImagePreview } from "../media/image-preview.js";
import { currentTopicLine, currentTopicPost, getStatus } from "../tui-model.js";
import type { ContentItem, TuiState } from "../tui-model.js";
import type { RuntimeContext } from "./context.js";

export function handleImageModal(context: RuntimeContext, key: string): void {
  const { state, render } = context;
  if (!state.imageViewer) {
    state.modal = null;
    render();
    return;
  }
  if (key === " " || key === "\x1b" || key === "h" || key === "\r") {
    state.modal = null;
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "\x1b[C" || key === "l") {
    void stepTopicImageViewer(context, 1);
    return;
  }
  if (key === "\x1b[D" || key === "k") {
    void stepTopicImageViewer(context, -1);
  }
}

export function getChatMessageImages(item: ContentItem): string[] {
  if (!item.chatContent) {
    return [];
  }
  return item.chatContent.images.filter((url) => !isEmotionAssetPath(url));
}

export async function openChatImageViewer(context: RuntimeContext): Promise<void> {
  const { state, render } = context;
  if (!state.currentChat) {
    return;
  }
  if (!supportsImagePreview()) {
    state.status = "当前终端不支持图片大图预览";
    render();
    return;
  }

  const selected = state.items[state.itemIndex];
  const images = getChatMessageImages(selected);
  if (images.length === 0) {
    state.status = "当前消息没有可预览的图片";
    render();
    return;
  }

  state.imageViewer = {
    images,
    index: 0,
    loading: true
  };
  state.modal = "image";
  render();
  await refreshTopicImageViewer(context, 0);
}

export async function openTopicImageViewer(context: RuntimeContext): Promise<void> {
  const { state, render } = context;
  const topic = state.topic;
  if (!topic) {
    return;
  }
  if (!supportsImagePreview()) {
    state.status = "当前终端不支持图片大图预览";
    render();
    return;
  }

  const images = topic.posts
    .flatMap((post) => post.images)
    .filter((url) => !isEmotionAssetPath(url));
  if (images.length === 0) {
    state.status = "当前帖子没有可预览的大图";
    render();
    return;
  }

  const currentLine = currentTopicLine(topic, state.scroll);
  const currentPost = currentTopicPost(topic, state.scroll);
  const targetUrl = !isEmotionAssetPath(currentLine?.imageUrl ?? "")
    ? currentLine?.imageUrl
    : currentPost?.images.find((url) => !isEmotionAssetPath(url)) ?? images[0];
  const index = Math.max(0, images.findIndex((url) => url === targetUrl));
  state.imageViewer = {
    images,
    index,
    loading: true
  };
  state.modal = "image";
  render();
  await refreshTopicImageViewer(context, index);
}

export async function stepTopicImageViewer(context: RuntimeContext, delta: number): Promise<void> {
  const viewer = context.state.imageViewer;
  if (!viewer || viewer.images.length === 0) {
    return;
  }
  const nextIndex = Math.min(viewer.images.length - 1, Math.max(0, viewer.index + delta));
  if (nextIndex === viewer.index && viewer.token) {
    return;
  }
  viewer.index = nextIndex;
  viewer.loading = true;
  viewer.error = undefined;
  viewer.token = undefined;
  viewer.renderSize = undefined;
  context.state.modal = "image";
  context.render();
  await refreshTopicImageViewer(context, nextIndex);
}

async function refreshTopicImageViewer(context: RuntimeContext, index: number): Promise<void> {
  const { state, render } = context;
  const viewer = state.imageViewer;
  if (!viewer) {
    return;
  }

  const terminalSize = process.stdout.isTTY
    ? { columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 }
    : { columns: 80, rows: 24 };
  const modalWidth = Math.max(24, Math.min(terminalSize.columns - 4, Math.floor(terminalSize.columns * 0.92)));
  const modalHeight = Math.max(10, Math.min(terminalSize.rows - 2, Math.floor(terminalSize.rows * 0.9)));
  const maxColumns = Math.max(1, modalWidth - 2);
  const maxRows = Math.max(1, modalHeight - 2);
  const url = viewer.images[index];

  try {
    const loadedImage = await loadModalImagePreview(url ?? "", maxColumns, maxRows);
    if (!state.imageViewer || state.imageViewer.index !== index) {
      return;
    }
    state.imageViewer.loading = false;
    state.imageViewer.token = loadedImage?.token;
    state.imageViewer.renderSize = loadedImage?.size;
    state.imageViewer.error = loadedImage ? undefined : "当前终端无法显示这张图片";
  } catch (error) {
    if (!state.imageViewer || state.imageViewer.index !== index) {
      return;
    }
    state.imageViewer.loading = false;
    state.imageViewer.token = undefined;
    state.imageViewer.renderSize = undefined;
    state.imageViewer.error = error instanceof Error ? error.message : "图片加载失败";
  }
  render();
}
