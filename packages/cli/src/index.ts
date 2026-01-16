import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  CONFIG_ENV_VAR,
  DAEMON_PORT,
  DEFAULT_CONFIG_FILENAME,
  devServerConfigSchema,
  devServerServiceSchema,
  type DevServerConfig,
  type DevServerService
} from "@atimmer/devservers-shared";

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
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Devservers Manager", DEFAULT_CONFIG_FILENAME);
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return path.join(xdgConfig, "devservers", DEFAULT_CONFIG_FILENAME);
};

const resolveConfigPath = (override?: string) => {
  if (override) {
    return path.resolve(override);
  }

  const envPath = process.env[CONFIG_ENV_VAR];
  if (envPath) {
    return path.resolve(envPath);
  }

  return defaultConfigPath();
};

const readConfig = async (configPath: string): Promise<DevServerConfig> => {
  try {
    const raw = await readFile(configPath, "utf-8");
    return devServerConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { version: 1, services: [] };
    }
    throw error;
  }
};

const writeConfig = async (configPath: string, config: DevServerConfig) => {
  const safeConfig = devServerConfigSchema.parse(config);
  const dir = path.dirname(configPath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.devservers.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(safeConfig, null, 2)}\n`;
  await writeFile(tempPath, payload, "utf-8");
  await rename(tempPath, configPath);
};

const upsertService = (
  config: DevServerConfig,
  service: DevServerService
): DevServerConfig => {
  const existingIndex = config.services.findIndex((item) => item.name === service.name);
  if (existingIndex === -1) {
    return { ...config, services: [...config.services, service] };
  }

  const updated = [...config.services];
  updated[existingIndex] = service;
  return { ...config, services: updated };
};

const removeService = (config: DevServerConfig, name: string): DevServerConfig => {
  return { ...config, services: config.services.filter((service) => service.name !== name) };
};

const parseEnvVars = (entries?: string[]) => {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid env entry: ${entry}`);
    }
    env[key] = rest.join("=");
  }
  return env;
};

const callDaemon = async (baseUrl: string, pathName: string, method: string) => {
  const response = await fetch(`${baseUrl}${pathName}`, { method });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
};

const program = new Command();
program
  .name("devservers")
  .description("Local dev server manager")
  .option("-c, --config <path>", "config path")
  .option("--daemon <url>", "daemon base URL", `http://127.0.0.1:${DAEMON_PORT}`);

program
  .command("list")
  .description("List configured services")
  .action(async () => {
    const options = program.opts<{ config?: string }>();
    const configPath = resolveConfigPath(options.config);
    const config = await readConfig(configPath);
    if (config.services.length === 0) {
      console.log("No services configured.");
      return;
    }
    for (const service of config.services) {
      console.log(`${service.name} -> ${service.command} (${service.cwd})`);
    }
  });

program
  .command("status")
  .description("Show running status from daemon")
  .action(async () => {
    const options = program.opts<{ daemon: string }>();
    const response = await fetch(`${options.daemon}/services`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = (await response.json()) as { services: Array<{ name: string; status: string }> };
    for (const service of payload.services) {
      console.log(`${service.name}: ${service.status}`);
    }
  });

program
  .command("add")
  .description("Add or update a service")
  .requiredOption("--name <name>")
  .requiredOption("--cwd <path>")
  .requiredOption("--command <command>")
  .option("--port <port>")
  .option("--env <entry...>", "Environment variables (KEY=VALUE)")
  .action(async (options) => {
    const programOptions = program.opts<{ config?: string }>();
    const configPath = resolveConfigPath(programOptions.config);
    const service = devServerServiceSchema.parse({
      name: options.name,
      cwd: options.cwd,
      command: options.command,
      port: options.port ? Number(options.port) : undefined,
      env: parseEnvVars(options.env)
    });

    const config = await readConfig(configPath);
    const nextConfig = upsertService(config, service);
    await writeConfig(configPath, nextConfig);
    console.log(`Saved ${service.name}`);
  });

program
  .command("remove")
  .description("Remove a service")
  .argument("<name>")
  .action(async (name: string) => {
    const options = program.opts<{ config?: string }>();
    const configPath = resolveConfigPath(options.config);
    const config = await readConfig(configPath);
    const nextConfig = removeService(config, name);
    await writeConfig(configPath, nextConfig);
    console.log(`Removed ${name}`);
  });

const daemonCommand = (
  name: string,
  pathName: string,
  description: string,
  pastTense: string
) => {
  program
    .command(name)
    .description(description)
    .argument("<service>")
    .action(async (service: string) => {
      const options = program.opts<{ daemon: string }>();
      await callDaemon(options.daemon, `/services/${service}/${pathName}`, "POST");
      console.log(`${pastTense} ${service}`);
    });
};

daemonCommand("start", "start", "Start a service via the daemon", "Started");
daemonCommand("stop", "stop", "Stop a service via the daemon", "Stopped");
daemonCommand("restart", "restart", "Restart a service via the daemon", "Restarted");

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
