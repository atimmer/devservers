import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DevServerService, RegisteredProject } from "@24letters/devservers-shared";
import {
  readConfig,
  removeRegisteredProject,
  removeService,
  upsertRegisteredProject,
  upsertService,
  writeConfig
} from "./config.js";

const createTempDir = async () => {
  return await mkdtemp(path.join(tmpdir(), "devservers-"));
};

const sampleService = {
  name: "api",
  cwd: "/tmp/api",
  command: "pnpm dev",
  port: 3000,
  portMode: "static"
} satisfies DevServerService;

const sampleProject = {
  name: "academy",
  path: "/tmp/academy",
  isMonorepo: true
} satisfies RegisteredProject;

describe("config", () => {
  it("returns empty config when file is missing", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "missing.json");
    const config = await readConfig(configPath);
    expect(config).toEqual({ version: 1, services: [], registeredProjects: [] });
  });

  it("writes and reads config", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "devservers.json");
    await writeConfig(configPath, {
      version: 1,
      services: [sampleService],
      registeredProjects: [sampleProject]
    });
    const config = await readConfig(configPath);
    expect(config.services).toHaveLength(1);
    expect(config.services[0]?.name).toBe("api");
    expect(config.registeredProjects[0]?.name).toBe("academy");
  });

  it("rejects duplicate services", async () => {
    const dir = await createTempDir();
    const configPath = path.join(dir, "devservers.json");
    await expect(
      writeConfig(configPath, {
        version: 1,
        services: [sampleService, sampleService],
        registeredProjects: []
      })
    ).rejects.toThrow("Duplicate service name");
  });

  it("upserts and removes services", async () => {
    const base = { version: 1 as const, services: [], registeredProjects: [] };
    const withService = upsertService(base, sampleService);
    expect(withService.services).toHaveLength(1);

    const updated = upsertService(withService, { ...sampleService, command: "pnpm dev -- --debug" });
    expect(updated.services[0]?.command).toBe("pnpm dev -- --debug");

    const removed = removeService(updated, "api");
    expect(removed.services).toHaveLength(0);
  });

  it("upserts and removes registered projects", () => {
    const base = { version: 1 as const, services: [], registeredProjects: [] };
    const withProject = upsertRegisteredProject(base, sampleProject);
    expect(withProject.registeredProjects).toHaveLength(1);

    const updated = upsertRegisteredProject(withProject, {
      ...sampleProject,
      isMonorepo: false
    });
    expect(updated.registeredProjects[0]?.isMonorepo).toBe(false);

    const removed = removeRegisteredProject(updated, "academy");
    expect(removed.registeredProjects).toHaveLength(0);
  });
});
