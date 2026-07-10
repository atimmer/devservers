import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyError } from "fastify";
import { DAEMON_PORT } from "@24letters/devservers-shared";
import { resolveConfigPath } from "./config.js";
import { ComposeProjectRegistry } from "./compose.js";
import { registerRoutes } from "./routes.js";
import { createServiceManager } from "./service-manager.js";

const getArgValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
};

const configPath = resolveConfigPath(getArgValue("--config"));
const port = Number(getArgValue("--port") ?? DAEMON_PORT);

const logger = process.stdout.isTTY
  ? {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "HH:MM:ss"
        }
      }
    }
  : true;

const server = Fastify({ logger });
const composeProjects = new ComposeProjectRegistry();
const manager = createServiceManager(configPath, composeProjects, server.log);

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

registerRoutes(server, { configPath, composeProjects, manager });

try {
  try {
    await manager.resolveServiceCatalog(server.log);
  } catch (error) {
    server.log.error({ err: error }, "Failed to load services on startup");
  }
  await server.listen({ port, host: "127.0.0.1" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
