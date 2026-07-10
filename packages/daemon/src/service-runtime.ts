import type { ServiceInfo } from "@24letters/devservers-shared";

export const DEFAULT_LOG_LINES = 200;
export const MAX_LOG_LINES = 2_000;

type ServiceRuntime = Pick<ServiceInfo, "status" | "message" | "exitCode" | "exitSignal">;

const IDLE_COMMANDS = new Set(["zsh", "bash", "sh", "fish"]);

export const normalizeLogLines = (value: string | undefined): number => {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_LOG_LINES;
  }
  return Math.min(Math.trunc(requested), MAX_LOG_LINES);
};

export const parsePaneRuntime = (snapshot: string): ServiceRuntime => {
  const [deadValue, exitCodeValue, exitSignalValue, command = "", managedValue] = snapshot
    .trim()
    .split("\t");
  const dead = deadValue === "1";
  const managed = managedValue === "1";

  if (!dead) {
    if (!managed && IDLE_COMMANDS.has(command)) {
      return { status: "stopped" };
    }
    return { status: "running" };
  }

  const parsedExitCode = exitCodeValue ? Number(exitCodeValue) : undefined;
  const exitCode = Number.isInteger(parsedExitCode) ? parsedExitCode : undefined;
  const exitSignal = exitSignalValue || undefined;

  if (exitCode === 0 && !exitSignal) {
    return {
      status: "exited",
      message: "Exited successfully.",
      exitCode,
    };
  }

  const detail = exitSignal
    ? `signal ${exitSignal}`
    : exitCode === undefined
      ? "an unknown error"
      : `code ${exitCode}`;
  return {
    status: "error",
    message: `Exited with ${detail}.`,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(exitSignal ? { exitSignal } : {}),
  };
};
