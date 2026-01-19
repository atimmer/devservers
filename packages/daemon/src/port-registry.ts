import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const PORT_REGISTRY_ENV_VAR = "DEVSERVER_PORT_REGISTRY";
const DEFAULT_PORT_REGISTRY_FILENAME = "port-registry.json";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parsePortRegistry = (payload: unknown): Record<string, number> => {
  if (!isRecord(payload)) {
    throw new Error("Port registry must be a JSON object.");
  }

  const version = payload["version"];
  if (version !== 1) {
    throw new Error("Port registry version must be 1.");
  }

  const services = payload["services"];
  if (!isRecord(services)) {
    throw new Error("Port registry services must be an object.");
  }

  const ports: Record<string, number> = {};
  for (const [name, value] of Object.entries(services)) {
    const port = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Port registry entry for '${name}' must be a valid port number.`);
    }
    ports[name] = port;
  }

  return ports;
};

export const resolvePortRegistryPath = (configPath: string) => {
  const override = process.env[PORT_REGISTRY_ENV_VAR];
  if (override) {
    return path.resolve(override);
  }

  return path.join(path.dirname(configPath), DEFAULT_PORT_REGISTRY_FILENAME);
};

type ReadPortRegistryOptions = {
  createIfMissing?: boolean;
};

type EnsureRegistryPortOptions = {
  preferredPort?: number;
  reservedPorts?: Iterable<number>;
  checkAvailability?: (port: number) => Promise<boolean>;
  basePort?: number;
};

type EnsureRegistryPortResult = {
  registryPath: string;
  port: number;
  ports: Record<string, number>;
  created: boolean;
};

const DEFAULT_REGISTRY_PORT = 3100;

const writeEmptyRegistry = async (registryPath: string) => {
  const payload = JSON.stringify({ version: 1, services: {} }, null, 2);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${payload}\n`, "utf-8");
};

const writePortRegistry = async (registryPath: string, ports: Record<string, number>) => {
  const payload = JSON.stringify({ version: 1, services: ports }, null, 2);
  const dir = path.dirname(registryPath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.port-registry.${Date.now()}.tmp`);
  await writeFile(tempPath, `${payload}\n`, "utf-8");
  await rename(tempPath, registryPath);
};

export const readPortRegistry = async (
  configPath: string,
  options: ReadPortRegistryOptions = {}
) => {
  const registryPath = resolvePortRegistryPath(configPath);
  try {
    const raw = await readFile(registryPath, "utf-8");
    const parsed = parsePortRegistry(JSON.parse(raw));
    return { registryPath, ports: parsed };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      if (options.createIfMissing) {
        await writeEmptyRegistry(registryPath);
      }
      return { registryPath, ports: {} };
    }
    throw new Error(
      `Invalid port registry at ${registryPath}: ${err.message ?? "Unknown error"}`
    );
  }
};

const isPortAvailable = (port: number, host = "127.0.0.1") => {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    const finish = (available: boolean) => {
      server.removeAllListeners();
      resolve(available);
    };
    server.once("error", () => finish(false));
    server.once("listening", () => {
      server.close(() => finish(true));
    });
    server.listen(port, host);
  });
};

const normalizePort = (port: number) => {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return undefined;
  }
  return port;
};

const buildReservedPorts = (ports?: Iterable<number>) => {
  const reserved = new Set<number>();
  if (!ports) {
    return reserved;
  }
  for (const port of ports) {
    const normalized = normalizePort(port);
    if (normalized) {
      reserved.add(normalized);
    }
  }
  return reserved;
};

const findNextAvailablePort = async (
  start: number,
  usedPorts: Set<number>,
  checkAvailability: (port: number) => Promise<boolean>
) => {
  const normalizedStart = normalizePort(start) ?? DEFAULT_REGISTRY_PORT;
  for (let port = normalizedStart; port <= 65535; port += 1) {
    if (usedPorts.has(port)) {
      continue;
    }
    if (await checkAvailability(port)) {
      return port;
    }
  }
  throw new Error("No available ports found for port registry.");
};

export const ensureRegistryPort = async (
  configPath: string,
  serviceName: string,
  options: EnsureRegistryPortOptions = {}
): Promise<EnsureRegistryPortResult> => {
  const registry = await readPortRegistry(configPath, { createIfMissing: true });
  const existing = registry.ports[serviceName];
  if (existing) {
    return { registryPath: registry.registryPath, port: existing, ports: registry.ports, created: false };
  }

  const usedPorts = new Set<number>(Object.values(registry.ports));
  const reserved = buildReservedPorts(options.reservedPorts);
  for (const port of reserved) {
    usedPorts.add(port);
  }

  const preferred = normalizePort(options.preferredPort ?? options.basePort ?? DEFAULT_REGISTRY_PORT);
  const assigned = await findNextAvailablePort(
    preferred ?? DEFAULT_REGISTRY_PORT,
    usedPorts,
    options.checkAvailability ?? isPortAvailable
  );
  const nextPorts = { ...registry.ports, [serviceName]: assigned };
  await writePortRegistry(registry.registryPath, nextPorts);
  return { registryPath: registry.registryPath, port: assigned, ports: nextPorts, created: true };
};
