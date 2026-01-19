import { execa } from "execa";
import { setTimeout as delay } from "node:timers/promises";
import type { DevServerService, ServiceStatus } from "@24letters/devservers-shared";

const SESSION_NAME = "devservers";
const IDLE_COMMANDS = new Set(["zsh", "bash", "sh", "fish"]);

const runTmux = async (args: string[]) => {
  return await execa("tmux", args);
};

const shellEscape = (value: string) => {
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
};

const buildCommand = (service: DevServerService) => {
  if (!service.env || Object.keys(service.env).length === 0) {
    return service.command;
  }

  const envPrefix = Object.entries(service.env)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(" ");
  return `${envPrefix} ${service.command}`;
};

export const ensureSession = async () => {
  try {
    await runTmux(["has-session", "-t", SESSION_NAME]);
  } catch {
    await runTmux(["new-session", "-d", "-s", SESSION_NAME]);
  }
};

export const listWindows = async (): Promise<string[]> => {
  try {
    const { stdout } = await runTmux([
      "list-windows",
      "-t",
      SESSION_NAME,
      "-F",
      "#{window_name}"
    ]);
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

export const windowExists = async (windowName: string) => {
  const windows = await listWindows();
  return windows.includes(windowName);
};

const getPaneCommand = async (windowName: string) => {
  try {
    const { stdout } = await runTmux([
      "display-message",
      "-t",
      `${SESSION_NAME}:${windowName}`,
      "-p",
      "#{pane_current_command}"
    ]);
    return stdout.trim();
  } catch {
    return "";
  }
};

const isPaneIdle = async (windowName: string) => {
  const command = await getPaneCommand(windowName);
  return IDLE_COMMANDS.has(command);
};

export const startWindow = async (service: DevServerService): Promise<boolean> => {
  await ensureSession();
  const command = buildCommand(service);

  const exists = await windowExists(service.name);
  if (exists) {
    const [dead, idle] = await Promise.all([isPaneDead(service.name), isPaneIdle(service.name)]);
    if (!dead && !idle) {
      return false;
    }
    try {
      await runTmux(["kill-window", "-t", `${SESSION_NAME}:${service.name}`]);
    } catch {
      // window may have been removed between checks
    }
  }

  await runTmux([
    "new-window",
    "-d",
    "-t",
    SESSION_NAME,
    "-n",
    service.name,
    "-c",
    service.cwd
  ]);
  await runTmux(["send-keys", "-t", `${SESSION_NAME}:${service.name}`, command, "C-m"]);
  return true;
};

export const stopWindow = async (windowName: string) => {
  const exists = await windowExists(windowName);
  if (!exists) {
    return;
  }
  await runTmux(["send-keys", "-t", `${SESSION_NAME}:${windowName}`, "C-c"]);
  await delay(200);
  try {
    await runTmux(["kill-window", "-t", `${SESSION_NAME}:${windowName}`]);
  } catch {
    // window may have closed after stopping
  }
};

export const restartWindow = async (service: DevServerService): Promise<boolean> => {
  await stopWindow(service.name);
  await delay(300);
  return await startWindow(service);
};

export const isPaneDead = async (windowName: string) => {
  try {
    const { stdout } = await runTmux([
      "list-panes",
      "-t",
      `${SESSION_NAME}:${windowName}`,
      "-F",
      "#{pane_dead}"
    ]);
    return stdout.trim() === "1";
  } catch {
    return false;
  }
};

export const capturePane = async (windowName: string, lines: number) => {
  const exists = await windowExists(windowName);
  if (!exists) {
    return "";
  }
  const start = -Math.abs(lines);
  const { stdout } = await runTmux([
    "capture-pane",
    "-t",
    `${SESSION_NAME}:${windowName}`,
    "-p",
    "-S",
    start.toString()
  ]);
  return stdout;
};

export const getServiceStatus = async (service: DevServerService): Promise<ServiceStatus> => {
  const exists = await windowExists(service.name);
  if (!exists) {
    return "stopped";
  }

  const dead = await isPaneDead(service.name);
  if (dead) {
    return "error";
  }

  const idle = await isPaneIdle(service.name);
  if (idle) {
    return "stopped";
  }

  return "running";
};
