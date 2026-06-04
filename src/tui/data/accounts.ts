import { TokenStore } from "../../storage/token-store.js";
import type { TuiState } from "../tui-model.js";

export async function refreshAccounts(state: TuiState, tokenStore: TokenStore): Promise<void> {
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

export function getDefaultAccountName(me: Record<string, unknown>, username: string): string {
  if (typeof me.name === "string" && me.name.trim()) {
    return me.name.trim();
  }
  if (typeof me.id === "number") {
    return String(me.id);
  }
  return username;
}

export function normalizeLoginMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^login failed:\s*/i, "");
  }
  return String(error);
}
