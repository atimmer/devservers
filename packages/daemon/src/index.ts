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
  collectDependencies,
  collectDependents,
  createDependencyGraph,
  devServerServiceSchema,
  registeredProjectSchema,
  topoSort,
  type DevServerConfig,
  type DevServerService,
  type PortMode,
  type ServiceInfo
} from "@24letters/devservers-shared";
import {
  readConfig,
  removeRegisteredProject,
  removeService,
  resolveConfigPath,
  upsertRegisteredProject,
  upsertService,
  writeConfig
} from "./config.js";
import { ComposeProjectRegistry } from "./compose.js";
import { ensureRegistryPort, readPortRegistry } from "./port-registry.js";
import { resolveRepoInfo } from "./repo.js";
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
const SERVICE_SOURCES = {
  config: "config",
  compose: "compose"
} as const;
type ServiceSource = (typeof SERVICE_SOURCES)[keyof typeof SERVICE_SOURCES];
type ServiceSourceMeta = {
  source: ServiceSource;
  projectName?: string;
  projectIsMonorepo?: boolean;
};

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
const composeProjects = new ComposeProjectRegistry();
const runtimeDetectedPorts = new Map<string, number>();
const runtimeLastStartedAt = new Map<string, string>();

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

server.addHook("onClose", async () => {
  composeProjects.close();
});

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

const findService = (services: DevServerService[], name: string) => {
  return services.find((service) => service.name === name);
};

type ServiceCatalog = {
  config: DevServerConfig;
  services: DevServerService[];
  sources: Map<string, ServiceSourceMeta>;
};

const buildCatalogFromConfig = async (
  config: DevServerConfig,
  logger: Logger
): Promise<ServiceCatalog> => {
  await composeProjects.sync(config.registeredProjects, logger);
  const composeServices = composeProjects.getServices();

  const services: DevServerService[] = [];
  const sources = new Map<string, ServiceSourceMeta>();

  for (const service of config.services) {
    if (sources.has(service.name)) {
      throw new Error(`Duplicate service name: ${service.name}`);
    }
    sources.set(service.name, { source: SERVICE_SOURCES.config });
    services.push(service);
  }

  for (const service of composeServices) {
    if (sources.has(service.name)) {
      throw new Error(`Duplicate service name: ${service.name}`);
    }
    sources.set(service.name, {
      source: SERVICE_SOURCES.compose,
      projectName: service.projectName,
      projectIsMonorepo: service.projectIsMonorepo
    });
    services.push(service);
  }

  return { config, services, sources };
};

const resolveServiceCatalog = async (logger: Logger): Promise<ServiceCatalog> => {
  const config = await readConfig(configPath);
  return await buildCatalogFromConfig(config, logger);
};

const listServices = async (): Promise<ServiceInfo[]> => {
  const catalog = await resolveServiceCatalog(server.log);
  let registryPorts: Record<string, number> = {};
  try {
    const registry = await readPortRegistry(configPath);
    registryPorts = registry.ports;
  } catch (error) {
    server.log.error({ err: error }, "Failed to read port registry");
  }
  const statuses = await Promise.all(
    catalog.services.map(async (service) => {
      const meta = catalog.sources.get(service.name);
      const runtimeLastStarted = runtimeLastStartedAt.get(service.name);
      return {
        ...service,
        lastStartedAt: service.lastStartedAt ?? runtimeLastStarted,
        repo: await resolveRepoInfo(service.cwd),
        port: resolveServicePort(service, registryPorts),
        source: meta?.source,
        projectName: meta?.projectName,
        projectIsMonorepo: meta?.projectIsMonorepo,
        status: await getServiceStatus(service)
      } satisfies ServiceInfo;
    })
  );
  const liveNames = new Set(statuses.map((service) => service.name));
  for (const name of runtimeDetectedPorts.keys()) {
    if (!liveNames.has(name)) {
      runtimeDetectedPorts.delete(name);
    }
  }
  for (const name of runtimeLastStartedAt.keys()) {
    if (!liveNames.has(name)) {
      runtimeLastStartedAt.delete(name);
    }
  }
  return orderServices(statuses);
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
  if (portMode === "detect") {
    return runtimeDetectedPorts.get(service.name) ?? service.port;
  }
  return service.port;
};

