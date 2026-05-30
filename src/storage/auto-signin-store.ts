import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getAutoSigninStatePath } from "./paths.js";

interface AutoSigninState {
  accounts: Record<string, string>;
}

export class AutoSigninStore {
  constructor(private readonly filePath = getAutoSigninStatePath()) {}

  async getSignedDate(account: string): Promise<string | undefined> {
    const state = await this.read();
    return state.accounts[account];
  }

  async markSigned(account: string, date: string): Promise<void> {
    const state = await this.read();
    state.accounts[account] = date;
    await this.write(state);
  }

  private async read(): Promise<AutoSigninState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (isAutoSigninState(parsed)) {
        return parsed;
      }
      return emptyState();
    } catch (error: unknown) {
      if (isFileNotFound(error)) {
        return emptyState();
      }
      throw error;
    }
  }

  private async write(state: AutoSigninState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }
}

function emptyState(): AutoSigninState {
  return { accounts: {} };
}

function isAutoSigninState(value: unknown): value is AutoSigninState {
  return typeof value === "object" &&
    value !== null &&
    "accounts" in value &&
    typeof value.accounts === "object" &&
    value.accounts !== null;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
}
