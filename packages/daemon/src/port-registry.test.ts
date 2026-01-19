import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureRegistryPort, readPortRegistry, resolvePortRegistryPath } from "./port-registry.js";

const createTempDir = async () => {
  return await mkdtemp(path.join(tmpdir(), "devservers-registry-"));
};

describe("port registry", () => {
  let previousEnv: string | undefined;

  beforeEach(() => {
    previousEnv = process.env["DEVSERVER_PORT_REGISTRY"];
    delete process.env["DEVSERVER_PORT_REGISTRY"];
  });

  afterEach(() => {
    if (previousEnv) {
      process.env["DEVSERVER_PORT_REGISTRY"] = previousEnv;
    } else {
      delete process.env["DEVSERVER_PORT_REGISTRY"];
    }
  });

  it("resolves default registry path relative to config", () => {
    const configPath = "/tmp/devservers.json";
    expect(resolvePortRegistryPath(configPath)).toBe("/tmp/port-registry.json");
  });

  it("returns empty ports when registry is missing", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "devservers.json");
    const registry = await readPortRegistry(configPath);
    expect(registry.ports).toEqual({});
  });

  it("creates an empty registry file when requested", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "devservers.json");
    const registryPath = resolvePortRegistryPath(configPath);
    const registry = await readPortRegistry(configPath, { createIfMissing: true });
    expect(registry.ports).toEqual({});
    const raw = await readFile(registryPath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, services: {} });
  });

  it("parses registry file entries", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "devservers.json");
    const registryPath = resolvePortRegistryPath(configPath);
    await writeFile(
      registryPath,
      JSON.stringify({ version: 1, services: { api: 3000, web: "4000" } }),
      "utf-8"
    );
    const registry = await readPortRegistry(configPath);
    expect(registry.ports).toEqual({ api: 3000, web: 4000 });
  });

  it("assigns the next available port when missing", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "devservers.json");
    const assigned = await ensureRegistryPort(configPath, "api", {
      preferredPort: 3000,
      reservedPorts: [3000, 3001],
      checkAvailability: async (port) => port !== 3002
    });
    expect(assigned.port).toBe(3003);
    const raw = await readFile(assigned.registryPath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, services: { api: 3003 } });
  });

  it("returns an existing registry port without rewriting", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "devservers.json");
    const registryPath = resolvePortRegistryPath(configPath);
    await writeFile(
      registryPath,
      JSON.stringify({ version: 1, services: { api: 4555 } }),
      "utf-8"
    );
    const assigned = await ensureRegistryPort(configPath, "api", {
      preferredPort: 3000,
      reservedPorts: [3000]
    });
    expect(assigned.port).toBe(4555);
  });
});
