import { checkForUpdate } from "../../update.js";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLoginForm, isPrintableInput, isPrintableTextInput, updateLoginField } from "../account-modal.js";
import { emotionCategories, getEmotionCategory } from "../media/emotion-catalog.js";
import { readClipboardImageFile, readClipboardText } from "../media/clipboard.js";
import { graphemes } from "../render-core/text.js";
import { getDefaultAccountName, normalizeLoginMessage, refreshAccounts } from "../data/accounts.js";
import { getStatus } from "../tui-model.js";
import type { RuntimeContext } from "./context.js";
import { showNotification } from "./state.js";
import { saveHiddenPatterns } from "../../config.js";

interface OpenComposeOptions {
  initialDraft?: string;
}

export function handleAccountModal(context: RuntimeContext, key: string): void {
  const { state, render, tokenStore, load, client } = context;
  if (key === "n") {
    state.loginForm = createLoginForm();
    state.modal = "login";
    render();
    return;
  }
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
  if (isPrintableInput(key) || isPrintableTextInput(key)) {
    updateLoginField(state.loginForm, (value) => `${value}${key}`);
    render();
  }
}

export function handleRatingModal(context: RuntimeContext, key: string): void {
  const { state, render } = context;
  if (!state.ratingDialog || state.ratingDialog.reasons.length === 0) {
    state.modal = null;
    state.ratingDialog = undefined;
    render();
    return;
  }
  if (key === "j" || key === "\x1b[B") {
    const i = state.ratingDialog.reasons.findIndex((r) => r.id === state.ratingDialog!.selectedReasonId);
    const next = state.ratingDialog.reasons[Math.min(state.ratingDialog.reasons.length - 1, i + 1)];
    if (next) state.ratingDialog.selectedReasonId = next.id;
    render();
    return;
  }
  if (key === "k" || key === "\x1b[A") {
    const i = state.ratingDialog.reasons.findIndex((r) => r.id === state.ratingDialog!.selectedReasonId);
    const prev = state.ratingDialog.reasons[Math.max(0, i - 1)];
    if (prev) state.ratingDialog.selectedReasonId = prev.id;
    render();
    return;
  }
  if (key === "\r") {
    submitRating(context);
    return;
  }
  if (key === "\x1b" || key === "\x1b[D" || key === "h") {
    state.modal = null;
    state.ratingDialog = undefined;
    state.status = getStatus(state);
    render();
    return;
  }
}

