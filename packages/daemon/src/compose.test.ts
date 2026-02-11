import { describe, expect, it } from "vitest";
import { parseComposeServices } from "./compose.js";

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
      name: "rendement-academy",
      command: "pnpm --filter=rendement-academy dev",
      portMode: "registry",
      dependsOn: ["postgres"],
      env: {
        PORT: "$PORT",
        API_URL: "http://localhost:${PORT:api}"
      },
      cwd: "/tmp/academy",
      projectName: "academy",
      projectIsMonorepo: true
    });
    expect(services[1]).toMatchObject({
      name: "api",
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
      name: "web",
      command: "pnpm --filter web dev",
      dependsOn: ["api"]
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
});
