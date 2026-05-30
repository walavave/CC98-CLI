import type { Cc98Client } from "./api/client.js";
import type { AppConfig } from "./config.js";
import { AutoSigninStore } from "./storage/auto-signin-store.js";
import type { TokenStore } from "./storage/token-store.js";

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export async function maybeAutoSignin(
  client: Cc98Client,
  tokenStore: TokenStore,
  config: AppConfig,
  accountOverride?: string
): Promise<boolean> {
  if (!config.account.autoSignin) {
    return false;
  }

  const accountName = accountOverride ?? await tokenStore.getCurrentAccountName();
  if (!accountName) {
    return false;
  }

  const today = getShanghaiDateKey();
  const state = new AutoSigninStore();
  if (await state.getSignedDate(accountName) === today) {
    return false;
  }

  try {
    await client.signin();
    await state.markSigned(accountName, today);
    return true;
  } catch (error) {
    if (isAlreadySignedError(error)) {
      await state.markSigned(accountName, today);
    }
    return false;
  }
}

function getShanghaiDateKey(): string {
  return shanghaiDateFormatter.format(new Date());
}

function isAlreadySignedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /already signed|already sign|已签到|重复签到|不能重复/i.test(error.message);
}
