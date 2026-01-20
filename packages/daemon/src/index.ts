import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyError } from "fastify";
import {
  DAEMON_PORT,
  devServerServiceSchema,
  type DevServerConfig,
  type DevServerService,
  type PortMode,
  type ServiceInfo
} from "@24letters/devservers-shared";
import { readConfig, removeService, resolveConfigPath, upsertService, writeConfig } from "./config.js";
import { ensureRegistryPort, readPortRegistry } from "./port-registry.js";
import {
  capturePane,
  getServiceStatus,
  restartWindow,
  startWindow,
  stopWindow
} from "./tmux.js";

const DEFAULT_PORT_MODE: PortMode = "static";
const PORT_LOG_LINES = 200;
const PORT_DETECT_POLL_MS = 500;
const PORT_DETECT_TIMEOUT_MS = 15000;
const PORT_REGEX = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/gi;

const getArgValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
};

const configPath = resolveConfigPath(getArgValue("--config"));
const port = Number(getArgValue("--port") ?? DAEMON_PORT);

const server = Fastify({ logger: true });

server.setErrorHandler((error: FastifyError, request, reply) => {
  request.log.error({ err: error }, "Request failed");
  if (reply.sent) {
    return;
  }
  const statusCode =
    typeof error.statusCode === "number" && Number.isFinite(error.statusCode)
      ? error.statusCode
      : 500;
  reply.code(statusCode).send({
    error: statusCode === 500 ? "internal server error" : error.message
  });
});

await server.register(cors, {
  origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/\[::1\]:\d+$/],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
});

await server.register(websocket);

const uiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");
if (existsSync(uiRoot)) {
  await server.register(fastifyStatic, {
    root: uiRoot,
    prefix: "/ui/"
  });

  server.get("/", async (_request, reply) => {
    return reply.redirect("/ui/");
  });
}

const listServices = async (): Promise<ServiceInfo[]> => {
  const config = await readConfig(configPath);
  let registryPorts: Record<string, number> = {};
  try {
    const registry = await readPortRegistry(configPath);
    registryPorts = registry.ports;
  } catch (error) {
    server.log.error({ err: error }, "Failed to read port registry");
  }
  const statuses = await Promise.all(
    config.services.map(async (service) => ({
      ...service,
      port:
        resolvePortMode(service) === "registry"
          ? resolveServicePort(service, registryPorts)
          : service.port,
      status: await getServiceStatus(service)
    }))
  );
  return orderServices(statuses);
};

const findService = (services: DevServerService[], name: string) => {
  return services.find((service) => service.name === name);
};

