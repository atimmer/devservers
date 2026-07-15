import type { FastifyInstance } from "fastify";
import {
  collectDependencies,
  collectDependents,
  createDependencyGraph,
  devServerServiceSchema,
  registeredProjectSchema,
  topoSort,
  type ServiceActionResult
} from "@24letters/devservers-shared";
import {
  removeRegisteredProject,
  removeService,
  upsertRegisteredProject,
  upsertService,
  writeConfig
} from "./config.js";
import type { ComposeProjectRegistry } from "./compose.js";
import {
  findService,
  SERVICE_SOURCES,
  type ServiceCatalog,
  type ServiceManager
} from "./service-manager.js";
import { normalizeLogLines } from "./service-runtime.js";
import { capturePane, stopWindow } from "./tmux.js";

type RouteDependencies = {
  configPath: string;
  composeProjects: ComposeProjectRegistry;
  manager: ServiceManager;
};

const errorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback;
};

const serviceActionResult = (
  action: ServiceActionResult["action"],
  target: string,
  affected: string[]
): ServiceActionResult => ({ ok: true, action, target, affected });

export const registerRoutes = (
  server: FastifyInstance,
  { configPath, composeProjects, manager }: RouteDependencies
) => {
  server.get("/projects", async () => {
    const config = await manager.readConfigWithPrunedProjects(server.log);
    return { projects: config.registeredProjects };
  });

  server.post("/projects", async (request, reply) => {
    const parsed = registeredProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const config = await manager.readConfigWithPrunedProjects(request.log);
    const nextConfig = upsertRegisteredProject(config, parsed.data);
    await writeConfig(configPath, nextConfig);
    await composeProjects.sync(nextConfig.registeredProjects, request.log);
    return { ok: true };
  });

  server.delete("/projects/:name", async (request) => {
    const params = request.params as { name: string };
    const config = await manager.readConfigWithPrunedProjects(request.log);
    const nextConfig = removeRegisteredProject(config, params.name);
    await writeConfig(configPath, nextConfig);
    await composeProjects.sync(nextConfig.registeredProjects, request.log);
    await manager.stopServicesForProjects([params.name], request.log);
    return { ok: true };
  });

  server.get("/services", async () => ({ services: await manager.listServices() }));

  server.get("/services/:name/config", async (request, reply) => {
    const params = request.params as { name: string };
    let catalog: ServiceCatalog;
    try {
      catalog = await manager.resolveServiceCatalog(request.log);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }

    const service = findService(catalog.services, params.name);
    if (!service) {
      return reply.code(404).send({ error: "service not found" });
    }

    const sourceMeta = manager.resolveSourceMeta(catalog.sources, params.name);
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

    const config = await manager.readConfigWithPrunedProjects(request.log);
    let currentCatalog: ServiceCatalog;
    try {
      currentCatalog = await manager.buildCatalogFromConfig(config, request.log);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }

    if (manager.isComposeManagedService(currentCatalog.sources, parsed.data.name)) {
      return reply
        .code(400)
        .send({ error: "service is managed by devservers-compose.yml and cannot be edited here" });
    }

    const nextConfig = upsertService(config, parsed.data);
    try {
      const nextCatalog = await manager.buildCatalogFromConfig(nextConfig, request.log);
      createDependencyGraph(nextCatalog.services);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
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

    const config = await manager.readConfigWithPrunedProjects(request.log);
    let currentCatalog: ServiceCatalog;
    try {
      currentCatalog = await manager.buildCatalogFromConfig(config, request.log);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }

    if (manager.isComposeManagedService(currentCatalog.sources, params.name)) {
      return reply
        .code(400)
        .send({ error: "service is managed by devservers-compose.yml and cannot be edited here" });
    }

    const nextConfig = upsertService(config, parsed.data);
    try {
      const nextCatalog = await manager.buildCatalogFromConfig(nextConfig, request.log);
      createDependencyGraph(nextCatalog.services);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }
    await writeConfig(configPath, nextConfig);
    return { ok: true };
  });

  server.delete("/services/:name", async (request, reply) => {
    const params = request.params as { name: string };
    const config = await manager.readConfigWithPrunedProjects(request.log);
    let catalog: ServiceCatalog;
    try {
      catalog = await manager.buildCatalogFromConfig(config, request.log);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }

    if (manager.isComposeManagedService(catalog.sources, params.name)) {
      return reply
        .code(400)
        .send({ error: "service is managed by devservers-compose.yml and cannot be edited here" });
    }

    const service = findService(catalog.config.services, params.name);
    if (!service) {
      return reply.code(404).send({ error: "service not found" });
    }

    const nextConfig = removeService(config, params.name);
    try {
      const nextCatalog = await manager.buildCatalogFromConfig(nextConfig, request.log);
      createDependencyGraph(nextCatalog.services);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }
    await stopWindow(params.name);
    await writeConfig(configPath, nextConfig);
    manager.clearRuntimeState(params.name);
    return serviceActionResult("delete", params.name, [params.name]);
  });

  server.post("/services/:name/start", async (request, reply) => {
    const params = request.params as { name: string };
    let catalog: ServiceCatalog;
    try {
      catalog = await manager.resolveServiceCatalog(request.log);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }
    const service = findService(catalog.services, params.name);
    if (!service) {
      return reply.code(404).send({ error: "service not found" });
    }
    let graph;
    try {
      graph = createDependencyGraph(catalog.services);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }

    const order = topoSort(graph, collectDependencies(graph, service.name));
    const affected: string[] = [];
    try {
      for (const name of order) {
        const target = graph.servicesByName.get(name);
        if (
          target &&
          (await manager.startServiceWindow(
            catalog.services,
            catalog.sources,
            target,
            request.log
          ))
        ) {
          affected.push(name);
        }
      }
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error, "failed to start service") });
    }
    return serviceActionResult("start", service.name, affected);
  });

  server.post("/services/:name/stop", async (request, reply) => {
    const params = request.params as { name: string };
    let catalog: ServiceCatalog;
    try {
      catalog = await manager.resolveServiceCatalog(request.log);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }
    const service = findService(catalog.services, params.name);
    if (!service) {
      return reply.code(404).send({ error: "service not found" });
    }
    let graph;
    try {
      graph = createDependencyGraph(catalog.services);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }
    const order = topoSort(graph, collectDependents(graph, service.name)).reverse();
    const affected: string[] = [];
    for (const name of order) {
      if (await stopWindow(name)) {
        affected.push(name);
      }
    }
    return serviceActionResult("stop", service.name, affected);
  });

  server.post("/services/:name/restart", async (request, reply) => {
    const params = request.params as { name: string };
    let catalog: ServiceCatalog;
    try {
      catalog = await manager.resolveServiceCatalog(request.log);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }
    const service = findService(catalog.services, params.name);
    if (!service) {
      return reply.code(404).send({ error: "service not found" });
    }
    let graph;
    try {
      graph = createDependencyGraph(catalog.services);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error, "invalid dependencies") });
    }
    const dependencies = collectDependencies(graph, service.name).filter(
      (name) => name !== service.name
    );
    const order = topoSort(graph, dependencies);
    const affected: string[] = [];
    try {
      for (const name of order) {
        const target = graph.servicesByName.get(name);
        if (
          target &&
          (await manager.startServiceWindow(
            catalog.services,
            catalog.sources,
            target,
            request.log
          ))
        ) {
          affected.push(name);
        }
      }
      if (
        await manager.restartServiceWindow(
          catalog.services,
          catalog.sources,
          service,
          request.log
        )
      ) {
        affected.push(service.name);
      }
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error, "failed to restart service") });
    }
    return serviceActionResult("restart", service.name, affected);
  });

  server.get("/services/:name/logs/snapshot", async (request, reply) => {
    const params = request.params as { name: string };
    const query = request.query as { lines?: string; ansi?: string };
    const service = (await manager.listServices()).find((entry) => entry.name === params.name);
    if (!service) {
      return reply.code(404).send({ error: "service not found" });
    }

    const logs = await capturePane(params.name, normalizeLogLines(query?.lines), {
      ansi: query?.ansi === "1" || query?.ansi === "true"
    });
    return { service: params.name, status: service.status, logs };
  });

  server.get("/services/:name/logs", { websocket: true }, (connection, request) => {
    const params = request.params as { name: string };
    const query = request.query as { lines?: string; ansi?: string };
    const lines = normalizeLogLines(query?.lines);
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
};
