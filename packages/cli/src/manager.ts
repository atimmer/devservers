import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { DAEMON_PORT } from "@24letters/devservers-shared";
import { resolveConfigPath } from "./config.js";

const require = createRequire(import.meta.url);
const daemonEntry = require.resolve("@24letters/devservers-daemon");
const cliEntryPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(cliEntryPath), "..");
const runningFromSource = path.basename(path.dirname(cliEntryPath)) === "src";
const localDaemonRoot = path.resolve(packageRoot, "..", "daemon");
const localDaemonEntry = path.join(localDaemonRoot, "src", "index.ts");
const localUiRoot = path.resolve(packageRoot, "..", "..", "apps", "ui");
const MANAGER_SESSION = "devservers";
const MANAGER_DAEMON_WINDOW = "manager-daemon";
const MANAGER_UI_WINDOW = "manager-ui";
const DEV_UI_URL = "http://localhost:4142/";

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
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("tmux is required. Install it first and retry.");
    }
    throw result.error;
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr?.trim() || `tmux ${args.join(" ")} failed`);
  }
  return result;
};
const sessionExists = () => runTmux(["has-session", "-t", MANAGER_SESSION], true).status === 0;
const windowNames = () => {
  const result = runTmux(["list-windows", "-t", MANAGER_SESSION, "-F", "#{window_name}"], true);
  return result.status === 0
    ? result.stdout
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
};
const windowExists = (name: string) => windowNames().includes(name);
const idleCommands = new Set(["zsh", "bash", "sh", "fish", "nu", "elvish", "xonsh", "login"]);
if (process.env["SHELL"]) idleCommands.add(path.basename(process.env["SHELL"]));
const windowIdle = (name: string) => {
  const result = runTmux(
    ["display-message", "-t", `${MANAGER_SESSION}:${name}`, "-p", "#{pane_current_command}"],
    true,
  );
  return result.status === 0 && idleCommands.has(result.stdout.trim());
};
const stopWindow = (name: string) => {
  if (!windowExists(name)) return false;
  runTmux(["kill-window", "-t", `${MANAGER_SESSION}:${name}`]);
  return true;
};
const startWindow = (name: string, command: string, cwd: string, restart: boolean) => {
  if (windowExists(name)) {
    if (!restart) {
      if (windowIdle(name)) {
        runTmux([
          "send-keys",
          "-t",
          `${MANAGER_SESSION}:${name}`,
          `cd ${shellQuote(cwd)} && ${command}`,
          "C-m",
        ]);
      }
      return;
    }
    stopWindow(name);
  }
  runTmux(["new-window", "-d", "-t", MANAGER_SESSION, "-n", name, "-c", cwd]);
  runTmux([
    "send-keys",
    "-t",
    `${MANAGER_SESSION}:${name}`,
    `cd ${shellQuote(cwd)} && ${command}`,
    "C-m",
  ]);
};

const daemonCommand = async (configPath: string, port: number, source: boolean) => {
  if (source && (await pathExists(localDaemonEntry))) {
    return `pnpm -C ${shellQuote(localDaemonRoot)} dev -- --config ${shellQuote(configPath)} --port ${shellQuote(String(port))}`;
  }
  if (!(await pathExists(daemonEntry)))
    throw new Error("Daemon build not found. Run `pnpm -r build`.");
  return [process.execPath, daemonEntry, "--config", configPath, "--port", String(port)]
    .map(shellQuote)
    .join(" ");
};

const startDaemonWindow = async (
  configPath: string,
  port: number,
  restart: boolean,
  source = runningFromSource,
) => {
  const command = await daemonCommand(configPath, port, source);
  if (!sessionExists()) {
    runTmux([
      "new-session",
      "-d",
      "-s",
      MANAGER_SESSION,
      "-n",
      MANAGER_DAEMON_WINDOW,
      "-c",
      process.cwd(),
    ]);
    runTmux(["send-keys", "-t", `${MANAGER_SESSION}:${MANAGER_DAEMON_WINDOW}`, command, "C-m"]);
  } else startWindow(MANAGER_DAEMON_WINDOW, command, process.cwd(), restart);
};

const reachable = async (url: string, pathname = "/services") => {
  try {
    return (await fetch(`${url}${pathname}`)).ok;
  } catch {
    return false;
  }
};
const waitForDaemon = async (url: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await reachable(url)) return true;
    await delay(250);
  }
  return false;
};
const loopback = (hostname: string) => ["localhost", "127.0.0.1", "::1"].includes(hostname);

export const ensureDaemonRunning = async (
  baseUrl: string,
  configPath: string,
  source = runningFromSource,
) => {
  if (await reachable(baseUrl)) return;
  const url = new URL(baseUrl);
  if (!loopback(url.hostname)) return;
  await startDaemonWindow(configPath, url.port ? Number(url.port) : DAEMON_PORT, false, source);
  if (!(await waitForDaemon(baseUrl)))
    throw new Error("Daemon failed to start. Run `devservers daemon start` to inspect.");
};

