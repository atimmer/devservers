import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  DAEMON_PORT,
  devServerServiceSchema,
  type DevServerConfig,
  type DevServerService,
  type ServiceInfo
} from "@atimmer/devservers-shared";
import { readConfig, removeService, resolveConfigPath, upsertService, writeConfig } from "./config.js";
import {
  capturePane,
  getServiceStatus,
  restartWindow,
  startWindow,
  stopWindow
} from "./tmux.js";

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

await server.register(cors, {
  origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/\[::1\]:\d+$/]
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
  const statuses = await Promise.all(
    config.services.map(async (service) => ({
      ...service,
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
  const started = await startWindow(service);
  if (started) {
    await updateLastStartedAt(config, service, new Date().toISOString());
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
  const started = await restartWindow(service);
  if (started) {
    await updateLastStartedAt(config, service, new Date().toISOString());
  }
  return { ok: true };
});

server.get("/services/:name/logs", { websocket: true }, (connection, request) => {
  const params = request.params as { name: string };
  const query = request.query as { lines?: string };
  const lines = Number(query?.lines ?? 200);
  let closed = false;

  const sendLogs = async () => {
    if (closed) {
      return;
    }
    const payload = await capturePane(params.name, lines);
    connection.socket.send(JSON.stringify({ type: "logs", payload }));
  };

  const interval = setInterval(sendLogs, 1000);
  sendLogs().catch(() => undefined);

  connection.socket.on("close", () => {
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
