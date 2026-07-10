import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONFIG_ENV_VAR,
  DEFAULT_CONFIG_FILENAME,
  devServerConfigSchema,
  type DevServerConfig,
} from "@24letters/devservers-shared";

const defaultConfigPath = () => {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Devservers Manager",
      DEFAULT_CONFIG_FILENAME,
    );
  }
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Devservers Manager", DEFAULT_CONFIG_FILENAME);
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"] ?? path.join(home, ".config");
  return path.join(xdgConfig, "devservers", DEFAULT_CONFIG_FILENAME);
};

export const resolveConfigPath = (override?: string) => {
  if (override) return path.resolve(override);
  const envPath = process.env[CONFIG_ENV_VAR];
  return envPath ? path.resolve(envPath) : defaultConfigPath();
};

export const readConfig = async (configPath: string): Promise<DevServerConfig> => {
  try {
    return devServerConfigSchema.parse(JSON.parse(await readFile(configPath, "utf-8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, services: [], registeredProjects: [] };
    }
    throw error;
  }
};

export const writeConfig = async (configPath: string, config: DevServerConfig) => {
  const safeConfig = devServerConfigSchema.parse(config);
  const dir = path.dirname(configPath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.devservers.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(safeConfig, null, 2)}\n`, "utf-8");
  await rename(tempPath, configPath);
};
