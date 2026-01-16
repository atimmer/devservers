import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  CONFIG_ENV_VAR,
  DAEMON_PORT,
  DEFAULT_CONFIG_FILENAME,
  devServerConfigSchema,
  devServerServiceSchema,
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
  const existing = config.services[existingIndex];
  updated[existingIndex] = {
    ...service,
    lastStartedAt: service.lastStartedAt ?? existing?.lastStartedAt
  };
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

const require = createRequire(import.meta.url);
const daemonEntry = require.resolve("@24letters/devservers-daemon");
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(packageRoot, "skills");

const AGENT_HOME_ENV: Record<string, string> = {
  codex: "CODEX_HOME",
  claude: "CLAUDE_HOME",
  cursor: "CURSOR_HOME",
  windsurf: "WINDSURF_HOME"
};

const resolveAgentHome = (agentInput?: string) => {
  const normalized = agentInput?.trim().toLowerCase() || "codex";
  const envKey = AGENT_HOME_ENV[normalized] ?? `${normalized.toUpperCase()}_HOME`;
  const envValue = process.env[envKey];
  if (envValue) {
    return path.resolve(envValue);
  }
  return path.join(os.homedir(), `.${normalized}`);
};

const IDLE_COMMANDS = new Set(["zsh", "bash", "sh", "fish"]);

const pathExists = async (target: string) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

const runTmux = (args: string[], allowFailure = false) => {
  const result = spawnSync("tmux", args, { encoding: "utf-8" });
  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error("tmux is required. Install it first and retry.");
    }
    throw error;
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr?.trim() || `tmux ${args.join(" ")} failed`);
  }
  return result;
};

const tmuxSessionExists = (session: string) => {
  return runTmux(["has-session", "-t", session], true).status === 0;
};

