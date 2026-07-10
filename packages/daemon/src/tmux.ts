import { execa } from "execa";
import { setTimeout as delay } from "node:timers/promises";
import type { DevServerService, ServiceInfo } from "@24letters/devservers-shared";
import { resolveEnv } from "./env.js";
import { writeManagedEnvFile } from "./managed-env-file.js";
import { parsePaneRuntime } from "./service-runtime.js";

const SESSION_NAME = "devservers";
const MANAGED_PANE_OPTION = "@devservers-managed";
const PANE_RUNTIME_FORMAT = [
  "#{pane_dead}",
  "#{pane_dead_status}",
  "#{pane_dead_signal}",
  "#{pane_current_command}",
  `#{${MANAGED_PANE_OPTION}}`
].join("\t");

const runTmux = async (args: string[]) => {
  return await execa("tmux", args);
};

const shellEscape = (value: string) => {
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
};

const buildCommand = (service: DevServerService, env: Record<string, string> | undefined) => {
  if (!env || Object.keys(env).length === 0) {
    return service.command;
  }

  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shellEscape(value ?? "")}`)
    .join(" ");
  return `${envPrefix} ${service.command}`;
};

type StartWindowOptions = {
  resolvedPort?: number;
  servicePorts?: Record<string, number | undefined>;
  managedEnvFile?: string;
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

const getPaneRuntime = async (
  windowName: string
): Promise<Pick<ServiceInfo, "status" | "message" | "exitCode" | "exitSignal">> => {
  const { stdout } = await runTmux([
    "display-message",
    "-t",
    `${SESSION_NAME}:${windowName}`,
    "-p",
    PANE_RUNTIME_FORMAT
  ]);
  return parsePaneRuntime(stdout);
};

export const startWindow = async (
  service: DevServerService,
  options?: StartWindowOptions
): Promise<boolean> => {
  await ensureSession();
  const env = resolveEnv(service.env, options?.resolvedPort, options?.servicePorts);
  if (options?.managedEnvFile) {
    await writeManagedEnvFile(options.managedEnvFile, env);
  }
  const command = buildCommand(service, env);

  const exists = await windowExists(service.name);
  if (exists) {
    const runtime = await getPaneRuntime(service.name);
    if (runtime.status === "running") {
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
  const target = `${SESSION_NAME}:${service.name}`;
  await runTmux(["set-option", "-p", "-t", target, "remain-on-exit", "on"]);
  await runTmux(["set-option", "-p", "-t", target, MANAGED_PANE_OPTION, "1"]);
  await runTmux(["respawn-pane", "-k", "-t", target, "-c", service.cwd, command]);
  return true;
};

export const stopWindow = async (windowName: string): Promise<boolean> => {
  const exists = await windowExists(windowName);
  if (!exists) {
    return false;
  }
  await runTmux(["send-keys", "-t", `${SESSION_NAME}:${windowName}`, "C-c"]);
  await delay(200);
  try {
    await runTmux(["kill-window", "-t", `${SESSION_NAME}:${windowName}`]);
  } catch {
    // window may have closed after stopping
  }
  return true;
};

export const restartWindow = async (
  service: DevServerService,
  options?: StartWindowOptions
): Promise<boolean> => {
  await stopWindow(service.name);
  await delay(300);
  return await startWindow(service, options);
};

export const capturePane = async (
  windowName: string,
  lines: number,
  options: { ansi?: boolean } = {}
) => {
  const exists = await windowExists(windowName);
  if (!exists) {
    return "";
  }
  const start = -Math.abs(lines);
  const args = [
    "capture-pane",
    "-t",
    `${SESSION_NAME}:${windowName}`,
    "-p",
    "-S",
    start.toString()
  ];
  if (options.ansi) {
    args.push("-e");
  }
  const { stdout } = await runTmux(args);
  return stdout;
};

export const getServiceRuntime = async (
  service: DevServerService,
  windowNames?: ReadonlySet<string>
): Promise<Pick<ServiceInfo, "status" | "message" | "exitCode" | "exitSignal">> => {
  const exists = windowNames ? windowNames.has(service.name) : await windowExists(service.name);
  if (!exists) {
    return { status: "stopped" };
  }
  try {
    return await getPaneRuntime(service.name);
  } catch {
    return { status: "error", message: "Unable to inspect service process." };
  }
};
