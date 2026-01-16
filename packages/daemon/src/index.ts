import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  DAEMON_PORT,
  devServerServiceSchema,
  type DevServerService,
  type ServiceInfo
} from "@webserver-manager/shared";
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
  origin: [/^http:\/\/localhost:\d+$/]
});

await server.register(websocket);

const listServices = async (): Promise<ServiceInfo[]> => {
  const config = await readConfig(configPath);
  const statuses = await Promise.all(
    config.services.map(async (service) => ({
      ...service,
      status: await getServiceStatus(service)
    }))
  );
  return statuses;
};

const findService = (services: DevServerService[], name: string) => {
  return services.find((service) => service.name === name);
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
  await startWindow(service);
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
  await restartWindow(service);
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