const collectReservedPorts = (services: DevServerService[], currentName: string) => {
  const reserved = new Set<number>();
  for (const service of services) {
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

type Logger = { error: (data: Record<string, unknown>, message: string) => void };

const resolveSourceMeta = (
  sources: Map<string, ServiceSourceMeta>,
  serviceName: string
): ServiceSourceMeta => {
  return sources.get(serviceName) ?? { source: SERVICE_SOURCES.config };
};

const isComposeManagedService = (
  sources: Map<string, ServiceSourceMeta>,
  serviceName: string
) => {
  return resolveSourceMeta(sources, serviceName).source === SERVICE_SOURCES.compose;
};

const persistDetectedPort = async (
  service: DevServerService,
  port: number,
  sourceMeta: ServiceSourceMeta
) => {
  runtimeDetectedPorts.set(service.name, port);
  if (sourceMeta.source !== SERVICE_SOURCES.config) {
    return;
  }
  const config = await readConfig(configPath);
  const current = findService(config.services, service.name);
  if (!current || current.port === port) {
    return;
  }
  const nextConfig = upsertService(config, { ...current, port });
  await writeConfig(configPath, nextConfig);
};

const updateLastStartedAt = async (
  service: DevServerService,
  lastStartedAt: string,
  sourceMeta: ServiceSourceMeta
) => {
  runtimeLastStartedAt.set(service.name, lastStartedAt);
  if (sourceMeta.source !== SERVICE_SOURCES.config) {
    return;
  }
  const config = await readConfig(configPath);
  const current = findService(config.services, service.name);
  if (!current) {
    return;
  }
  const nextConfig = upsertService(config, { ...current, lastStartedAt });
  await writeConfig(configPath, nextConfig);
};

const isValidPort = (value: number | undefined): value is number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 65535;
};

const resolveServicePorts = async (
  services: DevServerService[],
  logger: Logger,
  overrides: Record<string, number | undefined> = {}
) => {
  let registryPorts: Record<string, number> = {};
  try {
    const registry = await readPortRegistry(configPath);
    registryPorts = registry.ports;
  } catch (error) {
    logger.error({ err: error }, "Failed to read port registry");
  }

  const resolved: Record<string, number | undefined> = {};
  for (const item of services) {
    resolved[item.name] = resolveServicePort(item, registryPorts);
  }

  for (const [name, port] of Object.entries(overrides)) {
    if (isValidPort(port)) {
      resolved[name] = port;
    }
  }

  return resolved;
};

const resolveStartSettings = async (
  services: DevServerService[],
  service: DevServerService,
  logger: Logger
) => {
  const portMode = resolvePortMode(service);
  let resolvedPort: number | undefined;
  if (portMode === "registry") {
    try {
      const reservedPorts = collectReservedPorts(services, service.name);
      const registry = await ensureRegistryPort(configPath, service.name, {
        preferredPort: service.port,
        reservedPorts
      });
      resolvedPort = registry.port;
    } catch (error) {
      logger.error({ err: error }, "Failed to read port registry");
      throw new Error("failed to read port registry");
    }
  } else {
    resolvedPort = service.port;
  }

  const baseline =
    portMode === "detect" ? await capturePane(service.name, PORT_LOG_LINES) : "";

  return { portMode, resolvedPort, baseline };
};

const schedulePortDetection = (
  sources: Map<string, ServiceSourceMeta>,
  service: DevServerService,
  baseline: string,
  logger: Logger
) => {
  void (async () => {
    try {
      const detectedPort = await detectPortFromLogs(service, baseline);
      if (detectedPort) {
        const sourceMeta = resolveSourceMeta(sources, service.name);
        await persistDetectedPort(service, detectedPort, sourceMeta);
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to detect service port");
    }
  })();
};

const startServiceWindow = async (
  services: DevServerService[],
  sources: Map<string, ServiceSourceMeta>,
  service: DevServerService,
  logger: Logger
) => {
  const sourceMeta = resolveSourceMeta(sources, service.name);
  const { portMode, resolvedPort, baseline } = await resolveStartSettings(
    services,
    service,
    logger
  );
  const servicePorts = await resolveServicePorts(services, logger, {
    [service.name]: resolvedPort
  });
  const started = await startWindow(service, { resolvedPort, servicePorts });
  if (started) {
    await updateLastStartedAt(service, new Date().toISOString(), sourceMeta);
    if (portMode === "detect") {
      schedulePortDetection(sources, service, baseline, logger);
    }
  }
};

const restartServiceWindow = async (
  services: DevServerService[],
  sources: Map<string, ServiceSourceMeta>,
  service: DevServerService,
  logger: Logger
) => {
  const sourceMeta = resolveSourceMeta(sources, service.name);
  const { portMode, resolvedPort, baseline } = await resolveStartSettings(
    services,
    service,
    logger
  );
  const servicePorts = await resolveServicePorts(services, logger, {
    [service.name]: resolvedPort
  });
  const started = await restartWindow(service, { resolvedPort, servicePorts });
  if (started) {
    await updateLastStartedAt(service, new Date().toISOString(), sourceMeta);
    if (portMode === "detect") {
      schedulePortDetection(sources, service, baseline, logger);
    }
  }
};

server.get("/projects", async () => {
  const config = await readConfig(configPath);
  return { projects: config.registeredProjects };
});

server.post("/projects", async (request, reply) => {
  const parsed = registeredProjectSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  const config = await readConfig(configPath);
  const nextConfig = upsertRegisteredProject(config, parsed.data);
  await writeConfig(configPath, nextConfig);
  await composeProjects.sync(nextConfig.registeredProjects, request.log);
  return { ok: true };
});

server.delete("/projects/:name", async (request) => {
  const params = request.params as { name: string };
  const config = await readConfig(configPath);
  const nextConfig = removeRegisteredProject(config, params.name);
  await writeConfig(configPath, nextConfig);
  await composeProjects.sync(nextConfig.registeredProjects, request.log);
  return { ok: true };
});

server.get("/services", async () => ({ services: await listServices() }));

server.get("/services/:name/config", async (request, reply) => {
  const params = request.params as { name: string };
  let catalog: ServiceCatalog;
  try {
    catalog = await resolveServiceCatalog(request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }

  const service = findService(catalog.services, params.name);
  if (!service) {
    return reply.code(404).send({ error: "service not found" });
  }

  const sourceMeta = resolveSourceMeta(catalog.sources, params.name);
  if (sourceMeta.source === SERVICE_SOURCES.compose) {
    const definition = composeProjects.getServiceDefinition(params.name);
    if (!definition) {
      return reply.code(404).send({ error: "service definition not found" });
    }
    return {
      source: SERVICE_SOURCES.compose,
      serviceName: params.name,
      projectName: definition.projectName,
      path: definition.composePath,
      definition: definition.sourceDefinition
    };
  }

  const configService = findService(catalog.config.services, params.name);
  if (!configService) {
    return reply.code(404).send({ error: "service definition not found" });
  }
  return {
    source: SERVICE_SOURCES.config,
    serviceName: params.name,
    path: configPath,
    definition: configService
  };
});

server.post("/services", async (request, reply) => {
  const parsed = devServerServiceSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const config = await readConfig(configPath);
  let currentCatalog: ServiceCatalog;
  try {
    currentCatalog = await buildCatalogFromConfig(config, request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }

  if (isComposeManagedService(currentCatalog.sources, parsed.data.name)) {
    return reply
      .code(400)
      .send({ error: "service is managed by devservers-compose.yml and cannot be edited here" });
  }

  const nextConfig = upsertService(config, parsed.data);
  try {
    const nextCatalog = await buildCatalogFromConfig(nextConfig, request.log);
    createDependencyGraph(nextCatalog.services);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }

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
  let currentCatalog: ServiceCatalog;
  try {
    currentCatalog = await buildCatalogFromConfig(config, request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }

  if (isComposeManagedService(currentCatalog.sources, params.name)) {
    return reply
      .code(400)
      .send({ error: "service is managed by devservers-compose.yml and cannot be edited here" });
  }

  const nextConfig = upsertService(config, parsed.data);
  try {
    const nextCatalog = await buildCatalogFromConfig(nextConfig, request.log);
    createDependencyGraph(nextCatalog.services);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }
  await writeConfig(configPath, nextConfig);
  return { ok: true };
});

server.delete("/services/:name", async (request, reply) => {
  const params = request.params as { name: string };
  const config = await readConfig(configPath);
  let catalog: ServiceCatalog;
  try {
    catalog = await buildCatalogFromConfig(config, request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }

  if (isComposeManagedService(catalog.sources, params.name)) {
    return reply
      .code(400)
      .send({ error: "service is managed by devservers-compose.yml and cannot be edited here" });
  }

  const nextConfig = removeService(config, params.name);
  await writeConfig(configPath, nextConfig);
  runtimeDetectedPorts.delete(params.name);
  runtimeLastStartedAt.delete(params.name);
  return { ok: true };
});

server.post("/services/:name/start", async (request, reply) => {
  const params = request.params as { name: string };
  let catalog: ServiceCatalog;
  try {
    catalog = await resolveServiceCatalog(request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }
  const service = findService(catalog.services, params.name);
  if (!service) {
    return reply.code(404).send({ error: "service not found" });
  }
  let graph;
  try {
    graph = createDependencyGraph(catalog.services);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }

  const order = topoSort(graph, collectDependencies(graph, service.name));
  try {
    for (const name of order) {
      const target = graph.servicesByName.get(name);
      if (target) {
        await startServiceWindow(catalog.services, catalog.sources, target, request.log);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to start service";
    return reply.code(500).send({ error: message });
  }
  return { ok: true };
});

server.post("/services/:name/stop", async (request, reply) => {
  const params = request.params as { name: string };
  let catalog: ServiceCatalog;
  try {
    catalog = await resolveServiceCatalog(request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }
  const service = findService(catalog.services, params.name);
  if (!service) {
    return reply.code(404).send({ error: "service not found" });
  }
  let graph;
  try {
    graph = createDependencyGraph(catalog.services);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }
  const order = topoSort(graph, collectDependents(graph, service.name)).reverse();
  for (const name of order) {
    await stopWindow(name);
  }
  return { ok: true };
});

server.post("/services/:name/restart", async (request, reply) => {
  const params = request.params as { name: string };
  let catalog: ServiceCatalog;
  try {
    catalog = await resolveServiceCatalog(request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }
  const service = findService(catalog.services, params.name);
  if (!service) {
    return reply.code(404).send({ error: "service not found" });
  }
  let graph;
  try {
    graph = createDependencyGraph(catalog.services);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid dependencies";
    return reply.code(400).send({ error: message });
  }
  const dependencies = collectDependencies(graph, service.name).filter(
    (name) => name !== service.name
  );
  const order = topoSort(graph, dependencies);
  try {
    for (const name of order) {
      const target = graph.servicesByName.get(name);
      if (target) {
        await startServiceWindow(catalog.services, catalog.sources, target, request.log);
      }
    }
    await restartServiceWindow(catalog.services, catalog.sources, service, request.log);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to restart service";
    return reply.code(500).send({ error: message });
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
  try {
    await resolveServiceCatalog(server.log);
  } catch (error) {
    server.log.error({ err: error }, "Failed to load services on startup");
  }
  await server.listen({ port, host: "127.0.0.1" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
