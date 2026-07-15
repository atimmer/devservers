import type {
  DevServerService,
  ServiceAction,
  ServiceActionResult,
  ServiceInfo,
} from "@24letters/devservers-shared";

export type DaemonServiceSummary = Pick<
  ServiceInfo,
  "name" | "status" | "port" | "message" | "exitCode" | "exitSignal"
>;

export type DaemonActionResult = { ok: true } & Partial<Omit<ServiceActionResult, "ok">>;
export type DaemonLogsSnapshot = {
  service: string;
  status: ServiceInfo["status"];
  logs: string;
};

const errorMessage = async (response: Response) => {
  const text = await response.text();
  if (!text) return response.statusText;
  try {
    const payload = JSON.parse(text) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : text;
  } catch {
    return text;
  }
};

export const requestDaemon = async <T>(
  baseUrl: string,
  pathName: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${baseUrl}${pathName}`, init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
};

export const fetchDaemonServices = async (baseUrl: string) => {
  const payload = await requestDaemon<{ services: DaemonServiceSummary[] }>(baseUrl, "/services");
  return payload.services.map(({ name, status, port, message, exitCode, exitSignal }) => ({
    name,
    status,
    ...(port === undefined ? {} : { port }),
    ...(message === undefined ? {} : { message }),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(exitSignal === undefined ? {} : { exitSignal }),
  }));
};

export const fetchServiceLogs = (
  baseUrl: string,
  name: string,
  options: { lines: number; ansi: boolean },
) => {
  const query = new URLSearchParams({ lines: String(options.lines) });
  if (options.ansi) query.set("ansi", "1");
  return requestDaemon<DaemonLogsSnapshot>(
    baseUrl,
    `/services/${encodeURIComponent(name)}/logs/snapshot?${query.toString()}`,
  );
};

export const mutateService = (
  baseUrl: string,
  name: string,
  method: "PUT" | "DELETE",
  service?: DevServerService,
) =>
  requestDaemon<DaemonActionResult>(baseUrl, `/services/${encodeURIComponent(name)}`, {
    method,
    headers: service ? { "content-type": "application/json" } : undefined,
    body: service ? JSON.stringify(service) : undefined,
  });

export const runServiceAction = (
  baseUrl: string,
  name: string,
  action: Exclude<ServiceAction, "delete">,
) =>
  requestDaemon<DaemonActionResult>(baseUrl, `/services/${encodeURIComponent(name)}/${action}`, {
    method: "POST",
  });