export function handleHiddenPatternsModal(context: RuntimeContext, key: string): void {
  const { state, render, config } = context;
  const dialog = state.hiddenPatternsDialog;
  if (!dialog) { state.modal = null; render(); return; }
  if (key === "j" || key === "\x1b[B") dialog.selectedIndex = Math.min(3, dialog.selectedIndex + 1);
  else if (key === "k" || key === "\x1b[A") dialog.selectedIndex = Math.max(0, dialog.selectedIndex - 1);
  else if (key === "\x7f" && dialog.selectedIndex === 3) dialog.custom = dialog.custom.slice(0, -1);
  else if (key === "\r") {
    const selected = new Set(dialog.patterns);
    if (dialog.selectedIndex === 0) selected.has("cy") ? selected.delete("cy") : selected.add("cy");
    if (dialog.selectedIndex === 1) {
      selected.has("bd") ? (selected.delete("bd"), selected.delete("bdbd")) : (selected.add("bd"), selected.add("bdbd"));
    }
    if (dialog.selectedIndex === 2) selected.has("[ac01]") ? selected.delete("[ac01]") : selected.add("[ac01]");
    if (dialog.selectedIndex === 3 && dialog.custom.trim()) selected.add(dialog.custom.trim());
    dialog.patterns = [...selected];
    try {
      saveHiddenPatterns(dialog.patterns);
      config.hiddenPatterns = dialog.patterns;
      if (dialog.selectedIndex === 3) dialog.custom = "";
      state.status = "一键隐藏设置已保存";
    } catch (error) {
      state.status = `一键隐藏设置保存失败：${error instanceof Error ? error.message : String(error)}`;
    }
  } else if (key === "\x1b" || key === "h") { state.modal = null; state.hiddenPatternsDialog = undefined; state.status = getStatus(state); }
  else if (dialog.selectedIndex === 3 && (isPrintableInput(key) || isPrintableTextInput(key))) dialog.custom += key;
  render();
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

export function openRatingDialog(context: RuntimeContext, postId: number, type: 1 | 2): void {
  const { state, render, client } = context;
  state.status = "正在获取风评理由...";
  render();
  client.getPostRateReasons(type).then((reasons: unknown) => {
    const items = normalizeRatingReasons(reasons);
    state.ratingDialog = { postId, type, reasons: items, selectedReasonId: items[0]?.id ?? 0 };
    state.modal = "rating";
    render();
  }).catch((error: unknown) => {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "获取风评理由失败";
    render();
  });
}

function normalizeRatingReasons(value: unknown): Array<{ id: number; name: string }> {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((entry): { id: number; name: string } | null => {
      if (entry === null || typeof entry !== "object") {
        return null;
      }
      const reason = entry as Record<string, unknown>;
      const name = String(
        reason.name ??
        reason.description ??
        reason.reason ??
        reason.text ??
        reason.label ??
        ""
      ).trim();
      const id = typeof reason.id === "number"
        ? reason.id
        : Number(reason.id ?? reason.reasonId ?? reason.value ?? 0);
      if (!name) {
        return null;
      }
      return {
        id: Number.isFinite(id) ? id : 0,
        name
      };
    })
    .filter((item): item is { id: number; name: string } => item !== null);
}

export function submitRating(context: RuntimeContext): void {
  const { state, render, client } = context;
  const dialog = state.ratingDialog;
  if (!dialog) return;
  state.status = dialog.type === 1 ? "正在加风评..." : "正在扣风评...";
  state.modal = null;
  render();
  client.ratePost(dialog.postId, dialog.selectedReasonId, dialog.type).then((raw: unknown) => {
    const text = String(raw === null || raw === undefined ? "" : raw);
    if (text === "ok") {
      state.status = dialog.type === 1 ? "风评 +1" : "风评 -1";
    } else {
      const msgs: Record<string, string> = {
        cannot_rate_yourself: "不能给自己评分",
        post_more_than_7_days: "超过7天的发言无法评分",
        you_cannot_rate: "没有资格评分",
        board_cannot_rate: "该版面无法评分",
        has_rated_today: "今天已经评分过了",
        has_rated_this_post: "已对此发言评分过",
        post_not_exists: "发言不存在",
        topic_not_exists: "主题不存在",
      };
      state.status = msgs[text] ?? `评分失败：${text}`;
    }
  }).catch((error: unknown) => {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "评分请求失败";
  }).finally(() => {
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

export function openComposeModal(context: RuntimeContext, options: OpenComposeOptions = {}): void {
  const { state, render } = context;
  const target = state.currentChat
    ? { kind: "chat" as const, userId: state.currentChat.userId, title: state.currentChat.title }
    : state.topic
      ? { kind: "topic" as const, topicId: state.topic.topicId }
      : undefined;
  if (!target) {
    return;
  }
  const draft = options.initialDraft ?? "";
  const draftUnits = graphemes(draft);
  state.composeDialog = {
    target,
    draft,
    draftUnits,
    cursorIndex: draftUnits.length,
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

export async function pasteClipboardIntoCompose(context: RuntimeContext, fallbackText?: string): Promise<void> {
  const { state, render, rawClient } = context;
  const compose = state.composeDialog;
  if (!compose || compose.submitting) {
    return;
  }

  state.status = "正在读取剪贴板...";
  render();

  try {
    const imageFile = await readClipboardImageFile();
    if (imageFile) {
      state.status = "正在上传剪贴板图片...";
      render();
      const uploaded = await rawClient.uploadFile(imageFile);
      const imageUrl = uploaded[0];
      if (!imageUrl) {
        throw new Error("图片上传失败");
      }
      insertComposeText(context, `[img]${imageUrl}[/img]`);
      state.status = "已插入剪贴板图片";
      render();
      return;
    }

    const text = await readClipboardText();
    if (text) {
      const uploaded = await tryInsertImagePathsAsUploads(context, text, rawClient, render);
      if (uploaded) {
        state.status = uploaded > 1 ? `已上传并插入 ${uploaded} 张图片` : "已上传并插入剪贴板图片";
        render();
        return;
      }
      insertComposeText(context, text);
      state.status = "已粘贴剪贴板文本";
      render();
      return;
    }

    if (fallbackText) {
      const normalized = fallbackText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const uploaded = await tryInsertImagePathsAsUploads(context, normalized, rawClient, render);
      if (uploaded) {
        state.status = uploaded > 1 ? `已上传并插入 ${uploaded} 张图片` : "已上传并插入剪贴板图片";
        render();
        return;
      }
      insertComposeText(context, normalized);
      state.status = "已粘贴剪贴板文本";
      render();
      return;
    }

    state.status = "剪贴板中没有可粘贴的图片或文本";
    render();
  } catch (error) {
    state.status = `粘贴失败：${error instanceof Error ? error.message : String(error)}`;
    render();
  }
}

export async function tryInsertImagePathsAsUploads(
  context: RuntimeContext,
  value: string,
  rawClient: RuntimeContext["rawClient"],
  render: () => void
): Promise<number | undefined> {
  const files = await resolveImageFilesFromText(value);
  if (files.length === 0) {
    return undefined;
  }

  const inserted: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    context.state.status = files.length > 1
      ? `正在上传图片 ${index + 1}/${files.length}...`
      : "正在上传图片...";
    render();
    const uploaded = await rawClient.uploadFile(file);
    const imageUrl = uploaded[0];
    if (!imageUrl) {
      throw new Error("图片上传失败");
    }
    inserted.push(`[img]${imageUrl}[/img]`);
  }

  insertComposeText(context, inserted.join("\n"));
  return inserted.length;
}

async function resolveImageFilesFromText(value: string): Promise<File[]> {
  const candidates = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (candidates.length === 0) {
    return [];
  }

  const files: File[] = [];
  for (const candidate of candidates) {
    const file = await imageFileFromPathCandidate(candidate);
    if (!file) {
      return [];
    }
    files.push(file);
  }
  return files;
}

async function imageFileFromPathCandidate(candidate: string): Promise<File | undefined> {
  const resolvedPath = resolveLocalPath(candidate);
  if (!resolvedPath || !looksLikeImagePath(resolvedPath)) {
    return undefined;
  }
  try {
    await access(resolvedPath);
    const bytes = await readFile(resolvedPath);
    const name = resolvedPath.split(/[\\/]/).at(-1) || "clipboard-image";
    return new File([bytes], name, { type: mimeTypeFromPath(resolvedPath) });
  } catch {
    return undefined;
  }
}

function resolveLocalPath(candidate: string): string | undefined {
  if (candidate.startsWith("file://")) {
    try {
      return fileURLToPath(candidate);
    } catch {
      return undefined;
    }
  }
  if (candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("~/")) {
    return candidate.startsWith("~/")
      ? `${process.env.HOME ?? ""}/${candidate.slice(2)}`
      : candidate;
  }
  return undefined;
}

function looksLikeImagePath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/i.test(value);
}

function mimeTypeFromPath(value: string): string {
  const extension = value.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "heic":
      return "image/heic";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
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