const orderServices = (services: ServiceInfo[]) => {
  const scored = services.map((service, index) => ({ service, index }));
  const scoreLastStartedAt = (service: ServiceInfo) => {
    if (!service.lastStartedAt) {
      return 0;
    }
    const parsed = Date.parse(service.lastStartedAt);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  scored.sort((left, right) => {
    const leftRunning = left.service.status === "running";
    const rightRunning = right.service.status === "running";
    if (leftRunning !== rightRunning) {
      return leftRunning ? -1 : 1;
    }

    if (!leftRunning) {
      const timeDelta = scoreLastStartedAt(right.service) - scoreLastStartedAt(left.service);
      if (timeDelta !== 0) {
        return timeDelta;
      }
    }

    return left.index - right.index;
  });

  return scored.map(({ service }) => service);
};

const resolvePortMode = (service: DevServerService): PortMode => {
  return service.portMode ?? DEFAULT_PORT_MODE;
};

const resolveServicePort = (
  service: DevServerService,
  registryPorts: Record<string, number>
) => {
  const portMode = resolvePortMode(service);
  if (portMode === "registry") {
    return registryPorts[service.name];
  }
  return service.port;
};

const collectReservedPorts = (config: DevServerConfig, currentName: string) => {
  const reserved = new Set<number>();
  for (const service of config.services) {
    if (service.name === currentName) {
      continue;
    }
    if (typeof service.port === "number" && Number.isFinite(service.port)) {
      reserved.add(service.port);
    }
  }
  return reserved;
};

const extractPortFromLogs = (logs: string): number | undefined => {
  if (!logs) {
    return undefined;
  }

  let latest: number | undefined;
  const lines = logs.split("\n");
  for (const line of lines) {
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

const detectPortFromLogs = async (service: DevServerService, baseline: string) => {
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

const persistDetectedPort = async (service: DevServerService, port: number) => {
  const config = await readConfig(configPath);
  const current = findService(config.services, service.name);
  if (!current) {
    return;
  }
  if (current.port === port) {
    return;
  }
  const nextConfig = upsertService(config, { ...current, port });
  await writeConfig(configPath, nextConfig);
};

const updateLastStartedAt = async (
  config: DevServerConfig,
  service: DevServerService,
  lastStartedAt: string
) => {
  const nextConfig = upsertService(config, { ...service, lastStartedAt });
  await writeConfig(configPath, nextConfig);
};

server.get("/services", async () => ({ services: await listServices() }));

server.post("/services", async (request, reply) => {
  const parsed = devServerServiceSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const config = await readConfig(configPath);
  const nextConfig = upsertService(config, parsed.data);
  await writeConfig(configPath, nextConfig);
  return { ok: true };
});

server.put("/services/:name", async (request, reply) => {
  const parsed = devServerServiceSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const params = request.params as { name: string };
  if (parsed.data.name !== params.name) {
    return reply.code(400).send({ error: "name must match route param" });
  }

  const config = await readConfig(configPath);
  const nextConfig = upsertService(config, parsed.data);
  await writeConfig(configPath, nextConfig);
  return { ok: true };
});

server.delete("/services/:name", async (request) => {
  const params = request.params as { name: string };
  const config = await readConfig(configPath);
  const nextConfig = removeService(config, params.name);
  await writeConfig(configPath, nextConfig);
  return { ok: true };
});

server.post("/services/:name/start", async (request, reply) => {
  const params = request.params as { name: string };
  const config = await readConfig(configPath);
  const service = findService(config.services, params.name);
  if (!service) {
    return reply.code(404).send({ error: "service not found" });
  }
  const portMode = resolvePortMode(service);
  let resolvedPort: number | undefined;
  if (portMode === "registry") {
    try {
      const reservedPorts = collectReservedPorts(config, service.name);
      const registry = await ensureRegistryPort(configPath, service.name, {
        preferredPort: service.port,
        reservedPorts
      });
      resolvedPort = registry.port;
    } catch (error) {
      request.log.error({ err: error }, "Failed to read port registry");
      return reply.code(500).send({ error: "failed to read port registry" });
    }
  } else {
    resolvedPort = service.port;
  }
  const baseline =
    portMode === "detect" ? await capturePane(service.name, PORT_LOG_LINES) : "";
  const started = await startWindow(service, { resolvedPort });
  if (started) {
    await updateLastStartedAt(config, service, new Date().toISOString());
    if (portMode === "detect") {
      void (async () => {
        try {
          const detectedPort = await detectPortFromLogs(service, baseline);
          if (detectedPort) {
            await persistDetectedPort(service, detectedPort);
          }
        } catch (error) {
          request.log.error({ err: error }, "Failed to detect service port");
        }
      })();
    }
  }
  return { ok: true };
});

server.post("/services/:name/stop", async (request, reply) => {
  const params = request.params as { name: string };
  const config = await readConfig(configPath);
  const service = findService(config.services, params.name);
  if (!service) {
    return reply.code(404).send({ error: "service not found" });
  }
  await stopWindow(service.name);
  return { ok: true };
});

server.post("/services/:name/restart", async (request, reply) => {
  const params = request.params as { name: string };
  const config = await readConfig(configPath);
  const service = findService(config.services, params.name);
  if (!service) {
    return reply.code(404).send({ error: "service not found" });
  }
  const portMode = resolvePortMode(service);
  let resolvedPort: number | undefined;
  if (portMode === "registry") {
    try {
      const reservedPorts = collectReservedPorts(config, service.name);
      const registry = await ensureRegistryPort(configPath, service.name, {
        preferredPort: service.port,
        reservedPorts
      });
      resolvedPort = registry.port;
    } catch (error) {
      request.log.error({ err: error }, "Failed to read port registry");
      return reply.code(500).send({ error: "failed to read port registry" });
    }
  } else {
    resolvedPort = service.port;
  }
  const baseline =
    portMode === "detect" ? await capturePane(service.name, PORT_LOG_LINES) : "";
  const started = await restartWindow(service, { resolvedPort });
  if (started) {
    await updateLastStartedAt(config, service, new Date().toISOString());
    if (portMode === "detect") {
      void (async () => {
        try {
          const detectedPort = await detectPortFromLogs(service, baseline);
          if (detectedPort) {
            await persistDetectedPort(service, detectedPort);
          }
        } catch (error) {
          request.log.error({ err: error }, "Failed to detect service port");
        }
      })();
    }
  }
  return { ok: true };
});

server.get("/services/:name/logs", { websocket: true }, (connection, request) => {
  const params = request.params as { name: string };
  const query = request.query as { lines?: string; ansi?: string };
  const requestedLines = Number(query?.lines);
  const lines =
    Number.isFinite(requestedLines) && requestedLines > 0 ? Math.trunc(requestedLines) : 200;
  const ansi = query?.ansi === "1" || query?.ansi === "true";
  let closed = false;

  const socket =
    typeof (connection as { send?: unknown })?.send === "function"
      ? (connection as {
          send: (data: string) => void;
          on: (event: string, handler: (...args: unknown[]) => void) => void;
        })
      : (connection as {
          socket?: {
            send: (data: string) => void;
            on: (event: string, handler: (...args: unknown[]) => void) => void;
          };
        })?.socket;

  if (!socket) {
    request.log.error("Logs websocket missing socket handle");
    return;
  }

  const sendLogs = async () => {
    if (closed) {
      return;
    }
    try {
      const payload = await capturePane(params.name, lines, { ansi });
      socket.send(JSON.stringify({ type: "logs", payload }));
    } catch (error) {
      request.log.error({ err: error }, "Failed to capture logs");
    }
  };

  const interval = setInterval(() => {
    void sendLogs();
  }, 1000);
  void sendLogs();

  socket.on("error", (error) => {
    request.log.error({ err: error }, "Logs websocket error");
  });

  socket.on("close", () => {
    closed = true;
    clearInterval(interval);
  });
});

try {
  await server.listen({ port, host: "127.0.0.1" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
