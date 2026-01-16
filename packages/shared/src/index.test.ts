import { describe, expect, it } from "vitest";
import { devServerConfigSchema, devServerServiceSchema } from "./index";

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
  });
});
