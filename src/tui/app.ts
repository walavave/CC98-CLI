import { Cc98Client } from "../api/client.js";
import { maybeAutoSignin } from "../auto-signin.js";
import type { WebVpnOptions } from "../api/types.js";
import { loadConfig } from "../config.js";
import { TokenStore } from "../storage/token-store.js";
import { VpnStore } from "../storage/vpn-store.js";
import { createLoginForm } from "./account-modal.js";
import { createSearchState, loadView } from "./app-data.js";
import { createKeyHandler, createMouseHandler } from "./app-runtime.js";
import { CachedCc98Client } from "./cached-client.js";
import {
  clampSidebarWidth,
  getSidebarDividerColumn,
  handleMouseScroll
} from "./interactions.js";
import { loadTuiKeymap } from "./keymap.js";
import { draw } from "./renderer.js";
import { getStatus, navItems, type TuiState } from "./tui-model.js";
import { Terminal } from "./terminal.js";

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
    sidebarWidth: undefined,
    draggingSidebarDivider: false,
    loading: true,
    loadingMore: false,
    status: "",
    viewTitle: "十大",
    items: [],
    overview: [],
    currentSearch: undefined,
    modal: null,
    accountModal: {
      accounts: [],
      selectedIndex: 0
    },
    loginForm: createLoginForm(),
    imageViewer: undefined
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
        state.mode = nav.id === "settings" && state.mode === "settings" ? "settings" : "list";
        if (state.mode === "settings") {
          state.focus = "content";
        }
        state.items = [];
        state.topic = undefined;
        state.imageViewer = undefined;
        state.parentList = undefined;
        state.currentBoard = undefined;
        state.currentChat = undefined;
        state.currentSearch = nav.id === "search" ? createSearchState() : undefined;
        render();

        try {
          state.account = await tokenStore.getCurrentAccountName();
          const next = await loadView(client, nav.id, force, signal);
          if (closed || version !== loadVersion) {
            return;
          }
          state.viewTitle = next.title;
          state.items = next.items;
          if (next.overview) {
            state.overview = next.overview;
          }
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
      process.exit(0);
    }
  }
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
