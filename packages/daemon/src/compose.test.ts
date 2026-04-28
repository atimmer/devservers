import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { ComposeProjectRegistry, parseComposeServices } from "./compose.js";

describe("parseComposeServices", () => {
  it("parses docker-compose style service definitions", () => {
    const services = parseComposeServices(
      {
        name: "academy",
        path: "/tmp/academy",
        isMonorepo: true
      },
      `
services:
  rendement-academy:
    command: "pnpm --filter=rendement-academy dev"
    port-mode: registry
    depends_on:
      - postgres
    env:
      - PORT=$PORT
      - API_URL=http://localhost:\${PORT:api}
  api:
    command: "pnpm --filter=api dev"
    working_dir: "apps/api"
    environment:
      NODE_ENV: development
      PORT: "3000"
`
    );

    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({
      name: "academy_rendement-academy",
      command: "pnpm --filter=rendement-academy dev",
      portMode: "registry",
      dependsOn: ["postgres"],
      env: {
        PORT: "$PORT",
        API_URL: "http://localhost:${PORT:academy_api}"
      },
      cwd: "/tmp/academy",
      projectName: "academy",
      projectIsMonorepo: true
    });
    expect(services[1]).toMatchObject({
      name: "academy_api",
      cwd: "/tmp/academy/apps/api",
      env: {
        NODE_ENV: "development",
        PORT: "3000"
      }
    });
  });

  it("supports command arrays and depends_on map syntax", () => {
    const services = parseComposeServices(
      {
        name: "academy",
        path: "/tmp/academy"
      },
      `
services:
  web:
    command: ["pnpm", "--filter", "web", "dev"]
    depends_on:
      api:
        condition: service_started
  api:
    command: "pnpm --filter api dev"
`
    );

    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({
      name: "academy_web",
      command: "pnpm --filter web dev",
      dependsOn: ["academy_api"]
    });
  });

  it("parses managed env file path for compose services", () => {
    const services = parseComposeServices(
      {
        name: "academy",
        path: "/tmp/academy"
      },
      `
services:
  web:
    command: "pnpm --filter web dev"
    managed-env-file: ".env.local"
`
    );

    expect(services[0]).toMatchObject({
      name: "academy_web",
      managedEnvFile: "/tmp/academy/.env.local"
    });
  });

  it("supports managed env file default path when set to true", () => {
    const services = parseComposeServices(
      {
        name: "academy",
        path: "/tmp/academy"
      },
      `
services:
  web:
    command: "pnpm --filter web dev"
    managedEnvFile: true
`
    );

    expect(services[0]).toMatchObject({
      managedEnvFile: "/tmp/academy/.env"
    });
  });

  it("returns empty list when services key is missing", () => {
    const services = parseComposeServices(
      {
        name: "academy",
        path: "/tmp/academy"
      },
      "name: no-services-here"
    );
    expect(services).toEqual([]);
  });

  it("throws for invalid service definitions", () => {
    expect(() =>
      parseComposeServices(
        {
          name: "academy",
          path: "/tmp/academy"
        },
        `
services:
  api:
    command: "pnpm dev"
    port-mode: wrong
`
      )
    ).toThrow("Invalid port-mode value");
  });

  it("throws for invalid managed env file values", () => {
    expect(() =>
      parseComposeServices(
        {
          name: "academy",
          path: "/tmp/academy"
        },
        `
services:
  api:
    command: "pnpm dev"
    managed-env-file:
      path: ".env"
`
      )
    ).toThrow("managed-env-file must be a string path or true");
  });
});

describe("ComposeProjectRegistry", () => {
  it("refreshes services after the compose file changes", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "devservers-compose-"));
    const composePath = path.join(rootPath, "devservers-compose.yml");
    const registry = new ComposeProjectRegistry();
    const logger = {
      error: () => {}
    };

    try {
      await writeFile(
        composePath,
        `
services:
  web:
    command: "pnpm --filter web dev"
`
      );

      await registry.sync(
        [
          {
            name: "academy",
            path: rootPath
          }
        ],
        logger
      );

      expect(registry.getServices()).toEqual([
        expect.objectContaining({
          name: "academy_web",
          command: "pnpm --filter web dev"
        })
      ]);

      await delay(20);

      await writeFile(
        composePath,
        `
services:
  web:
    command: "pnpm --filter web dev --turbo"
`
      );

      await registry.refresh(logger);

      expect(registry.getServices()).toEqual([
        expect.objectContaining({
          name: "academy_web",
          command: "pnpm --filter web dev --turbo"
        })
      ]);
    } finally {
      registry.close();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
