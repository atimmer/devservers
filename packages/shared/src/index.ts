import { z } from "zod";

export const CONFIG_ENV_VAR = "DEVSERVER_CONFIG";
export const DEFAULT_CONFIG_FILENAME = "devservers.json";
export const DAEMON_PORT = 4141;

const namePattern = /^[a-zA-Z0-9._-]+$/;
export const portModeSchema = z.enum(["static", "detect", "registry"]);
export type PortMode = z.infer<typeof portModeSchema>;

export const devServerServiceSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(namePattern, "name must be alphanumeric with ._- only"),
  cwd: z.string().min(1),
  command: z.string().min(1),
  dependsOn: z
    .array(z.string().min(1).regex(namePattern, "dependsOn must match service name rules"))
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
  port: z.number().int().positive().optional(),
  portMode: portModeSchema.optional(),
  lastStartedAt: z.string().datetime().optional()
});

export const devServerConfigSchema = z.object({
  version: z.literal(1),
  services: z.array(devServerServiceSchema)
});

export type DevServerService = z.infer<typeof devServerServiceSchema>;
export type DevServerConfig = z.infer<typeof devServerConfigSchema>;

export type ServiceStatus = "stopped" | "running" | "error";

export type RepoInfo = {
  name: string;
  root: string;
  workspace: string;
};

export type ServiceInfo = DevServerService & {
  status: ServiceStatus;
  message?: string;
  repo?: RepoInfo;
};

export type DependencyGraph = {
  servicesByName: Map<string, DevServerService>;
  depsByName: Map<string, string[]>;
  dependentsByName: Map<string, string[]>;
  order: string[];
};

const ensureServiceExists = (graph: DependencyGraph, name: string) => {
  if (!graph.servicesByName.has(name)) {
    throw new Error(`Unknown service "${name}".`);
  }
};

export const createDependencyGraph = (services: DevServerService[]): DependencyGraph => {
  const servicesByName = new Map<string, DevServerService>();
  const depsByName = new Map<string, string[]>();
  const dependentsByName = new Map<string, string[]>();
  const order = services.map((service) => service.name);

  for (const service of services) {
    servicesByName.set(service.name, service);
  }

  for (const service of services) {
    const deps = service.dependsOn ? [...service.dependsOn] : [];
    const seen = new Set<string>();
    const duplicates = deps.filter((dep) => {
      if (seen.has(dep)) {
        return true;
      }
      seen.add(dep);
      return false;
    });
    if (duplicates.length > 0) {
      throw new Error(
        `Service "${service.name}" has duplicate dependencies: ${duplicates.join(", ")}.`
      );
    }
    if (deps.includes(service.name)) {
      throw new Error(`Service "${service.name}" cannot depend on itself.`);
    }
    for (const dep of deps) {
      if (!servicesByName.has(dep)) {
        throw new Error(`Service "${service.name}" depends on missing service "${dep}".`);
      }
      const existing = dependentsByName.get(dep);
      if (existing) {
        existing.push(service.name);
      } else {
        dependentsByName.set(dep, [service.name]);
      }
    }
    depsByName.set(service.name, deps);
  }

  for (const name of order) {
    if (!dependentsByName.has(name)) {
      dependentsByName.set(name, []);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string) => {
    if (visited.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      const startIndex = stack.indexOf(name);
      const cycle = [...stack.slice(startIndex), name];
      throw new Error(`Dependency cycle detected: ${cycle.join(" -> ")}.`);
    }
    visiting.add(name);
    stack.push(name);
    for (const dep of depsByName.get(name) ?? []) {
      visit(dep);
    }
    stack.pop();
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of order) {
    visit(name);
  }

  return { servicesByName, depsByName, dependentsByName, order };
};

export const collectDependencies = (graph: DependencyGraph, name: string): string[] => {
  ensureServiceExists(graph, name);
  const result = new Set<string>();
  const visit = (target: string) => {
    if (result.has(target)) {
      return;
    }
    result.add(target);
    for (const dep of graph.depsByName.get(target) ?? []) {
      visit(dep);
    }
  };
  visit(name);
  return [...result];
};

export const collectDependents = (graph: DependencyGraph, name: string): string[] => {
  ensureServiceExists(graph, name);
  const result = new Set<string>();
  const visit = (target: string) => {
    if (result.has(target)) {
      return;
    }
    result.add(target);
    for (const dep of graph.dependentsByName.get(target) ?? []) {
      visit(dep);
    }
  };
  visit(name);
  return [...result];
};

export const topoSort = (graph: DependencyGraph, names: string[]): string[] => {
  const allowed = new Set(names);
  const visited = new Set<string>();
  const result: string[] = [];

  const visit = (name: string) => {
    if (!allowed.has(name) || visited.has(name)) {
      return;
    }
    visited.add(name);
    for (const dep of graph.depsByName.get(name) ?? []) {
      visit(dep);
    }
    result.push(name);
  };

  for (const name of graph.order) {
    visit(name);
  }

  return result;
};
