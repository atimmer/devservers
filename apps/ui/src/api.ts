export type ServiceStatus = "stopped" | "running" | "error";

export type ServiceInfo = {
  name: string;
  cwd: string;
  command: string;
  env?: Record<string, string>;
  port?: number;
  status: ServiceStatus;
  message?: string;
};

const API_BASE = import.meta.env.VITE_DAEMON_URL ?? "http://127.0.0.1:4141";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export const getServices = async (): Promise<ServiceInfo[]> => {
  const response = await fetch(`${API_BASE}/services`);
  if (!response.ok) {
    throw new Error(await response.text());
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
    throw new Error(await response.text());
  }
};

const postAction = async (name: string, action: "start" | "stop" | "restart") => {
  const response = await fetch(`${API_BASE}/services/${name}/${action}`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
};

export const startService = (name: string) => postAction(name, "start");
export const stopService = (name: string) => postAction(name, "stop");
export const restartService = (name: string) => postAction(name, "restart");

export const createLogsSocket = (name: string, lines = 200) => {
  return new WebSocket(`${WS_BASE}/services/${name}/logs?lines=${lines}`);
};
