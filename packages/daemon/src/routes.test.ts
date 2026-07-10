import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComposeProjectRegistry } from "./compose.js";
import { registerRoutes } from "./routes.js";
import { createServiceManager } from "./service-manager.js";

describe("daemon routes", () => {
  let tempDir: string;
  let configPath: string;
  let server: FastifyInstance;
  let composeProjects: ComposeProjectRegistry;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "devservers-routes-"));
    configPath = path.join(tempDir, "devservers.json");
    server = Fastify({ logger: false });
    composeProjects = new ComposeProjectRegistry();
    const manager = createServiceManager(configPath, composeProjects, server.log);
    await server.register(websocket);
    registerRoutes(server, { configPath, composeProjects, manager });
  });

  afterEach(async () => {
    await server.close();
    composeProjects.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("lists services through the manager boundary", async () => {
    const response = await server.inject({ method: "GET", url: "/services" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ services: [] });
  });

  it("persists a valid service through the route boundary", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/services",
      payload: {
        name: "route-test-service",
        cwd: tempDir,
        command: "pnpm test"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      services: Array<{ name: string }>;
    };
    expect(config.services.map((service) => service.name)).toEqual(["route-test-service"]);
  });

  it("rejects deleting an unknown service", async () => {
    const response = await server.inject({
      method: "DELETE",
      url: "/services/missing"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "service not found" });
  });
});
