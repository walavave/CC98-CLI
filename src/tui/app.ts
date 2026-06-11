import { Cc98Client } from "../api/client.js";
import { maybeAutoSignin } from "../auto-signin.js";
import type { WebVpnOptions } from "../api/types.js";
import { loadConfig } from "../config.js";
import { TokenStore } from "../storage/token-store.js";
import { VpnStore } from "../storage/vpn-store.js";
import { createLoginForm } from "./account-modal.js";
import { mergeMessageUnreadState } from "./data/content.js";
import { createSearchState } from "./data/navigation-state.js";
import { loadView } from "./data/view-loader.js";
import { createKeyHandler, createMouseHandler } from "./app-runtime.js";
import { CachedCc98Client } from "./cached-client.js";
import {
  clampSidebarWidth,
  getSidebarDividerColumn,
  handleMouseScroll
} from "./interactions.js";
import { loadTuiKeymap } from "./keymap.js";
import { draw } from "./renderer.js";
import { clearTopicViewportAnchor } from "./topic-scroll.js";
import { getStatus, navItems, type TuiState } from "./tui-model.js";
import { Terminal } from "./render-core/terminal.js";

export async function runTui(): Promise<void> {
  const terminal = new Terminal();
  const tokenStore = new TokenStore();
  const config = loadConfig();
  const keymap = loadTuiKeymap();
  const vpnConfig = await new VpnStore().getConfig();
  const webVpnOptions = getWebVpnOptions(vpnConfig);
  const rawClient = new Cc98Client({ tokenStore, webVpn: webVpnOptions });
  if (webVpnOptions) {
    await rawClient.initWebVpn();
  }
  await maybeAutoSignin(rawClient, tokenStore, config);
  const client = new CachedCc98Client(rawClient);
  const getSize = terminal.size.bind(terminal);
  let exitRequested = false;
  const state: TuiState = {
    mode: "list",
    focus: "nav",
    navIndex: 0,
    itemIndex: 0,
    scroll: 0,
    topicViewportScroll: undefined,
    historyLimit: config.tui.navigationHistoryLimit,
    sidebarWidth: undefined,
    draggingSidebarDivider: false,
    loading: true,
    loadingMore: false,
    status: "",
    unreadSummary: undefined,
    messageUnreadByUserId: {},
    viewTitle: "十大",
    items: [],
    overview: [],
    history: [],
    currentBoard: undefined,
    currentFeed: undefined,
    currentChat: undefined,
    currentUser: undefined,
    currentSearch: undefined,
    currentFollowing: undefined,
    modal: null,
    accountModal: {
      accounts: [],
      selectedIndex: 0
    },
    loginForm: createLoginForm(),
    imageViewer: undefined,
    composeDialog: undefined,
    helpScroll: 0
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
      const abortCurrent = () => currentAbort?.abort();
      const render = () => {
        if (!closed) {
          terminal.render(draw(state, getSize(), config.tui));
        }
      };
      const load = async (force = false) => {
        const version = ++loadVersion;
        const signal = nextSignal();
        const nav = navItems[state.navIndex];
        const preserveSettingsSelection = nav.id === "settings" && state.mode === "settings";
        state.viewTitle = nav.label;
        state.loading = true;
        state.error = undefined;
        state.itemIndex = preserveSettingsSelection ? state.itemIndex : 0;
        state.scroll = 0;
        clearTopicViewportAnchor(state);
        state.mode = nav.id === "settings" && state.mode === "settings" ? "settings" : "list";
        if (state.mode === "settings") {
          state.focus = "content";
        }
        state.items = [];
        state.topic = undefined;
        state.imageViewer = undefined;
        state.history = [];
        state.currentBoard = undefined;
        state.currentFeed = undefined;
        state.currentChat = undefined;
        state.currentUser = undefined;
        state.currentSearch = nav.id === "search" ? createSearchState() : undefined;
        state.currentFollowing = undefined;
        render();

        try {
          state.account = await tokenStore.getCurrentAccountName();
          const [next, unreadRaw] = await Promise.all([
            loadView(client, nav.id, force, signal),
            client.getUnreadCount(force, signal)
          ]);
          if (closed || version !== loadVersion) {
            return;
          }
          const unread = typeof unreadRaw === "object" && unreadRaw ? unreadRaw as Record<string, unknown> : {};
          const messageCount = typeof unread.messageCount === "number" ? unread.messageCount : 0;
          const notificationCount = ["systemCount", "atCount", "replyCount"].reduce((total, key) => {
            const value = unread[key];
            return total + (typeof value === "number" ? value : 0);
          }, 0);
          state.unreadSummary = { messageCount, notificationCount };
          state.viewTitle = next.title;
          state.items = next.items;
          if (next.feed?.kind === "messages") {
            syncMessageUnreadState(state);
          }
          if (next.overview) {
            state.overview = next.overview;
          }
          state.currentFeed = next.feed;
          state.currentFollowing = next.following;
          state.status = next.status ?? getStatus(state);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          if (closed || version !== loadVersion) {
            return;
          }
          state.error = error instanceof Error ? error.message : String(error);
          state.items = [];
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
        abortCurrent();
        offKey();
        offMouse();
        offResize();
        resolve();
      };

      const offResize = terminal.onResize(render);
      const offMouse = terminal.onMouse(createMouseHandler(
        {
          client,
          rawClient,
          tokenStore,
          config: config.tui,
          keymap,
          state,
          getSize,
          render,
          load,
          nextSignal,
          abortCurrent,
          close
        },
        handleMouseScroll,
        clampSidebarWidth,
        () => getSidebarDividerColumn(getSize().columns, state.sidebarWidth)
      ));
      const offKey = terminal.onKey(createKeyHandler({
        client,
        rawClient,
        tokenStore,
        config: config.tui,
        keymap,
        state,
        getSize,
        render,
        load,
        nextSignal,
        abortCurrent,
        close
      }));

      render();
      void load();
    });
  } finally {
    terminal.exit();
    if (exitRequested) {
      if (config.tui.clearCacheOnExit) {
        await client.clearCache();
      }
      process.exit(0);
    }
  }
}

function syncMessageUnreadState(state: TuiState): void {
  state.messageUnreadByUserId = mergeMessageUnreadState(state);
}

function getWebVpnOptions(config: Awaited<ReturnType<VpnStore["getConfig"]>>): WebVpnOptions | undefined {
  if (config.mode === "direct") {
    return { mode: "direct" };
  }
  if (config.mode === "vpn" || config.cookies) {
    return { mode: config.mode, cookies: config.cookies };
  }
  return undefined;
}
