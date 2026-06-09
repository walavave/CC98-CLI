import { homedir, platform } from "node:os";
import { join } from "node:path";

const appDirName = "cc98-cli";
const legacyDataDirName = ".cc98-cli";

export function getPlatformConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return join(xdgConfigHome, appDirName);
  }

  switch (platform()) {
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), appDirName);
    default:
      return join(homedir(), ".config", appDirName);
  }
}

export function getPlatformDataDir(): string {
  switch (platform()) {
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), appDirName);
    default:
      return join(homedir(), legacyDataDirName);
  }
}
