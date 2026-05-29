import { checkForUpdate } from "../update.js";
import type { TuiConfig } from "../config.js";
import { createLoginForm, isPrintableInput, updateLoginField } from "./account-modal.js";
import {
  getDefaultAccountName,
  jumpRelativeTopicFloor,
  jumpToTopicFloor,
  loadNextChatPage,
  loadNextTopicPage,
  normalizeLoginMessage,
  openBoard,
  openChat,
  openTopic,
  refreshAccounts,
  restoreParentList
} from "./app-data.js";
import { loadModalImagePreview, supportsImagePreview } from "./image-preview.js";
import { fill, length, pad, rect, split } from "./layout.js";
import { getSidebarWidth } from "./renderer.js";
import { downloadUrlToDownloads } from "./downloads.js";
import { currentTopicLine, currentTopicPost, getStatus, navItems, settingsItems, type TuiState } from "./tui-model.js";
import type { CachedCc98Client } from "./cached-client.js";
import type { Cc98Client } from "../api/client.js";
import type { TokenStore } from "../storage/token-store.js";
import type { TuiKeymap } from "./keymap.js";
import type { MouseEvent } from "./terminal.js";

interface RuntimeContext {
  client: CachedCc98Client;
  rawClient: Cc98Client;
  tokenStore: TokenStore;
  config: TuiConfig;
  keymap: TuiKeymap;
  state: TuiState;
  render: () => void;
  load: (force?: boolean) => Promise<void>;
  nextSignal: () => AbortSignal;
  abortCurrent: () => void;
  close: () => void;
}

