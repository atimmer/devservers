import { setTimeout as delay } from "node:timers/promises";
import type { DevServerService } from "@24letters/devservers-shared";
import { capturePane } from "./tmux.js";

export const PORT_LOG_LINES = 200;
const PORT_DETECT_POLL_MS = 500;
const PORT_DETECT_TIMEOUT_MS = 15000;
const PORT_REGEX = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/gi;

export const extractPortFromLogs = (logs: string): number | undefined => {
  if (!logs) {
    return undefined;
  }

  let latest: number | undefined;
  for (const line of logs.split("\n")) {
    const lower = line.toLowerCase();
    if (lower.includes("in use") || lower.includes("eaddrinuse")) {
      continue;
    }
    PORT_REGEX.lastIndex = 0;
    for (const match of line.matchAll(PORT_REGEX)) {
      const port = Number(match[1]);
      if (Number.isFinite(port) && port > 0 && port <= 65535) {
        latest = port;
      }
    }
  }

  return latest;
};

export const detectPortFromLogs = async (service: DevServerService, baseline: string) => {
  const startedAt = Date.now();
  let lastSnapshot = baseline;

  while (Date.now() - startedAt < PORT_DETECT_TIMEOUT_MS) {
    await delay(PORT_DETECT_POLL_MS);
    const snapshot = await capturePane(service.name, PORT_LOG_LINES);
    if (!snapshot || snapshot === lastSnapshot) {
      continue;
    }

    const delta = snapshot.startsWith(lastSnapshot)
      ? snapshot.slice(lastSnapshot.length)
      : snapshot;
    const detected = extractPortFromLogs(delta) ?? extractPortFromLogs(snapshot);
    if (detected) {
      return detected;
    }
    lastSnapshot = snapshot;
  }

  return undefined;
};
