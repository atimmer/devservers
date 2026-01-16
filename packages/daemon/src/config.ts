import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONFIG_ENV_VAR,
  DEFAULT_CONFIG_FILENAME,
  devServerConfigSchema,
  type DevServerConfig,
  type DevServerService
} from "@24letters/devservers-shared";

const defaultConfigPath = () => {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Devservers Manager",
      DEFAULT_CONFIG_FILENAME
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
  if (override) {
    return path.resolve(override);
  }

  const envPath = process.env[CONFIG_ENV_VAR];
  if (envPath) {
    return path.resolve(envPath);
  }

  return defaultConfigPath();
};

const ensureUniqueServices = (services: DevServerService[]) => {
  const seen = new Set<string>();
  for (const service of services) {
    if (seen.has(service.name)) {
      throw new Error(`Duplicate service name: ${service.name}`);
    }
    seen.add(service.name);
  }
};

export const readConfig = async (configPath: string): Promise<DevServerConfig> => {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = devServerConfigSchema.parse(JSON.parse(raw));
    ensureUniqueServices(parsed.services);
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { version: 1, services: [] };
    }
    throw error;
  }
};

export const writeConfig = async (configPath: string, config: DevServerConfig) => {
  const safeConfig = devServerConfigSchema.parse(config);
  ensureUniqueServices(safeConfig.services);
  const dir = path.dirname(configPath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.devservers.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(safeConfig, null, 2)}\n`;
  await writeFile(tempPath, payload, "utf-8");
  await rename(tempPath, configPath);
};

export const upsertService = (
  config: DevServerConfig,
  service: DevServerService
): DevServerConfig => {
  const existingIndex = config.services.findIndex((item) => item.name === service.name);
  if (existingIndex === -1) {
    return { ...config, services: [...config.services, service] };
  }

  const updated = [...config.services];
  const existing = config.services[existingIndex];
  updated[existingIndex] = {
    ...service,
    lastStartedAt: service.lastStartedAt ?? existing?.lastStartedAt
  };
  return { ...config, services: updated };
};

export const removeService = (config: DevServerConfig, name: string): DevServerConfig => {
  return { ...config, services: config.services.filter((service) => service.name !== name) };
};