const tmuxWindowNames = (session: string) => {
  const result = runTmux(["list-windows", "-t", session, "-F", "#{window_name}"], true);
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

const tmuxWindowExists = (session: string, windowName: string) => {
  return tmuxWindowNames(session).includes(windowName);
};

const tmuxPaneCommand = (session: string, windowName: string) => {
  const result = runTmux(
    ["display-message", "-t", `${session}:${windowName}`, "-p", "#{pane_current_command}"],
    true
  );
  if (result.status !== 0 || !result.stdout) {
    return "";
  }
  return result.stdout.trim();
};

const tmuxPaneIdle = (session: string, windowName: string) => {
  return IDLE_COMMANDS.has(tmuxPaneCommand(session, windowName));
};

const tmuxStartWindow = (
  session: string,
  windowName: string,
  command: string,
  cwd: string,
  restart: boolean
) => {
  if (tmuxWindowExists(session, windowName)) {
    if (!restart) {
      if (tmuxPaneIdle(session, windowName)) {
        runTmux(["send-keys", "-t", `${session}:${windowName}`, command, "C-m"]);
      }
      return;
    }
    runTmux(["kill-window", "-t", `${session}:${windowName}`]);
  }

  runTmux(["new-window", "-d", "-t", session, "-n", windowName, "-c", cwd]);
  runTmux(["send-keys", "-t", `${session}:${windowName}`, command, "C-m"]);
};

const buildDaemonCommand = (configPath: string, port: number) => {
  return [
    shellQuote(process.execPath),
    shellQuote(daemonEntry),
    "--config",
    shellQuote(configPath),
    "--port",
    shellQuote(String(port))
  ].join(" ");
};

const startDaemonWindow = async (configPath: string, port: number, restart: boolean) => {
  const session = "devservers";
  const daemonWindow = "manager-daemon";
  const cwd = process.cwd();
  if (!(await pathExists(daemonEntry))) {
    throw new Error(
      "Daemon build not found. Run `pnpm -C packages/daemon build` (or `pnpm -r build`) before bootstrapping."
    );
  }
  const daemonCommand = buildDaemonCommand(configPath, port);

  if (!tmuxSessionExists(session)) {
    runTmux(["new-session", "-d", "-s", session, "-n", daemonWindow, "-c", cwd]);
    runTmux(["send-keys", "-t", `${session}:${daemonWindow}`, daemonCommand, "C-m"]);
  } else {
    tmuxStartWindow(session, daemonWindow, daemonCommand, cwd, restart);
  }
};

const isLoopbackHost = (hostname: string) => {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
};

const isDaemonReachable = async (baseUrl: string) => {
  try {
    await fetch(`${baseUrl}/services`);
    return true;
  } catch {
    return false;
  }
};

const waitForDaemon = async (baseUrl: string, attempts = 20, delayMs = 250) => {
  for (let i = 0; i < attempts; i += 1) {
    if (await isDaemonReachable(baseUrl)) {
      return true;
    }
    await delay(delayMs);
  }
  return false;
};

const ensureDaemonRunning = async (baseUrl: string, configPath: string) => {
  if (await isDaemonReachable(baseUrl)) {
    return;
  }

  const url = new URL(baseUrl);
  if (!isLoopbackHost(url.hostname)) {
    return;
  }

  const port = url.port ? Number(url.port) : DAEMON_PORT;
  await startDaemonWindow(configPath, port, false);
  const ready = await waitForDaemon(baseUrl);
  if (!ready) {
    throw new Error("Daemon failed to start. Run `devservers bootstrap` to inspect.");
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
  .option("--port-mode <mode>", "port mode (static|detect|registry)")
  .option("--env <entry...>", "Environment variables (KEY=VALUE)")
  .action(async (options) => {
    const programOptions = program.opts<{ config?: string }>();
    const configPath = resolveConfigPath(programOptions.config);
    const service = devServerServiceSchema.parse({
      name: options.name,
      cwd: options.cwd,
      command: options.command,
      port: options.port ? Number(options.port) : undefined,
      portMode: options.portMode,
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

program
  .command("bootstrap")
  .description("Start the manager daemon in tmux and serve the UI")
  .option("--config <path>", "config path")
  .option("--port <port>", "daemon port", String(DAEMON_PORT))
  .option("--restart", "restart the manager daemon window", false)
  .action(async (options) => {
    const globalOptions = program.opts<{ config?: string }>();
    const configPath = resolveConfigPath(options.config ?? globalOptions.config);
    const port = Number(options.port ?? DAEMON_PORT);
    if (!Number.isFinite(port)) {
      throw new Error(`Invalid port: ${options.port}`);
    }

    const session = "devservers";
    await startDaemonWindow(configPath, port, Boolean(options.restart));

    console.log(`Manager running in tmux session '${session}'.`);
    console.log(`UI: http://127.0.0.1:${port}/ui/`);
    console.log(`Attach: tmux attach -t ${session}`);
  });

program
  .command("install-skill")
  .description("Install Devservers Manager skills for your AI agent")
  .argument("[name]", "skill name (default: install all)")
  .option("--agent <name>", "agent name (default: codex)")
  .option("--dest <path>", "skills directory")
  .option("--dry-run", "show what would be installed", false)
  .option("--force", "overwrite existing skills", false)
  .action(async (name: string | undefined, options) => {
    if (!(await pathExists(skillsRoot))) {
      throw new Error(`Skills directory not found at ${skillsRoot}`);
    }

    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const available = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const targets = name ? [name] : available;

    if (name && !available.includes(name)) {
      throw new Error(`Unknown skill '${name}'. Available: ${available.sort().join(", ")}`);
    }

    const agentHome = resolveAgentHome(options.agent);
    const destRoot = path.resolve(options.dest ?? path.join(agentHome, "skills"));

    if (options.dryRun) {
      console.log(`Would install: ${targets.sort().join(", ")}`);
      console.log(`Destination: ${destRoot}`);
      return;
    }

    await mkdir(destRoot, { recursive: true });

    for (const skillName of targets) {
      const src = path.join(skillsRoot, skillName);
      const dest = path.join(destRoot, skillName);
      const srcStat = await stat(src);
      if (!srcStat.isDirectory()) {
        continue;
      }
      if ((await pathExists(dest)) && !options.force) {
        console.log(`Skipping ${skillName} (already exists). Use --force to overwrite.`);
        continue;
      }
      await cp(src, dest, { recursive: true });
      console.log(`Installed ${skillName}`);
    }
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
      const options = program.opts<{ daemon: string; config?: string }>();
      const configPath = resolveConfigPath(options.config);
      await ensureDaemonRunning(options.daemon, configPath);
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
