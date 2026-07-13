import type { ServiceActionResult, ServiceInfo, ServiceStatus } from "./api";

export type MainSelection =
  | { type: "service"; serviceName: string }
  | { type: "working-copy"; groupKey: string };

export type WorkingCopyGroup = {
  key: string;
  title: string;
  root: string;
  services: ServiceInfo[];
};

export const getWorkingDirectory = (service: ServiceInfo) => service.repo?.root ?? service.cwd;

export const formatWorkspace = (workspace?: string) => {
  if (!workspace) return null;
  return workspace === "." ? "root" : workspace;
};

export const formatEnv = (env?: Record<string, string>) =>
  env
    ? Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
    : "";

export const parseEnv = (value: string) => {
  const env: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const [key, ...rest] = line.trim().split("=");
    if (key && rest.length > 0) env[key] = rest.join("=");
  }
  return Object.keys(env).length > 0 ? env : undefined;
};

export const fuzzyMatch = (query: string, ...values: Array<string | undefined>) => {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  return tokens.every((token) => {
    if (haystack.includes(token)) return true;
    let cursor = -1;
    for (const character of token) {
      cursor = haystack.indexOf(character, cursor + 1);
      if (cursor === -1) return false;
    }
    return true;
  });
};

const pathName = (value: string) => {
  const parts = value.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.at(-1) ?? "Standalone";
};

const startedAt = (service: ServiceInfo) => {
  const parsed = service.lastStartedAt ? Date.parse(service.lastStartedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export const compareByMostRecentlyStarted = (a: ServiceInfo, b: ServiceInfo) =>
  startedAt(b) - startedAt(a) || a.name.localeCompare(b.name, undefined, { numeric: true });

export const groupServices = (services: ServiceInfo[]): WorkingCopyGroup[] => {
  const groups = new Map<string, WorkingCopyGroup>();
  for (const service of services) {
    const root = getWorkingDirectory(service);
    const group = groups.get(root) ?? { key: root, root, title: pathName(root), services: [] };
    group.services.push(service);
    groups.set(root, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      services: [...group.services].sort(compareByMostRecentlyStarted),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
};

export const summarizeAction = (result: ServiceActionResult) => {
  const verb =
    result.action === "start"
      ? "Started"
      : result.action === "stop"
        ? "Stopped"
        : result.action === "delete"
          ? "Deleted"
          : "Restarted";
  const affected = result.affected.length > 0 ? result.affected : [result.target];
  return `${verb} ${affected.join(", ")}.`;
};

export const statusLabel = (status: ServiceStatus) =>
  status === "exited" ? "Exited" : status.charAt(0).toUpperCase() + status.slice(1);

export const statusDetail = (service: ServiceInfo) => {
  if (service.message) return service.message;
  if (service.status === "exited" && service.exitCode !== undefined)
    return `Exited with code ${service.exitCode}`;
  return null;
};

export const isServiceBusy = (status: ServiceStatus) => status === "starting";

export const isServiceActive = (status: ServiceStatus) =>
  status === "starting" || status === "running";

export const getStopImpact = (services: ServiceInfo[], target: string) => {
  const affected = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const service of services) {
      if (
        !affected.has(service.name) &&
        service.dependsOn?.some((dependency) => affected.has(dependency))
      ) {
        affected.add(service.name);
        changed = true;
      }
    }
  }
  return [...affected];
};
