export type ServiceStatus = "stopped" | "running" | "error";
export type PortMode = "static" | "detect" | "registry";

export type RepoInfo = {
  name: string;
  root: string;
  workspace: string;
};

export type ServiceInfo = {
  name: string;
  cwd: string;
  command: string;
  dependsOn?: string[];
  env?: Record<string, string>;
  port?: number;
  portMode?: PortMode;
  lastStartedAt?: string;
  source?: "config" | "compose";
  projectName?: string;
  projectIsMonorepo?: boolean;
  status: ServiceStatus;
  message?: string;
  repo?: RepoInfo;
};

export type RegisteredProject = {
  name: string;
  path: string;
  isMonorepo?: boolean;
};

export type ServiceConfigDefinition = {
  source: "config" | "compose";
  serviceName: string;
  projectName?: string;
  path: string;
  definition: Record<string, unknown>;
};

const DEFAULT_DAEMON_URL = "http://127.0.0.1:4141";
const API_BASE =
  import.meta.env.VITE_DAEMON_URL ??
  (import.meta.env.DEV || typeof window === "undefined"
    ? DEFAULT_DAEMON_URL
    : window.location.origin);
const WS_BASE = API_BASE.replace(/^http/, "ws");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeMessage = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const formatZodFlattenedError = (value: Record<string, unknown>): string | null => {
  if (!Array.isArray(value.formErrors) || !isRecord(value.fieldErrors)) {
    return null;
  }

  const formErrors = value.formErrors
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const fieldErrors = Object.entries(value.fieldErrors).flatMap(([field, messages]) => {
    if (!Array.isArray(messages)) {
      return [];
    }
    const text = messages
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (text.length === 0) {
      return [];
    }
    return [`${field}: ${text.join(", ")}`];
  });

  const parts = [...formErrors, ...fieldErrors];
  return parts.length > 0 ? parts.join("; ") : "Validation failed";
};

const formatStructuredError = (value: unknown): string | null => {
  if (typeof value === "string") {
    return normalizeMessage(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => formatStructuredError(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join("; ") : null;
  }
  if (!isRecord(value)) {
    return null;
  }

  const zodError = formatZodFlattenedError(value);
  if (zodError) {
    return zodError;
  }

  if ("error" in value) {
    const nested = formatStructuredError(value.error);
    if (nested) {
      return nested;
    }
  }
  if ("message" in value) {
    const nested = formatStructuredError(value.message);
    if (nested) {
      return nested;
    }
  }
  if ("details" in value) {
    const nested = formatStructuredError(value.details);
    if (nested) {
      return nested;
    }
  }

  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const nested = formatStructuredError(entry);
    return nested ? [`${key}: ${nested}`] : [];
  });
  return entries.length > 0 ? entries.join("; ") : null;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  const text = (await response.text()).trim();
  if (!text) {
    const status = response.statusText ? `${response.status} ${response.statusText}` : "";
    return status || `Request failed (${response.status})`;
  }

  try {
    const payload = JSON.parse(text) as unknown;
    return formatStructuredError(payload) ?? text;
  } catch {
    return text;
  }
};

export const getServices = async (): Promise<ServiceInfo[]> => {
  const response = await fetch(`${API_BASE}/services`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const payload = (await response.json()) as { services: ServiceInfo[] };
  return payload.services;
};

export const addService = async (service: Omit<ServiceInfo, "status" | "message">) => {
  const response = await fetch(`${API_BASE}/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(service)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
};

export const updateService = async (
  name: string,
  service: Omit<ServiceInfo, "status" | "message">
) => {
  const response = await fetch(`${API_BASE}/services/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(service)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
};

export const deleteService = async (name: string) => {
  const response = await fetch(`${API_BASE}/services/${name}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
};

export const getProjects = async (): Promise<RegisteredProject[]> => {
  const response = await fetch(`${API_BASE}/projects`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const payload = (await response.json()) as { projects: RegisteredProject[] };
  return payload.projects;
};

export const addProject = async (project: RegisteredProject) => {
  const response = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project)
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
};

export const deleteProject = async (name: string) => {
  const response = await fetch(`${API_BASE}/projects/${name}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
};

export const getServiceConfigDefinition = async (name: string): Promise<ServiceConfigDefinition> => {
  const response = await fetch(`${API_BASE}/services/${name}/config`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ServiceConfigDefinition;
};

const postAction = async (name: string, action: "start" | "stop" | "restart") => {
  const response = await fetch(`${API_BASE}/services/${name}/${action}`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
};

export const startService = (name: string) => postAction(name, "start");
export const stopService = (name: string) => postAction(name, "stop");
export const restartService = (name: string) => postAction(name, "restart");

export const createLogsSocket = (name: string, lines = 200, ansi = false) => {
  const params = new URLSearchParams({ lines: String(lines) });
  if (ansi) {
    params.set("ansi", "1");
  }
  return new WebSocket(`${WS_BASE}/services/${name}/logs?${params.toString()}`);
};
