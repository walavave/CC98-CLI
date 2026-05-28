import { Cc98Client } from "../api/client.js";
import { loadConfig, type TuiConfig } from "../config.js";
import { TokenStore } from "../storage/token-store.js";
import { checkForUpdate } from "../update.js";
import { appVersion } from "../version.js";
import {
  createLoginForm,
  isPrintableInput,
  updateLoginField
} from "./account-modal.js";
import { CachedCc98Client } from "./cached-client.js";
import { imagePreviewRows, loadImagePreview, supportsImagePreview } from "./image-preview.js";
import { draw } from "./renderer.js";
import {
  currentTopicPost,
  getStatus,
  navItems,
  settingsItems,
  type BoardListState,
  type ChatListState,
  type ContentItem,
  type MenuItem,
  type TopicLineEntry,
  type TopicPostEntry,
  type TopicReaderState,
  type TuiState,
  type ViewId
} from "./tui-model.js";
import { Terminal } from "./terminal.js";
import { theme } from "./theme.js";
import { renderUbbToLines } from "./ubb-renderer.js";

export async function runTui(): Promise<void> {
  const terminal = new Terminal();
  const tokenStore = new TokenStore();
  const config = loadConfig();
  const rawClient = new Cc98Client({ tokenStore });
  const client = new CachedCc98Client(rawClient);
  let exitRequested = false;
  const state: TuiState = {
    mode: "list",
    focus: "nav",
    navIndex: 0,
    itemIndex: 0,
    scroll: 0,
    loading: true,
    loadingMore: false,
    status: "",
    viewTitle: "十大",
    items: [],
    stats: [],
    overview: [],
    modal: null,
    menuIndex: 0,
    menuItems: [],
    accountModal: {
      accounts: [],
      selectedIndex: 0
    },
    loginForm: {
      username: "",
      password: "",
      fieldIndex: 0,
      submitting: false
    }
  };

  terminal.enter();

  try {
    await new Promise<void>((resolve) => {
      let closed = false;
      let loadVersion = 0;
      let currentAbort: AbortController | undefined;
      const nextSignal = () => {
        currentAbort?.abort();
        currentAbort = new AbortController();
        return currentAbort.signal;
      };
      const render = () => terminal.render(draw(state, terminal.size(), config.tui));
      const load = async (force = false) => {
        const version = ++loadVersion;
        const signal = nextSignal();
        const nav = navItems[state.navIndex];
        state.viewTitle = nav.label;
        state.loading = true;
        state.error = undefined;
        state.itemIndex = 0;
        state.scroll = 0;
        state.mode = nav.id === "settings" && state.mode === "settings" ? "settings" : "list";
        if (state.mode === "settings") {
          state.focus = "content";
        }
        state.items = [];
        state.stats = [];
        state.topic = undefined;
        state.parentList = undefined;
        state.currentBoard = undefined;
        state.currentChat = undefined;
        render();

        try {
          state.account = await tokenStore.getCurrentAccountName();
          const next = await loadView(client, nav.id, force, signal);
          if (closed || version !== loadVersion) {
            return;
          }
          state.viewTitle = next.title;
          state.items = next.items;
          state.stats = next.stats;
          if (next.overview) {
            state.overview = next.overview;
          }
          state.status = next.status ?? getStatus(state);
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }
          if (closed || version !== loadVersion) {
            return;
          }
          state.error = error instanceof Error ? error.message : String(error);
          state.items = [];
          state.stats = [];
        } finally {
          if (!closed && version === loadVersion) {
            state.loading = false;
            render();
          }
        }
      };

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        exitRequested = true;
        currentAbort?.abort();
        offKey();
        offResize();
        resolve();
      };

      const offResize = terminal.onResize(render);

      // Helper to get menu items for current context
      const getMenuItems = (): MenuItem[] => {
        const items: MenuItem[] = [];
        if (state.mode === "topic") {
          items.push({ label: "刷新", key: "r", action: "refresh" });
          items.push({ label: "返回列表", key: "h", action: "back" });
        } else if (state.mode === "list") {
          items.push({ label: "刷新", key: "r", action: "refresh" });
          if (state.currentBoard) {
            items.push({ label: "返回版面列表", key: "h", action: "back" });
          }
        }
        return items;
      };

      const offKey = terminal.onKey((key) => {
        // Global: Ctrl+C or q to quit
        if (key === "\u0003" || key === "q") {
          close();
          return;
        }

        // Global: ? for help
        if (key === "?") {
          state.modal = state.modal === "help" ? null : "help";
          render();
          return;
        }

        // Handle modal states
        if (state.modal === "help") {
          if (key === "h" || key === "\x1b[D" || key === "\x1b" || key === "?" || key === "\r") {
            state.modal = null;
            render();
          }
          return;
        }

        if (state.modal === "menu") {
          if (key === "j" || key === "\x1b[B") {
            state.menuIndex = Math.min(state.menuItems.length - 1, state.menuIndex + 1);
            render();
            return;
          }
          if (key === "k" || key === "\x1b[A") {
            state.menuIndex = Math.max(0, state.menuIndex - 1);
            render();
            return;
          }
          if (key === "\r" || key === "l" || key === "\x1b[C") {
            const selected = state.menuItems[state.menuIndex];
            state.modal = null;
            if (selected?.action === "refresh") {
              void load(true);
            } else if (selected?.action === "back") {
              if (state.mode === "topic") {
                currentAbort?.abort();
                state.mode = "list";
                state.focus = "content";
                state.status = getStatus(state);
                render();
              } else if (state.parentList) {
                currentAbort?.abort();
                restoreParentList(state);
                render();
              }
            }
            return;
          }
          if (key === "h" || key === "\x1b[D" || key === "\x1b" || key === "o") {
            state.modal = null;
            render();
            return;
          }
          return;
        }

        if (state.modal === "account") {
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
              state.status = `已切换到 @${selected.account}`;
              void load(true);
            }).catch((error: unknown) => {
              state.error = error instanceof Error ? error.message : String(error);
              state.status = "账号切换失败";
              render();
            });
            return;
          }
          return;
        }

        if (state.modal === "login") {
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
          if (key === "h" || key === "\x1b[D") {
            if (state.loginForm.fieldIndex > 0) {
              state.loginForm.fieldIndex -= 1;
              render();
              return;
            }
          }
          if (key === "l" || key === "\x1b[C") {
            if (state.loginForm.fieldIndex < 2) {
              state.loginForm.fieldIndex += 1;
              render();
              return;
            }
          }
          if (key === "\x1b") {
            state.modal = "account";
            state.loginForm.error = undefined;
            state.status = getStatus(state);
            render();
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
              state.status = `已登录为 ${typeof me.name === "string" ? me.name : username}`;
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
            return;
          }
          return;
        }

        if (state.modal === "confirm") {
          if (!state.confirmDialog) {
            state.modal = null;
            render();
            return;
          }
          if (key === "j" || key === "\x1b[B" || key === "k" || key === "\x1b[A" || key === "\t") {
            state.confirmDialog.selectedIndex = state.confirmDialog.selectedIndex === 0 ? 1 : 0;
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
          if (key === "\r" || key === "l" || key === "\x1b[C") {
            if (state.confirmDialog.selectedIndex === 1) {
              state.modal = null;
              state.confirmDialog = undefined;
              state.status = getStatus(state);
              render();
              return;
            }

            const account = state.account;
            state.modal = null;
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
              state.status = "已退出登录";
              await load(true);
            })().catch((error: unknown) => {
              state.error = error instanceof Error ? error.message : String(error);
              state.status = "退出登录失败";
              render();
            }).finally(() => {
              state.confirmDialog = undefined;
            });
            return;
          }
          return;
        }

        // Topic mode
        if (state.mode === "topic") {
          if (/^\d$/.test(key) && state.topic) {
            state.topic.floorInput = `${state.topic.floorInput}${key}`.slice(0, 6);
            state.status = `跳转到 ${state.topic.floorInput} 楼：Enter 确认  Esc 取消`;
            render();
            return;
          }
          if (key === "\x7f" && state.topic?.floorInput) {
            state.topic.floorInput = state.topic.floorInput.slice(0, -1);
            state.status = state.topic.floorInput
              ? `跳转到 ${state.topic.floorInput} 楼：Enter 确认  Esc 取消`
              : getStatus(state);
            render();
            return;
          }
          if (key === "\r" && state.topic?.floorInput) {
            const floor = Number(state.topic.floorInput);
            state.topic.floorInput = "";
            if (Number.isInteger(floor) && floor > 0) {
              void jumpToTopicFloor(client, state, floor, render, config.tui, nextSignal());
            }
            return;
          }
          if ((key === "]" || key === "】") && state.topic) {
            jumpRelativeTopicFloor(state, 1);
            state.status = getStatus(state);
            render();
            return;
          }
          if ((key === "[" || key === "【") && state.topic) {
            jumpRelativeTopicFloor(state, -1);
            state.status = getStatus(state);
            render();
            return;
          }
          if (key === "h" || key === "\x1b[D") {
            currentAbort?.abort();
            state.mode = "list";
            state.focus = "content";
            state.status = getStatus(state);
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
            render();
            if (wasAtEnd && state.topic?.hasMore && !state.loadingMore) {
              void loadNextTopicPage(client, state, render, config.tui, nextSignal(), true);
            }
            return;
          }
          if (key === "k" || key === "\x1b[A") {
            state.scroll = Math.max(0, state.scroll - 1);
            render();
            return;
          }
          if (key === "n" || key === " ") {
            void loadNextTopicPage(client, state, render, config.tui, nextSignal());
            return;
          }
          if (key === "r") {
            if (state.topic) {
              void openTopic(client, state, state.topic.topicId, render, config.tui, true, nextSignal());
            }
            return;
          }
          if (key === "o") {
            state.modal = "menu";
            state.menuItems = getMenuItems();
            state.menuIndex = 0;
            render();
            return;
          }
          return;
        }

        // Settings mode
        if (state.mode === "settings") {
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
            state.mode = "list";
            state.focus = "nav";
            state.status = getStatus(state);
            render();
            return;
          }
          if (key === "l" || key === "\x1b[C" || key === "\r") {
            const selected = settingsItems[state.itemIndex];
            if (selected?.meta === "help") {
              state.modal = "help";
              render();
            } else if (selected?.meta === "cache") {
              state.status = "正在清理缓存...";
              render();
              void client.clearCache().then(() => {
                state.status = "缓存已清理";
                void load(true);
              }).catch(() => {
                state.status = "缓存清理失败";
                render();
              });
            } else if (selected?.meta === "logout") {
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
            } else if (selected?.meta === "account") {
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
            } else if (selected?.meta === "update") {
              state.status = "正在检查 GitHub Release...";
              render();
              void checkForUpdate().then((result) => {
                state.status = result.message;
                render();
              }).catch((error: unknown) => {
                state.status = error instanceof Error ? error.message : "检查更新失败";
                render();
              });
            }
            return;
          }
          return;
        }

        // Nav focus
        if (state.focus === "nav") {
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
          if (key === "l" || key === "\x1b[C") {
            if (!state.loading && state.items.length > 0) {
              if (navItems[state.navIndex]?.id === "settings") {
                state.mode = "settings";
              }
              state.focus = "content";
              state.status = getStatus(state);
              render();
            }
            return;
          }
          if (key === "\r") {
            if (!state.loading && state.items.length > 0) {
              if (navItems[state.navIndex]?.id === "settings") {
                state.mode = "settings";
              }
              state.focus = "content";
              state.itemIndex = 0;
              state.status = getStatus(state);
              render();
            }
            return;
          }
          if (key === "r") {
            void load(true);
            return;
          }
          return;
        }

        // Content focus
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
        if (key === "h" || key === "\x1b[D") {
          if (state.parentList) {
            currentAbort?.abort();
            restoreParentList(state);
            render();
          } else {
            currentAbort?.abort();
            state.focus = "nav";
            state.status = getStatus(state);
            render();
          }
          return;
        }
        if (key === "\x1b") {
          if (state.parentList) {
            currentAbort?.abort();
            restoreParentList(state);
            render();
          } else {
            currentAbort?.abort();
            state.focus = "nav";
            state.status = getStatus(state);
            render();
          }
          return;
        }
        if (key === "l" || key === "\x1b[C") {
          const selected = state.items[state.itemIndex];
          if (selected?.topicId !== undefined) {
            void openTopic(client, state, selected.topicId, render, config.tui, false, nextSignal());
            return;
          }
          if (selected?.boardId !== undefined) {
            void openBoard(client, state, selected.boardId, selected.title, render, false, nextSignal());
            return;
          }
          if (selected?.chatUserId !== undefined) {
            void openChat(client, state, selected.chatUserId, selected.title, render, false, nextSignal());
            return;
          }
          state.status = "当前条目不可进入";
          render();
          return;
        }
        if (key === "\r") {
          const selected = state.items[state.itemIndex];
          if (selected?.topicId !== undefined) {
            void openTopic(client, state, selected.topicId, render, config.tui, false, nextSignal());
            return;
          }
          if (selected?.boardId !== undefined) {
            void openBoard(client, state, selected.boardId, selected.title, render, false, nextSignal());
            return;
          }
          if (selected?.chatUserId !== undefined) {
            void openChat(client, state, selected.chatUserId, selected.title, render, false, nextSignal());
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
        if (key === "o") {
          state.modal = "menu";
          state.menuItems = getMenuItems();
          state.menuIndex = 0;
          render();
          return;
        }
      });

      render();
      void load();
    });
  } finally {
    terminal.exit();
    if (exitRequested) {
      process.exit(0);
    }
  }
}

