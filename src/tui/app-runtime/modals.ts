import { checkForUpdate } from "../../update.js";
import { createLoginForm, isPrintableInput, updateLoginField } from "../account-modal.js";
import { emotionCategories, getEmotionCategory } from "../emotion-catalog.js";
import { graphemes } from "../text.js";
import { getDefaultAccountName, normalizeLoginMessage, refreshAccounts } from "../data/accounts.js";
import { getStatus } from "../tui-model.js";
import type { RuntimeContext } from "./context.js";
import { showNotification } from "./state.js";

export function handleAccountModal(context: RuntimeContext, key: string): void {
  const { state, render, tokenStore, load, client } = context;
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
    void tokenStore.useAccount(selected.account).then(async () => {
      await client.clearCache();
      state.account = selected.account;
      showNotification(state, `已切换到 @${selected.account}`);
      await load(true);
    }).catch((error: unknown) => {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = "账号切换失败";
      render();
    });
  }
}

export function handleLoginModal(context: RuntimeContext, key: string): void {
  const { state, render, rawClient, tokenStore, load, client } = context;
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
      await client.clearCache();
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

export function handleConfirmModal(context: RuntimeContext, key: string): void {
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
    await client.clearCache();
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

export function openAccountOrLoginModal(context: RuntimeContext): void {
  const { state, render, tokenStore } = context;
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
}

export function requestCacheCleanup(context: RuntimeContext): void {
  const { state, render } = context;
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
}

export function requestLogout(context: RuntimeContext): void {
  const { state, render } = context;
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
}

export function openComposeModal(context: RuntimeContext): void {
  const { state, render } = context;
  const target = state.currentChat
    ? { kind: "chat" as const, userId: state.currentChat.userId, title: state.currentChat.title }
    : state.topic
      ? { kind: "topic" as const, topicId: state.topic.topicId }
      : undefined;
  if (!target) {
    return;
  }
  state.composeDialog = {
    target,
    draft: "",
    draftUnits: [],
    cursorIndex: 0,
    submitting: false,
    emotionCategoryIndex: 0,
    emotionSelectedIndex: 0,
    emotionFocus: "grid"
  };
  state.modal = "compose";
  state.status = target.kind === "chat"
    ? "私信：Enter 发送  Shift+Enter 换行  表情快捷键打开表情  Esc 取消"
    : "评论：Enter 发送  Shift+Enter 换行  表情快捷键打开表情  Esc 取消";
  render();
}

export function closeComposeModal(context: RuntimeContext): void {
  const { state, render } = context;
  state.composeDialog = undefined;
  state.modal = null;
  state.status = getStatus(state);
  render();
}

export function closeEmotionPicker(context: RuntimeContext): void {
  const { state } = context;
  if (state.composeDialog) {
    state.modal = "compose";
    state.status = state.composeDialog.target.kind === "chat"
      ? "私信：Enter 发送  Shift+Enter 换行  表情快捷键打开表情  Esc 取消"
      : "评论：Enter 发送  Shift+Enter 换行  表情快捷键打开表情  Esc 取消";
  } else {
    state.modal = null;
    state.status = getStatus(state);
  }
}

export function insertComposeText(context: RuntimeContext, value: string): void {
  const { state } = context;
  if (!state.composeDialog) {
    return;
  }
  const insertedUnits = graphemes(value);
  if (insertedUnits.length === 0) {
    return;
  }
  state.composeDialog.draftUnits.splice(state.composeDialog.cursorIndex, 0, ...insertedUnits);
  state.composeDialog.draft = state.composeDialog.draftUnits.join("");
  state.composeDialog.cursorIndex += insertedUnits.length;
}

export function handleComposeBackspace(context: RuntimeContext): void {
  const { state } = context;
  if (!state.composeDialog) {
    return;
  }
  if (state.composeDialog.cursorIndex <= 0) {
    return;
  }
  state.composeDialog.draftUnits.splice(state.composeDialog.cursorIndex - 1, 1);
  state.composeDialog.draft = state.composeDialog.draftUnits.join("");
  state.composeDialog.cursorIndex -= 1;
}

export function moveComposeCursor(context: RuntimeContext, delta: number): void {
  const { state } = context;
  const compose = state.composeDialog;
  if (!compose) {
    return;
  }
  const length = compose.draftUnits.length;
  compose.cursorIndex = Math.max(0, Math.min(length, compose.cursorIndex + delta));
}

export function moveEmotionSidebar(context: RuntimeContext, delta: number): void {
  const { state } = context;
  const compose = state.composeDialog;
  if (!compose) {
    return;
  }
  compose.emotionCategoryIndex = Math.max(0, Math.min(emotionCategories.length - 1, compose.emotionCategoryIndex + delta));
  compose.emotionSelectedIndex = 0;
}

export function moveEmotionGrid(context: RuntimeContext, delta: number): void {
  const { state } = context;
  const compose = state.composeDialog;
  if (!compose) {
    return;
  }
  const category = getEmotionCategory(compose.emotionCategoryIndex);
  compose.emotionSelectedIndex = Math.max(0, Math.min(category.entries.length - 1, compose.emotionSelectedIndex + delta));
}

export function checkUpdate(context: RuntimeContext): void {
  const { state, render } = context;
  state.status = "正在检查 GitHub Release...";
  render();
  void checkForUpdate().then((result) => {
    showNotification(state, result.message);
    render();
  }).catch((error: unknown) => {
    state.status = error instanceof Error ? error.message : "检查更新失败";
    render();
  });
}
