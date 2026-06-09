import { homedir } from "node:os";
import { join } from "node:path";
import { getPlatformDataDir } from "../platform/config-dir.js";

export function getConfigDir(): string {
  return getPlatformDataDir();
}

export function getTokenFilePath(): string {
  return join(getConfigDir(), "tokens.json");
}

export function getAutoSigninStatePath(): string {
  return join(getConfigDir(), "auto-signin.json");
}

export function getCacheDir(): string {
  return join(getConfigDir(), "cache");
}

export function getDownloadsDir(): string {
  return join(homedir(), "Downloads");
}