async function openTopic(
  client: CachedCc98Client,
  state: TuiState,
  topicId: number,
  render: () => void,
  config: TuiConfig,
  force = false,
  signal?: AbortSignal
): Promise<void> {
  state.mode = "topic";
  state.loading = true;
  state.loadingMore = false;
  state.error = undefined;
  state.scroll = 0;
  state.topic = {
    topicId,
    title: `#${topicId}`,
    meta: "",
    lines: [],
    posts: [],
    loaded: 0,
    size: 10,
    hasMore: true,
    imageCount: 0,
    linkCount: 0,
    floorInput: ""
  };
  state.status = "正在打开帖子...";
  render();

  try {
    const [topicRaw, postsRaw] = await Promise.all([
      client.getTopic(topicId, force, signal),
      client.getTopicPosts(topicId, 0, 10, force, signal)
    ]);
    const topic = asObject(topicRaw);
    const posts = asArray(postsRaw);
    const reader = buildTopicReader(topicId, topic, posts, 10, config);
    state.topic = reader;
    state.viewTitle = reader.title;
    state.status = reader.hasMore
      ? "j/k 滚动  n/Space 下一页  h/Esc 返回  r 刷新"
      : "j/k 滚动  h/Esc 返回  r 刷新";
    void loadTopicImagePreviews(reader, render, config);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = state.parentList
      ? "版面读取失败；Esc/Backspace 返回版面列表  h 返回左栏  r 重试"
      : "版面读取失败；h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

async function openBoard(
  client: CachedCc98Client,
  state: TuiState,
  boardId: number,
  boardTitle: string,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  if (pushParent) {
    state.parentList = {
      title: state.viewTitle,
      items: state.items,
      stats: state.stats,
      itemIndex: state.itemIndex,
      status: state.status
    };
  }

  state.mode = "list";
  state.focus = "content";
  state.loading = true;
  state.error = undefined;
  state.itemIndex = 0;
  state.scroll = 0;
  state.topic = undefined;
  state.currentChat = undefined;
  state.currentBoard = { boardId, title: boardTitle };
  state.viewTitle = boardTitle;
  state.items = [];
  state.stats = [
    { title: "版面", detail: `#${boardId}` },
    { title: "缓存", detail: "topics 30s" }
  ];
  state.status = "正在读取版面帖子...";
  render();

  try {
    const topics = asArray(await client.getBoardTopics(boardId, 0, 12, false, force, signal));
    state.items = topics.map((topic) => topicItem(topic));
    state.stats = [
      { title: "版面", detail: `#${boardId}` },
      { title: "主题", detail: `${topics.length} 条` },
      { title: "缓存", detail: "topics 30s" }
    ];
    state.status = "版面帖子：j/k 选择  l 打开帖子  h 返回  r 刷新";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function openChat(
  client: CachedCc98Client,
  state: TuiState,
  userId: number,
  title: string,
  render: () => void,
  force = false,
  signal?: AbortSignal,
  pushParent = true
): Promise<void> {
  if (pushParent) {
    state.parentList = {
      title: state.viewTitle,
      items: state.items,
      stats: state.stats,
      itemIndex: state.itemIndex,
      status: state.status
    };
  }

  state.mode = "list";
  state.focus = "content";
  state.loading = true;
  state.error = undefined;
  state.itemIndex = 0;
  state.scroll = 0;
  state.topic = undefined;
  state.currentBoard = undefined;
  state.currentChat = { userId, title, loaded: 0, size: 10, hasMore: true };
  state.viewTitle = title;
  state.items = [];
  state.stats = [
    { title: "用户", detail: `#${userId}` },
    { title: "缓存", detail: "history 15s" }
  ];
  state.status = "正在读取私信...";
  render();

  try {
    const messages = asArray(await client.getChatHistory(userId, 0, 10, force, signal));
    state.items = chatMessageItems(messages, title, userId);
    state.currentChat.loaded = messages.length;
    state.currentChat.hasMore = messages.length === state.currentChat.size;
    state.itemIndex = Math.max(0, state.items.length - 1);
    state.stats = [
      { title: "用户", detail: `#${userId}` },
      { title: "消息", detail: `${messages.length} 条` },
      { title: "缓存", detail: "history 15s" }
    ];
    state.status = state.currentChat.hasMore
      ? "私信：j/k 滚动  n/Space 更早消息  Esc/Backspace 返回联系人  h 返回左栏"
      : "私信：j/k 滚动  Esc/Backspace 返回联系人  h 返回左栏";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "私信读取失败；Esc/Backspace 返回联系人  h 返回左栏  r 重试";
  } finally {
    state.loading = false;
    render();
  }
}

async function loadNextChatPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  signal?: AbortSignal
): Promise<void> {
  if (!state.currentChat || state.loadingMore || !state.currentChat.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.status = "正在读取更早私信...";
  render();

  try {
    const chat = state.currentChat;
    const messages = asArray(await client.getChatHistory(chat.userId, chat.loaded, chat.size, false, signal));
    const olderItems = chatMessageItems(messages, chat.title, chat.userId);
    state.items = [...olderItems, ...state.items];
    state.itemIndex += olderItems.length;
    state.scroll += olderItems.length;
    chat.loaded += messages.length;
    chat.hasMore = messages.length === chat.size;
    state.stats = [
      { title: "用户", detail: `#${chat.userId}` },
      { title: "消息", detail: `${chat.loaded} 条` },
      { title: "缓存", detail: "history 15s" }
    ];
    state.status = chat.hasMore
      ? "私信：j/k 滚动  n/Space 更早消息  Esc/Backspace 返回联系人  h 返回左栏"
      : "已到最早私信；j/k 滚动  Esc/Backspace 返回联系人  h 返回左栏";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "更早私信读取失败；n/Space 重试  Esc/Backspace 返回联系人";
  } finally {
    state.loadingMore = false;
    render();
  }
}

function restoreParentList(state: TuiState): void {
  if (!state.parentList) {
    return;
  }
  const parent = state.parentList;
  state.mode = "list";
  state.focus = "content";
  state.loading = false;
  state.loadingMore = false;
  state.error = undefined;
  state.topic = undefined;
  state.currentBoard = undefined;
  state.currentChat = undefined;
  state.parentList = undefined;
  state.viewTitle = parent.title;
  state.items = parent.items;
  state.stats = parent.stats;
  state.itemIndex = parent.itemIndex;
  state.status = parent.status;
}

async function loadNextTopicPage(
  client: CachedCc98Client,
  state: TuiState,
  render: () => void,
  config: TuiConfig,
  signal?: AbortSignal,
  advanceAfterLoad = false
): Promise<void> {
  if (!state.topic || state.loadingMore || !state.topic.hasMore) {
    return;
  }

  state.loadingMore = true;
  state.status = "正在加载下一页...";
  render();

  try {
    const posts = asArray(await client.getTopicPosts(state.topic.topicId, state.topic.loaded, state.topic.size, false, signal));
    const next = renderPosts(posts, Math.max(36, currentTopicWidthEstimate(config)), config, state.topic.lines.length);
    state.topic.lines.push(...next.lines);
    state.topic.posts.push(...next.posts);
    state.topic.imageCount += next.imageCount;
    state.topic.linkCount += next.linkCount;
    void loadTopicImagePreviews(state.topic, render, config);
    state.topic.loaded += posts.length;
    state.topic.hasMore = posts.length === state.topic.size;
    if (advanceAfterLoad && posts.length > 0) {
      state.scroll = Math.min(Math.max(0, state.topic.lines.length - 1), state.scroll + 1);
    }
    state.status = state.topic.hasMore
      ? "j/k 滚动  n/Space 下一页  h/Esc 返回  r 刷新"
      : "已到最后一页  j/k 滚动  h/Esc 返回  r 刷新";
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingMore = false;
    render();
  }
}

function currentTopicWidthEstimate(config: TuiConfig): number {
  const width = process.stdout.columns || Number(process.env.COLUMNS) || 80;
  const sidebarWidth = width < 56 ? 0 : width < 90 ? 14 : 18;
  const sidebarRuleWidth = sidebarWidth > 0 ? 1 : 0;
  if (width < 78 || config.hideRightPanel) {
    return Math.max(24, width - sidebarWidth - sidebarRuleWidth);
  }
  const rightWidth = Math.floor(width * 0.30);
  return Math.max(24, width - sidebarWidth - sidebarRuleWidth - 1 - rightWidth);
}

async function loadTopicImagePreviews(topic: TopicReaderState, render: () => void, config: TuiConfig): Promise<void> {
  if (!config.previewImages || !supportsImagePreview()) {
    return;
  }

  const width = Math.max(16, currentTopicWidthEstimate(config) - 2);
  const imageLines = topic.posts
    .flatMap((post) => post.lines)
    .filter((line) => line.kind === "image" && line.imageUrl && !line.imagePreview);

  for (const line of imageLines) {
    try {
      const preview = await loadImagePreview(line.imageUrl ?? "", width, imagePreviewRows);
      if (preview) {
        line.imagePreview = preview;
        render();
      }
    } catch {
      // Keep the textual image placeholder if preview loading fails.
    }
  }
}

function buildTopicReader(topicId: number, topic: Record<string, unknown>, posts: unknown[], size: number, config: TuiConfig): TopicReaderState {
  const title = String(topic.title ?? `#${topicId}`);
  const meta = [
    topic.userName,
    topic.replyCount !== undefined ? `${topic.replyCount} 回复` : undefined,
    topic.hitCount !== undefined ? `${topic.hitCount} 浏览` : undefined
  ].filter(Boolean).join(" · ");
  const rendered = renderPosts(posts, currentTopicWidthEstimate(config), config);

  return {
    topicId,
    title,
    meta,
    lines: rendered.lines,
    posts: rendered.posts,
    loaded: posts.length,
    size,
    hasMore: posts.length === size,
    imageCount: rendered.imageCount,
    linkCount: rendered.linkCount,
    floorInput: ""
  };
}

function renderPosts(posts: unknown[], width: number, config: TuiConfig, lineOffset = 0): {
  lines: string[];
  posts: TopicPostEntry[];
  imageCount: number;
  linkCount: number;
} {
  const lines: string[] = [];
  const entries: TopicPostEntry[] = [];
  let imageCount = 0;
  let linkCount = 0;

  posts.forEach((postRaw) => {
    const post = asObject(postRaw);
    const lineStart = lineOffset + lines.length;
    const postLines: TopicLineEntry[] = [];
    const floorNumber = asNumber(post.floor);
    const floor = floorNumber !== undefined ? `#${floorNumber}` : "#?";
    const author = String(post.userName ?? "匿名");
    const time = typeof post.time === "string" ? post.time.replace("T", " ").slice(0, 16) : "";
    const likeCount = asNumber(post.likeCount) ?? 0;
    const dislikeCount = asNumber(post.dislikeCount) ?? 0;
    const like = likeCount > 0 ? ` · ${likeCount} 赞` : "";
    const push = (
      text: string,
      kind: TopicLineEntry["kind"],
      extra: Partial<TopicLineEntry> = {}
    ) => {
      const line = lineOffset + lines.length;
      lines.push(text);
      postLines.push({
        line,
        row: postLines.length,
        floor: floorNumber,
        kind,
        text,
        ...extra
      });
    };

    push(`${floor} ${author}${time ? ` · ${time}` : ""}${like}`, "header");
    const contentWidth = Math.max(8, width - 2);
    push(theme.border.horizontal.repeat(contentWidth), "divider");

    const content = typeof post.content === "string" ? post.content : "";
    const rendered = renderUbbToLines(content, contentWidth, {
      imagePreviewRows: config.previewImages && supportsImagePreview() ? imagePreviewRows : 0
    });
    rendered.lines.forEach((renderedLine) => {
      const imageIndex = parseBracketIndex(renderedLine, "image");
      const linkIndex = parseBracketIndex(renderedLine, "link");
      const kind = renderedLine.trim() === ""
        ? "blank"
        : imageIndex !== undefined
          ? "image"
          : linkIndex !== undefined
            ? "link"
            : renderedLine.startsWith(theme.quote.prefix)
              ? "quote"
              : "text";
      push(renderedLine, kind, {
        imageIndex,
        imageUrl: imageIndex !== undefined ? rendered.images[imageIndex - 1] : undefined,
        linkIndex,
        linkUrl: linkIndex !== undefined ? rendered.links[linkIndex - 1] : undefined
      });
    });
    push("", "blank");
    const preview = rendered.lines.find((value) =>
      value.trim() &&
      !value.startsWith("[image ") &&
      !value.startsWith("[link ")
    ) ?? "";
    entries.push({
      id: asNumber(post.id),
      floor: floorNumber,
      author,
      time,
      likeCount,
      dislikeCount,
      rating: formatRating(post),
      preview,
      lineStart,
      lineEnd: lineOffset + lines.length - 1,
      imageCount: rendered.images.length,
      linkCount: rendered.links.length,
      images: rendered.images,
      links: rendered.links,
      lines: postLines
    });
    imageCount += rendered.images.length;
    linkCount += rendered.links.length;
  });

  return { lines, posts: entries, imageCount, linkCount };
}

async function jumpToTopicFloor(
  client: CachedCc98Client,
  state: TuiState,
  floor: number,
  render: () => void,
  config: TuiConfig,
  signal?: AbortSignal
): Promise<void> {
  const topic = state.topic;
  if (!topic) {
    return;
  }

  const loaded = findTopicPostByFloor(topic, floor);
  if (loaded) {
    state.scroll = loaded.lineStart;
    state.status = getStatus(state);
    render();
    return;
  }

  const from = Math.floor((floor - 1) / topic.size) * topic.size;
  state.loadingMore = true;
  state.status = `正在读取 ${floor} 楼...`;
  render();

  try {
    const posts = asArray(await client.getTopicPosts(topic.topicId, from, topic.size, false, signal));
    const next = renderPosts(posts, Math.max(36, currentTopicWidthEstimate(config)), config, topic.lines.length);
    topic.lines.push(...next.lines);
    topic.posts.push(...next.posts);
    topic.posts.sort((left, right) => (left.floor ?? 0) - (right.floor ?? 0));
    topic.imageCount += next.imageCount;
    topic.linkCount += next.linkCount;
    void loadTopicImagePreviews(topic, render, config);
    topic.loaded = Math.max(topic.loaded, from + posts.length);
    topic.hasMore = posts.length === topic.size;
    const target = findTopicPostByFloor(topic, floor);
    if (target) {
      state.scroll = target.lineStart;
      state.status = getStatus(state);
    } else {
      state.status = `未找到 ${floor} 楼`;
    }
  } catch (error) {
    if (!isAbortError(error)) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    state.loadingMore = false;
    render();
  }
}

function jumpRelativeTopicFloor(state: TuiState, delta: number): void {
  const topic = state.topic;
  if (!topic || topic.posts.length === 0) {
    return;
  }
  const current = currentTopicPost(topic, state.scroll);
  const currentIndex = current ? topic.posts.indexOf(current) : 0;
  const next = topic.posts[Math.min(topic.posts.length - 1, Math.max(0, currentIndex + delta))];
  if (next) {
    state.scroll = next.lineStart;
  }
}

function findTopicPostByFloor(topic: TopicReaderState, floor: number): TopicPostEntry | undefined {
  return topic.posts.find((entry) => entry.floor === floor);
}

function parseBracketIndex(value: string, label: "image" | "link"): number | undefined {
  const match = new RegExp(`\\[${label} (\\d+)`).exec(value);
  return match ? Number(match[1]) : undefined;
}

function formatRating(post: Record<string, unknown>): string | undefined {
  const value = post.rating ?? post.ratingCount ?? post.wealth ?? post.score;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

async function refreshAccounts(state: TuiState, tokenStore: TokenStore): Promise<void> {
  const accounts = await tokenStore.listAccounts();
  const current = await tokenStore.getCurrentAccountName();
  state.account = current;
  state.accountModal.accounts = accounts.map((account) => ({
    account: account.account,
    detail: account.displayName ?? account.username ?? (account.userId ? `#${account.userId}` : "本地账号"),
    isCurrent: account.account === current
  }));
  state.accountModal.selectedIndex = Math.min(
    state.accountModal.accounts.findIndex((account) => account.isCurrent),
    state.accountModal.accounts.length
  );
  if (state.accountModal.selectedIndex < 0) {
    state.accountModal.selectedIndex = 0;
  }
}

function getDefaultAccountName(me: Record<string, unknown>, username: string): string {
  if (typeof me.name === "string" && me.name.trim()) {
    return me.name.trim();
  }
  if (typeof me.id === "number") {
    return String(me.id);
  }
  return username;
}

function normalizeLoginMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^login failed:\s*/i, "");
  }
  return String(error);
}

async function loadView(client: CachedCc98Client, view: ViewId, force: boolean, signal?: AbortSignal): Promise<{
  title: string;
  items: ContentItem[];
  stats: ContentItem[];
  overview?: ContentItem[];
  status?: string;
}> {
  switch (view) {
    case "hot": {
      const [index, unread] = await Promise.all([
        client.getForumIndex(force, signal),
        client.getUnreadCount(force, signal)
      ]);
      const indexObject = asObject(index);
      const unreadObject = asObject(unread);
      const hotTopics = asArray(indexObject.hotTopic ?? indexObject.manualHotTopic);
      return {
        title: "十大",
        items: hotTopics.map((topic) => topicItem(topic)),
        stats: unreadStats(unreadObject),
        overview: overviewStats(indexObject, unreadObject)
      };
    }
    case "new": {
      const topics = asArray(await client.getNewTopics(0, 12, force, signal));
      return {
        title: "最新",
        items: topics.map((topic) => topicItem(topic)),
        stats: [{ title: "新帖流", detail: `${topics.length} 条` }]
      };
    }
    case "boards": {
      const sections = asArray(await client.getAllBoards(force, signal));
      const boards = flattenBoards(sections).slice(0, 14);
      return {
        title: "版面",
        items: boards,
        stats: [{ title: "分区", detail: `${sections.length}` }, { title: "版面", detail: `${flattenBoards(sections).length}` }],
        status: "版面：j/k 选择  l 进入版面  h 返回  r 刷新"
      };
    }
    case "following": {
      const topics = asArray(await client.getFolloweeTopics(0, 12, force, signal));
      return {
        title: "关注",
        items: topics.map((topic) => topicItem(topic)),
        stats: [
          { title: "关注动态", detail: `${topics.length} 条` },
          { title: "缓存", detail: "30s" }
        ],
        status: "关注：j/k 选择  l 打开帖子  h 返回  r 刷新"
      };
    }
    case "favorite": {
      const [meRaw, sectionsRaw] = await Promise.all([
        client.getMe(force, signal),
        client.getAllBoards(false, signal)
      ]);
      const customBoards = asArray(asObject(meRaw).customBoards).filter((id): id is number => typeof id === "number");
      const allBoards = flattenBoards(asArray(sectionsRaw));
      const boardById = new Map(allBoards.filter((board) => board.boardId !== undefined).map((board) => [board.boardId, board]));
      const topicGroups = await mapLimit(customBoards, 3, async (boardId) => {
        const board = boardById.get(boardId);
        const topics = asArray(await client.getBoardTopics(boardId, 0, 3, false, force, signal));
        return topics.map((topic) => topicItem(topic, board));
      });
      const items = topicGroups.flat().sort((left, right) => (right.sortTime ?? 0) - (left.sortTime ?? 0)).slice(0, 18);
      return {
        title: "收藏",
        items,
        stats: [
          { title: "收藏版面", detail: `${customBoards.length} 个` },
          { title: "主题", detail: `${items.length} 条` },
          { title: "缓存", detail: "boards 24h / topics 30s" }
        ],
        status: "收藏：j/k 选择  l 打开帖子  h 返回  r 刷新"
      };
    }
    case "messages": {
      const [unread, recent] = await Promise.all([
        client.getUnreadCount(force, signal),
        client.getRecentChats(0, 10, force, signal)
      ]);
      const unreadObject = asObject(unread);
      const chats = asArray(recent);
      const userNames = await loadChatUserNames(client, chats, force, signal);
      const unreadItems = unreadStats(unreadObject)
        .filter((entry) => entry.detail !== "0" && entry.detail !== "-")
        .map((entry) => ({
          title: `未读 ${entry.title}`,
          detail: entry.detail
        }));
      const chatItems = chats.length > 0
        ? chats.map((chat) => chatItem(chat, userNames))
        : [{ title: "暂无最近私信", meta: "recent-contact-users" }];
      return {
        title: "消息",
        items: [...unreadItems, ...chatItems],
        stats: unreadStats(unreadObject),
        status: "消息：j/k 选择  l 打开会话  h 返回  r 刷新"
      };
    }
    case "me": {
      const [me, cacheStats] = await Promise.all([
        client.getMe(force, signal),
        client.getCacheStats()
      ]);
      const meObject = asObject(me);
      return {
        title: "我的",
        items: [
          item("昵称", meObject.name),
          item("用户 ID", meObject.id),
          item("等级", meObject.levelTitle ?? meObject.groupName),
          item("发帖数", meObject.postCount),
          item("财富", meObject.wealth),
          item("关注", meObject.followCount),
          item("粉丝", meObject.fanCount),
          item("缓存文件", cacheStats.fileCacheEntries)
        ],
        stats: [
          { title: "登录状态", detail: "已登录" }
        ]
      };
    }
    case "settings": {
      const cacheStats = await client.getCacheStats();
      return {
        title: "设置",
        items: settingsItems,
        stats: [
          { title: "缓存", detail: `${cacheStats.fileCacheEntries} 文件` },
          { title: "版本", detail: `v${appVersion}` }
        ],
        status: "设置：j/k 选择  l 执行  h 返回"
      };
    }
  }
}

function item(title: string, value: unknown, meta?: string): ContentItem {
  return {
    title,
    meta,
    detail: value === undefined || value === null ? "-" : String(value)
  };
}

function topicItem(value: unknown, fallbackBoard?: ContentItem): ContentItem {
  const topic = asObject(value);
  const topicId = asNumber(topic.id ?? topic.Id);
  const boardId = asNumber(topic.boardId ?? topic.BoardId) ?? fallbackBoard?.boardId;
  const boardName = topic.boardName ?? topic.BoardName ?? fallbackBoard?.title;
  return {
    title: String(topic.title ?? topic.Title ?? `#${topicId ?? ""}`),
    meta: [
      boardName,
      topic.userName ?? topic.authorName,
      topic.replyCount !== undefined ? `${topic.replyCount} 回复` : undefined,
      topic.hitCount !== undefined ? `${topic.hitCount} 浏览` : undefined
    ]
      .filter(Boolean)
      .join(" · "),
    detail: typeof topic.lastPostContent === "string" ? topic.lastPostContent.replace(/\s+/g, " ") : undefined,
    topicId,
    boardId,
    sortTime: timestampOf(topic.lastPostTime ?? topic.updateTime ?? topic.time ?? topic.createTime)
  };
}

async function loadChatUserNames(client: CachedCc98Client, chats: unknown[], force: boolean, signal?: AbortSignal): Promise<Map<number, string>> {
  const ids = chats
    .map((chat) => asNumber(asObject(chat).userId ?? asObject(chat).UserId))
    .filter((id): id is number => id !== undefined);
  const users = asArray(await client.getBasicUsers(ids, force, signal));
  return new Map(users.map((userRaw) => {
    const user = asObject(userRaw);
    const id = asNumber(user.id ?? user.Id);
    const name = String(user.name ?? user.Name ?? (id !== undefined ? `#${id}` : "用户"));
    return [id, name] as const;
  }).filter((entry): entry is readonly [number, string] => entry[0] !== undefined));
}

function chatItem(value: unknown, userNames: Map<number, string>): ContentItem {
  const chat = asObject(value);
  const userId = asNumber(chat.userId ?? chat.UserId);
  const name = userId !== undefined ? userNames.get(userId) : undefined;
  return {
    title: String(name ?? chat.name ?? chat.userName ?? userId ?? "私信"),
    meta: userId !== undefined ? `user #${userId}` : undefined,
    detail: normalizePreview(String(chat.lastContent ?? chat.lastMessage ?? chat.content ?? "")),
    chatUserId: userId
  };
}

function chatMessageItems(messages: unknown[], otherName: string, otherUserId: number): ContentItem[] {
  return [...messages].reverse().map((messageRaw) => {
    const message = asObject(messageRaw);
    const receiverId = asNumber(message.receiverId ?? message.ReceiverId);
    const isMine = receiverId === otherUserId;
    const time = typeof message.time === "string"
      ? message.time.replace("T", " ").slice(0, 16)
      : "";
    const content = normalizePreview(String(message.content ?? message.Content ?? ""));
    return {
      title: isMine ? `我 -> ${otherName}` : `${otherName} -> 我`,
      meta: [time, receiverId !== undefined ? `receiver #${receiverId}` : undefined].filter(Boolean).join(" · "),
      detail: content || "(空消息)"
    };
  });
}

function unreadStats(value: Record<string, unknown>): ContentItem[] {
  return [
    item("系统", value.systemCount),
    item("@", value.atCount),
    item("回复", value.replyCount),
    item("私信", value.messageCount)
  ];
}

function overviewStats(index: Record<string, unknown>, unread: Record<string, unknown>): ContentItem[] {
  const unreadTotal = ["systemCount", "atCount", "replyCount", "messageCount"].reduce((total, key) => {
    const value = unread[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
  return [
    item("今日主题", index.todayTopicCount),
    item("今日回复", index.todayCount),
    item("在线", index.onlineUserCount),
    item("用户", index.userCount),
    item("未读", unreadTotal)
  ];
}

async function mapLimit<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function flattenBoards(sections: unknown[]): ContentItem[] {
  const boards: ContentItem[] = [];
  for (const section of sections) {
    const sectionObject = asObject(section);
    const sectionName = String(sectionObject.name ?? sectionObject.title ?? "分区");
    const candidates = [sectionObject.boards, sectionObject.children, sectionObject.boardList];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }
      for (const board of candidate) {
        const boardObject = asObject(board);
        boards.push({
          title: String(boardObject.name ?? boardObject.title ?? `#${boardObject.id ?? ""}`),
          meta: `${sectionName}${boardObject.id !== undefined ? ` · #${boardObject.id}` : ""}`,
          detail: typeof boardObject.description === "string" ? boardObject.description : undefined,
          boardId: typeof boardObject.id === "number" ? boardObject.id : undefined
        });
      }
    }
  }
  return boards;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePreview(value: string): string {
  return normalizeInline(value
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, " [图片] ")
    .replace(/\[upload(?:=[^\]]*)?\][\s\S]*?\[\/upload\]/gi, " [附件] ")
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, _url: string, label: string) => ` ${label} `)
    .replace(/\[url\][\s\S]*?\[\/url\]/gi, " [链接] ")
    .replace(/<img\b[^>]*>/gi, " [图片] ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\[(?:\/)?(?:b|i|u|size|color|align|email|del|s|sub|sup|h\d?|quote|code)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[[a-z0-9]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\[\/[a-z0-9]+\]/gi, " "));
}

function timestampOf(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
