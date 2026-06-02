import type { TuiConfig } from "../../config.js";
import type { Cc98Client } from "../../api/client.js";
import type { TokenStore } from "../../storage/token-store.js";
import type { CachedCc98Client } from "../cached-client.js";
import type { TuiKeymap } from "../keymap.js";
import type { TuiState } from "../tui-model.js";

export interface RuntimeContext {
  client: CachedCc98Client;
  rawClient: Cc98Client;
  tokenStore: TokenStore;
  config: TuiConfig;
  keymap: TuiKeymap;
  state: TuiState;
  getSize: () => { columns: number; rows: number };
  render: () => void;
  load: (force?: boolean) => Promise<void>;
  nextSignal: () => AbortSignal;
  abortCurrent: () => void;
  close: () => void;
}
