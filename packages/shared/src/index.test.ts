import { describe, expect, it } from "vitest";
import { devServerConfigSchema, devServerServiceSchema, registeredProjectSchema } from "./index.js";

describe("devServerServiceSchema", () => {
  it("accepts valid service", () => {
    const service = devServerServiceSchema.parse({
      name: "api-service_1",
      cwd: "/Users/anton/Code/api",
      command: "pnpm dev",
      env: { NODE_ENV: "development" },
      port: 3000,
      portMode: "static"
    });

    expect(service.name).toBe("api-service_1");
  });

  it("accepts dependsOn list", () => {
    const service = devServerServiceSchema.parse({
      name: "web",
      cwd: "/Users/anton/Code/web",
      command: "pnpm dev",
      dependsOn: ["api", "db"]
    });

    expect(service.dependsOn).toEqual(["api", "db"]);
  });

  it("rejects invalid name", () => {
    const result = devServerServiceSchema.safeParse({
      name: "api service",
      cwd: "/Users/anton/Code/api",
      command: "pnpm dev"
    });

    expect(result.success).toBe(false);
  });

  it("accepts lastStartedAt timestamp", () => {
    const timestamp = new Date().toISOString();
    const service = devServerServiceSchema.parse({
      name: "api-service_1",
      cwd: "/Users/anton/Code/api",
      command: "pnpm dev",
      lastStartedAt: timestamp
    });

    expect(service.lastStartedAt).toBe(timestamp);
  });

  it("accepts valid port mode", () => {
    const service = devServerServiceSchema.parse({
      name: "api-service_2",
      cwd: "/Users/anton/Code/api",
      command: "pnpm dev",
      portMode: "detect"
    });

    expect(service.portMode).toBe("detect");
  });
});

describe("devServerConfigSchema", () => {
  it("accepts empty config", () => {
    const config = devServerConfigSchema.parse({ version: 1, services: [] });
    expect(config.services).toHaveLength(0);
    expect(config.registeredProjects).toEqual([]);
  });
});

describe("registeredProjectSchema", () => {
  it("accepts valid project reference", () => {
    const project = registeredProjectSchema.parse({
      name: "academy",
      path: "/Users/anton/Code/academy",
      isMonorepo: true
    });
    expect(project.name).toBe("academy");
  });

  it("rejects invalid project name", () => {
    const result = registeredProjectSchema.safeParse({
      name: "academy repo",
      path: "/Users/anton/Code/academy"
    });
    expect(result.success).toBe(false);
  });
});