type StartOptions = { config?: string; port?: string; ui?: string; restart?: boolean };

export const registerManagerCommands = (program: Command) => {
  const manager = program.command("daemon").description("Manage the manager daemon and UI");
  const runStart = async (
    options: StartOptions,
    restartDaemonWindow: boolean,
    restartUiWindow: boolean,
  ) => {
    const global = program.opts<{ config?: string }>();
    const configPath = resolveConfigPath(options.config ?? global.config);
    const port = Number(options.port ?? DAEMON_PORT);
    const mode = options.ui?.toLowerCase() ?? (runningFromSource ? "vite" : "daemon");
    if (!["vite", "daemon"].includes(mode) || !Number.isFinite(port))
      throw new Error("Invalid daemon start options.");
    const baseUrl = `http://127.0.0.1:${port}`;
    const useSourceDaemon = runningFromSource && mode === "vite";
    if (restartDaemonWindow) {
      await startDaemonWindow(configPath, port, true, runningFromSource && mode === "vite");
      if (!(await waitForDaemon(baseUrl))) throw new Error("Daemon failed to start.");
    } else {
      await ensureDaemonRunning(baseUrl, configPath, useSourceDaemon);
      if (mode === "daemon" && !(await reachable(baseUrl, "/ui/"))) {
        await startDaemonWindow(configPath, port, true, useSourceDaemon);
        if (!(await waitForDaemon(baseUrl)) || !(await reachable(baseUrl, "/ui/"))) {
          throw new Error("Daemon started but UI is not reachable at /ui/.");
        }
      }
    }
    if (mode === "vite") {
      const command = `VITE_DAEMON_URL=${shellQuote(baseUrl)} pnpm -C ${shellQuote(localUiRoot)} dev`;
      startWindow(MANAGER_UI_WINDOW, command, process.cwd(), restartUiWindow);
    }
    console.log(`Manager running in tmux session '${MANAGER_SESSION}'.`);
    console.log(`UI: ${mode === "vite" ? DEV_UI_URL : new URL("/ui/", baseUrl).toString()}`);
    console.log(`Attach: tmux attach -t ${MANAGER_SESSION}`);
  };
  const startOptions = (command: Command) =>
    command
      .option("--config <path>")
      .option("--port <port>", "daemon port", String(DAEMON_PORT))
      .option("--ui <mode>", "ui mode (daemon|vite)");
  startOptions(manager.command("start").description("Start the manager daemon and UI"))
    .option("--restart", "restart windows", false)
    .action((options: StartOptions) =>
      runStart(options, Boolean(options.restart), Boolean(options.restart)),
    );
  startOptions(manager.command("restart").description("Restart the manager daemon window")).action(
    (options: StartOptions) => runStart(options, true, false),
  );
  manager
    .command("status")
    .description("Show manager daemon and UI status")
    .action(async () => {
      const baseUrl = program.opts<{ daemon: string }>().daemon;
      const daemonReachable = await reachable(baseUrl);
      const daemonUiUrl = new URL("/ui/", baseUrl).toString();
      const daemonUiReachable = daemonReachable && (await reachable(baseUrl, "/ui/"));
      const viteUiRunning = windowExists(MANAGER_UI_WINDOW);
      console.log(`tmux session: ${sessionExists() ? "running" : "stopped"} (${MANAGER_SESSION})`);
      console.log(
        `daemon window: ${windowExists(MANAGER_DAEMON_WINDOW) ? "running" : "stopped"} (${MANAGER_DAEMON_WINDOW})`,
      );
      console.log(`daemon http: ${daemonReachable ? "reachable" : "unreachable"} (${baseUrl})`);
      console.log(`daemon ui: ${daemonUiReachable ? "reachable" : "unreachable"} (${daemonUiUrl})`);
      console.log(
        `vite ui window: ${viteUiRunning ? "running" : "stopped"} (${MANAGER_UI_WINDOW})`,
      );
      console.log(`vite ui url: ${viteUiRunning ? DEV_UI_URL : "not running"}`);
    });
  manager
    .command("stop")
    .description("Stop the manager daemon and dev UI windows")
    .action(() => {
      const stoppedDaemon = stopWindow(MANAGER_DAEMON_WINDOW);
      const stoppedUi = stopWindow(MANAGER_UI_WINDOW);
      if (!stoppedDaemon && !stoppedUi) {
        console.log("Manager daemon is not running.");
      } else if (stoppedDaemon && stoppedUi) {
        console.log("Stopped manager daemon and UI.");
      } else if (stoppedDaemon) {
        console.log("Stopped manager daemon.");
      } else {
        console.log("Stopped manager UI.");
      }
    });
};