export function createMouseHandler(
  context: RuntimeContext,
  handleScroll: (state: TuiState, delta: number) => void,
  clampSidebarWidth: (value: number, totalWidth: number) => number,
  getDividerColumn: () => number,
  getSize: () => { columns: number; rows: number }
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
    const size = getSize();
    const dividerColumn = getDividerColumn();
    const withinFrame = event.row >= 2 && event.row < size.rows - 1;
    if (event.kind === "down" && event.button === "wheel-up") {
      handleScroll(state, -3);
      scheduleScrollRender();
      return;
    }
    if (event.kind === "down" && event.button === "wheel-down") {
      handleScroll(state, 3);
      scheduleScrollRender();
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

export function createKeyHandler(context: RuntimeContext): (key: string) => void {
  return (key) => {
    const { keymap, state, close, render } = context;
    const keyAction = keymap.feed(key);

    if (key === "\u0003" || key === "q") {
      close();
      return;
    }

    if (key === "?") {
      state.modal = state.modal === "help" ? null : "help";
      render();
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

function showNotification(state: TuiState, message: string, durationMs = 3200): void {
  state.notification = {
    message,
    expiresAt: Date.now() + durationMs
  };
}

function handleAccountModal(context: RuntimeContext, key: string): void {
  const { state, render, tokenStore, load } = context;
  if (key === "j" || key === "\x1b[B") {
    state.accountModal.selectedIndex = Math.min(state.accountModal.accounts.length, state.accountModal.selectedIndex + 1);
    render();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.accountModal.selectedIndex = Math.max(0, state.accountModal.selectedIndex - 1);
    render();
    return;
  }
  if (key === "h" || key === "\x1b[D" || key === "\x1b") {
    state.modal = null;
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "\r" || key === "l" || key === "\x1b[C") {
    if (state.accountModal.selectedIndex === state.accountModal.accounts.length) {
      state.loginForm = createLoginForm();
      state.modal = "login";
      render();
      return;
    }
    const selected = state.accountModal.accounts[state.accountModal.selectedIndex];
    if (!selected) {
      return;
    }
    state.status = `正在切换到 @${selected.account}...`;
    state.modal = null;
    render();
    void tokenStore.useAccount(selected.account).then(() => {
      state.account = selected.account;
      showNotification(state, `已切换到 @${selected.account}`);
      void load(true);
    }).catch((error: unknown) => {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = "账号切换失败";
      render();
    });
  }
}

function handleLoginModal(context: RuntimeContext, key: string): void {
  const { state, render, rawClient, tokenStore, load } = context;
  if (state.loginForm.submitting) {
    return;
  }
  if (key === "\t" || key === "j" || key === "\x1b[B") {
    state.loginForm.fieldIndex = (state.loginForm.fieldIndex + 1) % 3;
    render();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.loginForm.fieldIndex = (state.loginForm.fieldIndex + 2) % 3;
    render();
    return;
  }
  if (key === "h" || key === "\x1b[D" || key === "\x1b") {
    state.modal = "account";
    state.loginForm.error = undefined;
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "l" || key === "\x1b[C") {
    if (state.loginForm.fieldIndex < 2) {
      state.loginForm.fieldIndex += 1;
      render();
    }
    return;
  }
  if (key === "\x7f") {
    updateLoginField(state.loginForm, (value) => value.slice(0, -1));
    render();
    return;
  }
  if (key === "\r") {
    if (state.loginForm.fieldIndex < 2) {
      state.loginForm.fieldIndex += 1;
      render();
      return;
    }

    const username = state.loginForm.username.trim();
    const password = state.loginForm.password;
    if (!username || !password) {
      state.loginForm.error = "用户名和密码不能为空";
      render();
      return;
    }

    state.loginForm.submitting = true;
    state.loginForm.error = undefined;
    state.status = `正在登录 ${username}...`;
    render();

    void rawClient.loginWithPassword(username, password).then(async (token) => {
      const me = await rawClient.getMeWithAccessToken(token.accessToken);
      const resolvedAccount = getDefaultAccountName(me, username);
      await tokenStore.saveAccount(resolvedAccount, {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        userId: typeof me.id === "number" ? me.id : undefined,
        username,
        displayName: typeof me.name === "string" ? me.name : undefined
      });
      state.account = resolvedAccount;
      await refreshAccounts(state, tokenStore);
      state.loginForm = createLoginForm();
      state.modal = null;
      showNotification(state, `已登录为 ${typeof me.name === "string" ? me.name : username}`);
      await load(true);
    }).catch((error: unknown) => {
      state.loginForm.submitting = false;
      state.loginForm.error = normalizeLoginMessage(error);
      state.status = "登录失败";
      render();
    });
    return;
  }
  if (isPrintableInput(key)) {
    updateLoginField(state.loginForm, (value) => `${value}${key}`);
    render();
  }
}

function handleConfirmModal(context: RuntimeContext, key: string): void {
  const { state, render, client, tokenStore, load } = context;
  if (!state.confirmDialog) {
    state.modal = null;
    render();
    return;
  }
  if (key === "j" || key === "\x1b[B" || key === "\t") {
    state.confirmDialog.selectedIndex = Math.min(1, state.confirmDialog.selectedIndex + 1);
    render();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.confirmDialog.selectedIndex = Math.max(0, state.confirmDialog.selectedIndex - 1);
    render();
    return;
  }
  if (key === "h" || key === "\x1b[D" || key === "\x1b") {
    state.modal = null;
    state.confirmDialog = undefined;
    state.status = getStatus(state);
    render();
    return;
  }
  if (key !== "\r") {
    return;
  }
  if (state.confirmDialog.selectedIndex === 1) {
    state.modal = null;
    state.confirmDialog = undefined;
    state.status = getStatus(state);
    render();
    return;
  }

  const action = state.confirmDialog.action;
  state.modal = null;

  if (action === "cache-cleanup") {
    state.status = "正在清理缓存...";
    render();
    void client.clearCache().then(() => {
      showNotification(state, "缓存已清理");
      void load(true);
    }).catch((error: unknown) => {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = "缓存清理失败";
      render();
    }).finally(() => {
      state.confirmDialog = undefined;
    });
    return;
  }

  const account = state.account;
  state.status = account ? `正在退出 @${account}...` : "正在清除登录信息...";
  render();

  void (async () => {
    if (account) {
      await tokenStore.removeAccount(account);
    } else {
      await tokenStore.clear();
    }
    state.account = await tokenStore.getCurrentAccountName();
    await refreshAccounts(state, tokenStore);
    showNotification(state, "已退出登录");
    await load(true);
  })().catch((error: unknown) => {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "退出登录失败";
    render();
  }).finally(() => {
    state.confirmDialog = undefined;
  });
}

function handleTopicMode(context: RuntimeContext, key: string, keyAction: string | undefined): void {
  const { state, render, client, config, nextSignal, abortCurrent } = context;
  if (key === ":" && state.topic && !state.topic.floorInput) {
    state.topic.floorInput = ":";
    state.status = "跳转到楼层：输入数字后 Enter 确认  Esc 取消";
    render();
    return;
  }
  if (/^\d$/.test(key) && state.topic?.floorInput.startsWith(":")) {
    if (state.topic.floorInput === ":" && key === "0") {
      return;
    }
    state.topic.floorInput = `${state.topic.floorInput}${key}`.slice(0, 7);
    state.status = `跳转到 ${state.topic.floorInput.slice(1)} 楼：Enter 确认  Esc 取消`;
    render();
    return;
  }
  if (key === "\x7f" && state.topic?.floorInput) {
    state.topic.floorInput = state.topic.floorInput.slice(0, -1);
    state.status = state.topic.floorInput
      ? state.topic.floorInput === ":"
        ? "跳转到楼层：输入数字后 Enter 确认  Esc 取消"
        : `跳转到 ${state.topic.floorInput.slice(1)} 楼：Enter 确认  Esc 取消`
      : getStatus(state);
    render();
    return;
  }
  if (key === "\r" && state.topic?.floorInput) {
    const floor = Number(state.topic.floorInput.slice(1));
    state.topic.floorInput = "";
    if (Number.isInteger(floor) && floor > 0) {
      void jumpToTopicFloor(client, state, floor, render, config, nextSignal());
    } else {
      state.status = getStatus(state);
      render();
    }
    return;
  }
  if ((key === "]" || key === "】" || keyAction === "topic.next-reply") && state.topic) {
    jumpRelativeTopicFloor(state, 1);
    state.status = getStatus(state);
    render();
    return;
  }
  if ((key === "[" || key === "【" || keyAction === "topic.previous-reply") && state.topic) {
    jumpRelativeTopicFloor(state, -1);
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "h" || key === "\x1b[D") {
    abortCurrent();
    leaveTopicMode(state);
    render();
    return;
  }
  if (key === "\x1b" && state.topic?.floorInput) {
    state.topic.floorInput = "";
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === "j" || key === "\x1b[B") {
    const maxScroll = Math.max(0, (state.topic?.lines.length ?? 0) - 1);
    const wasAtEnd = state.scroll >= maxScroll;
    state.scroll = Math.min(maxScroll, state.scroll + 1);
    state.status = getStatus(state);
    render();
    if (wasAtEnd && state.topic?.hasMore && !state.loadingMore) {
      void loadNextTopicPage(client, state, render, config, nextSignal(), true);
    }
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.scroll = Math.max(0, state.scroll - 1);
    state.status = getStatus(state);
    render();
    return;
  }
  if (key === " ") {
    void openTopicImageViewer(context);
    return;
  }
  if (key === "n") {
    void loadNextTopicPage(client, state, render, config, nextSignal());
    return;
  }
  if (key === "\x1b[C") {
    void stepTopicImageViewer(context, 1);
    return;
  }
  if (key === "r") {
    if (state.topic) {
      void openTopic(client, state, state.topic.topicId, render, config, true, nextSignal());
    }
    return;
  }
}

function handleImageModal(context: RuntimeContext, key: string): void {
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
    return;
  }
}

async function openTopicImageViewer(context: RuntimeContext): Promise<void> {
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

  const images = topic.posts.flatMap((post) => post.images);
  if (images.length === 0) {
    state.status = "当前帖子没有可预览的图片";
    render();
    return;
  }

  const currentLine = currentTopicLine(topic, state.scroll);
  const currentPost = currentTopicPost(topic, state.scroll);
  const targetUrl = currentLine?.imageUrl ?? currentPost?.images[0] ?? images[0];
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

async function stepTopicImageViewer(context: RuntimeContext, delta: number): Promise<void> {
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

function leaveTopicMode(state: TuiState): void {
  state.mode = "list";
  state.focus = "content";
  state.viewTitle = state.currentBoard?.title ?? state.currentChat?.title ?? navItems[state.navIndex]?.label ?? state.viewTitle;
  state.status = getStatus(state);
}

function enterContentMode(state: TuiState, resetIndex = false): void {
  if (navItems[state.navIndex]?.id === "settings") {
    state.mode = "settings";
  }
  state.focus = "content";
  if (resetIndex) {
    state.itemIndex = 0;
  }
  state.status = getStatus(state);
}

function leaveContentMode(state: TuiState): void {
  if (state.parentList) {
    restoreParentList(state);
    return;
  }
  state.mode = "list";
  state.focus = "nav";
  state.status = getStatus(state);
}

function openSelectedItem(context: RuntimeContext): boolean {
  const { state, render, client, config, nextSignal } = context;
  const selected = state.items[state.itemIndex];
  if (selected?.topicId !== undefined) {
    void openTopic(client, state, selected.topicId, render, config, false, nextSignal());
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
  return false;
}

async function handleTopicClick(
  context: RuntimeContext,
  event: MouseEvent,
  columns: number,
  rows: number
): Promise<void> {
  const { state, render } = context;
  if (state.mode !== "topic" || !state.topic || state.loading || state.error) {
    return;
  }

  const mainArea = getMainAreaRect(columns, rows, context.config, state.sidebarWidth);
  if (!withinRect(event.column, event.row, mainArea)) {
    return;
  }

  const bodyRow = event.row - (mainArea.y + 1);
  const bodyLineIndex = bodyRow - 3;
  if (bodyLineIndex < 0) {
    return;
  }

  const absoluteLine = state.scroll + bodyLineIndex;
  const lineEntry = state.topic.posts
    .flatMap((post) => post.lines)
    .find((entry) => entry.line === absoluteLine);
  const url = lineEntry?.linkUrl ?? lineEntry?.imageUrl;
  if (!url) {
    return;
  }

  state.status = `正在下载 ${shortUrl(url)}...`;
  render();

  try {
    const savedPath = await downloadUrlToDownloads(url);
    showNotification(state, `已下载到 ${savedPath}`);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "下载失败";
  } finally {
    render();
  }
}

function handleSidebarClick(
  context: RuntimeContext,
  event: MouseEvent,
  columns: number,
  rows: number
): boolean {
  const { state, render, load, abortCurrent } = context;
  if (state.mode === "topic") {
    return false;
  }

  const sidebarArea = getSidebarAreaRect(columns, rows, context.config, state.sidebarWidth);
  if (sidebarArea.width <= 0 || !withinRect(event.column, event.row, sidebarArea)) {
    return false;
  }

  const rowIndex = event.row - (sidebarArea.y + 1);
  if (rowIndex < 0 || rowIndex >= navItems.length) {
    return true;
  }

  const nextNavIndex = Math.max(0, Math.min(navItems.length - 1, rowIndex));
  if (state.navIndex === nextNavIndex && state.focus === "nav" && state.mode !== "settings") {
    return true;
  }

  abortCurrent();
  state.navIndex = nextNavIndex;
  state.focus = "nav";
  if (state.mode === "settings") {
    state.mode = "list";
  }
  state.status = getStatus(state);
  render();
  void load();
  return true;
}

function handleContentClick(
  context: RuntimeContext,
  event: MouseEvent,
  columns: number,
  rows: number
): boolean {
  const { state, render } = context;
  if (state.mode === "topic" || state.loading || state.error) {
    return false;
  }

  const mainArea = getMainAreaRect(columns, rows, context.config, state.sidebarWidth);
  if (!withinRect(event.column, event.row, mainArea)) {
    return false;
  }

  if (navItems[state.navIndex]?.id === "settings" && state.mode !== "settings") {
    state.mode = "settings";
  }

  if (state.mode === "settings") {
    const rowIndex = event.row - (mainArea.y + 1) - 2;
    if (rowIndex < 0 || rowIndex >= settingsItems.length) {
      return true;
    }
    state.itemIndex = rowIndex;
    enterContentMode(state);
    render();
    return true;
  }

  const rowIndex = event.row - (mainArea.y + 1) - 2;
  if (rowIndex < 0) {
    return true;
  }

  const itemHeight = 2;
  if (rowIndex % itemHeight !== 0 && rowIndex % itemHeight !== 1) {
    return true;
  }
  const visibleCapacity = Math.max(1, Math.floor(Math.max(1, mainArea.height - 2) / itemHeight));
  const scroll = getContentListScroll(state, visibleCapacity);
  const itemOffset = Math.floor(rowIndex / itemHeight);
  const itemIndex = scroll + itemOffset;
  if (itemIndex < 0 || itemIndex >= state.items.length) {
    return true;
  }

  state.itemIndex = itemIndex;
  enterContentMode(state);
  render();
  return true;
}

function getMainAreaRect(
  columns: number,
  rows: number,
  config: TuiConfig,
  sidebarWidthOverride?: number
): { x: number; y: number; width: number; height: number } {
  const { mainArea } = getBodyColumnRects(columns, rows, config, sidebarWidthOverride);
  return mainArea;
}

function getSidebarAreaRect(
  columns: number,
  rows: number,
  config: TuiConfig,
  sidebarWidthOverride?: number
): { x: number; y: number; width: number; height: number } {
  const { sidebarArea } = getBodyColumnRects(columns, rows, config, sidebarWidthOverride);
  return sidebarArea;
}

function getBodyColumnRects(
  columns: number,
  rows: number,
  config: TuiConfig,
  sidebarWidthOverride?: number
): {
  sidebarArea: { x: number; y: number; width: number; height: number };
  mainArea: { x: number; y: number; width: number; height: number };
} {
  const width = Math.max(1, columns);
  const height = Math.max(1, rows);
  const outer = rect(width, Math.max(0, height - 1));
  const root = pad(outer, 1);
  const verticalLayout = config.hideTopChrome
    ? [fill()]
    : [length(1), length(1), length(1), length(1), fill()];
  const areas = split(root, "vertical", verticalLayout);
  const bodyArea = config.hideTopChrome ? areas[0] : areas[4];
  const sidebarWidth = getSidebarWidth(width, sidebarWidthOverride);
  const bodyColumns = split(bodyArea, "horizontal", [
    length(sidebarWidth),
    length(sidebarWidth > 0 ? 1 : 0),
    fill()
  ]);
  return {
    sidebarArea: bodyColumns[0],
    mainArea: bodyColumns[2]
  };
}

function getContentListScroll(state: TuiState, visibleCapacity: number): number {
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

function withinRect(column: number, row: number, area: { x: number; y: number; width: number; height: number }): boolean {
  const x = column - 1;
  const y = row - 1;
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const fileName = url.pathname.split("/").filter(Boolean).at(-1) ?? url.host;
    return `${url.host}/${fileName}`;
  } catch {
    return value;
  }
}

function handleSettingsMode(context: RuntimeContext, key: string): void {
  const { state, render, tokenStore, load } = context;
  if (key === "j" || key === "\x1b[B") {
    state.itemIndex = Math.min(settingsItems.length - 1, state.itemIndex + 1);
    render();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.itemIndex = Math.max(0, state.itemIndex - 1);
    render();
    return;
  }
  if (key === "h" || key === "\x1b[D") {
    leaveContentMode(state);
    render();
    return;
  }
  if (key !== "l" && key !== "\x1b[C" && key !== "\r") {
    return;
  }
  const selected = settingsItems[state.itemIndex];
  if (selected?.meta === "help") {
    state.modal = "help";
    render();
    return;
  }
  if (selected?.meta === "cache") {
    state.confirmDialog = {
      title: "缓存清理",
      detail: "清理过期文件缓存，并清空当前会话中的内存缓存？",
      confirmLabel: "确认清理",
      cancelLabel: "取消",
      selectedIndex: 1,
      action: "cache-cleanup"
    };
    state.modal = "confirm";
    render();
    return;
  }
  if (selected?.meta === "logout") {
    state.confirmDialog = {
      title: "退出登录",
      detail: state.account
        ? `删除本地账号 @${state.account} 的登录信息？`
        : "清除本地登录信息？",
      confirmLabel: "确认退出",
      cancelLabel: "取消",
      selectedIndex: 1,
      action: "logout"
    };
    state.modal = "confirm";
    render();
    return;
  }
  if (selected?.meta === "account") {
    void refreshAccounts(state, tokenStore).then(() => {
      if (state.accountModal.accounts.length === 0) {
        state.loginForm = createLoginForm();
        state.modal = "login";
      } else {
        state.modal = "account";
      }
      render();
    }).catch((error: unknown) => {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = "读取账号列表失败";
      render();
    });
    return;
  }
  if (selected?.meta === "update") {
    state.status = "正在检查 GitHub Release...";
    render();
    void checkForUpdate().then((result) => {
      showNotification(state, result.message);
      render();
    }).catch((error: unknown) => {
      state.status = error instanceof Error ? error.message : "检查更新失败";
      render();
    });
    return;
  }
  void load(true);
}

function handleNavFocus(context: RuntimeContext, key: string): void {
  const { state, render, load } = context;
  if (key === "j" || key === "\x1b[B") {
    state.navIndex = Math.min(navItems.length - 1, state.navIndex + 1);
    void load();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    state.navIndex = Math.max(0, state.navIndex - 1);
    void load();
    return;
  }
  if (key === "l" || key === "\x1b[C" || key === "\r") {
    if (!state.loading && state.items.length > 0) {
      enterContentMode(state, key === "\r");
      render();
    }
    return;
  }
  if (key === "r") {
    void load(true);
  }
}

function handleContentFocus(context: RuntimeContext, key: string): void {
  const { state, render, client, config, nextSignal, abortCurrent, load } = context;
  if (key === "j" || key === "\x1b[B") {
    state.itemIndex = Math.min(Math.max(0, state.items.length - 1), state.itemIndex + 1);
    render();
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
    if (openSelectedItem(context)) {
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
  if (key === "r") {
    if (state.currentBoard) {
      void openBoard(client, state, state.currentBoard.boardId, state.currentBoard.title, render, true, nextSignal(), false);
      return;
    }
    if (state.currentChat) {
      void openChat(client, state, state.currentChat.userId, state.currentChat.title, render, true, nextSignal(), false);
      return;
    }
    void load(true);
    return;
  }
}
