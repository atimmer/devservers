import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  portModeSchema,
  type DevServerService,
  type PortMode,
  type RegisteredProject
} from "@24letters/devservers-shared";
import { parse } from "yaml";

export const COMPOSE_FILENAME = "devservers-compose.yml";

type Logger = {
  error: (data: Record<string, unknown>, message: string) => void;
};

export type ComposeManagedService = DevServerService & {
  projectName: string;
  projectIsMonorepo?: boolean;
  composePath: string;
  sourceDefinition: Record<string, unknown>;
};

const PORT_REFERENCE_TOKEN = /\$\{PORT:([a-zA-Z0-9._-]+)\}/g;

type ProjectState = {
  project: RegisteredProject;
  rootPath: string;
  composePath: string;
  watcher?: FSWatcher;
  reloadTimer?: NodeJS.Timeout;
  mtimeMs?: number;
  services: ComposeManagedService[];
};

const asObject = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const readString = (
  input: Record<string, unknown>,
  keys: string[],
  options: { required?: boolean } = {}
) => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  if (options.required) {
    throw new Error(`Missing required key: ${keys[0]}`);
  }
  return undefined;
};

const readPort = (input: Record<string, unknown>) => {
  const raw = input["port"];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port value: ${String(raw)}`);
  }
  return parsed;
};

const readPortMode = (input: Record<string, unknown>): PortMode | undefined => {
  const raw = input["portMode"] ?? input["port_mode"] ?? input["port-mode"];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const parsed = portModeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid port-mode value: ${String(raw)}`);
  }
  return parsed.data;
};

const readDependsOn = (input: Record<string, unknown>) => {
  const raw = input["dependsOn"] ?? input["depends_on"] ?? input["depends-on"];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    const deps = raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return deps.length > 0 ? deps : undefined;
  }
  const asMap = asObject(raw);
  if (asMap) {
    const deps = Object.keys(asMap).map((item) => item.trim()).filter(Boolean);
    return deps.length > 0 ? deps : undefined;
  }
  throw new Error("depends_on must be an array or object");
};

const readCommand = (input: Record<string, unknown>) => {
  const raw = input["command"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw;
  }
  if (Array.isArray(raw)) {
    const parts = raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }
  throw new Error("Missing required key: command");
};

const normalizeEnvObject = (value: Record<string, unknown>) => {
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      env[key] = item;
      continue;
    }
    if (typeof item === "number" || typeof item === "boolean") {
      env[key] = String(item);
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
};

const normalizeEnvArray = (value: unknown[]) => {
  const env: Record<string, string> = {};
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    env[key] = rest.join("=");
  }
  return Object.keys(env).length > 0 ? env : undefined;
};

const readEnv = (input: Record<string, unknown>) => {
  const raw = input["env"] ?? input["environment"];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    return normalizeEnvArray(raw);
  }
  const asEnvObject = asObject(raw);
  if (asEnvObject) {
    return normalizeEnvObject(asEnvObject);
  }
  throw new Error("env/environment must be an object or array");
};

const prefixServiceName = (projectName: string, serviceName: string) => {
  const prefix = `${projectName}_`;
  if (serviceName.startsWith(prefix)) {
    return serviceName;
  }
  return `${prefix}${serviceName}`;
};

const rewriteLocalPortReferences = (
  value: string,
  localServiceNames: Set<string>,
  projectName: string
) => {
  return value.replace(PORT_REFERENCE_TOKEN, (token, localName: string) => {
    if (!localServiceNames.has(localName)) {
      return token;
    }
    return `\${PORT:${prefixServiceName(projectName, localName)}}`;
  });
};

const rewriteEnvPortReferences = (
  env: Record<string, string> | undefined,
  localServiceNames: Set<string>,
  projectName: string
) => {
  if (!env) {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    next[key] = rewriteLocalPortReferences(value, localServiceNames, projectName);
  }
  return next;
};

const resolveServiceCwd = (projectRoot: string, input: Record<string, unknown>) => {
  const raw = readString(input, ["cwd", "working_dir", "working-dir"]);
  if (!raw) {
    return projectRoot;
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(projectRoot, raw);
};

export const parseComposeServices = (
  project: RegisteredProject,
  payload: string
): ComposeManagedService[] => {
  const parsed = parse(payload);
  const root = asObject(parsed);
  if (!root) {
    throw new Error("Compose file must be a YAML object.");
  }
  const rawServices = asObject(root["services"]);
  if (!rawServices) {
    return [];
  }

  const projectRoot = path.resolve(project.path);
  const localServiceNames = new Set(Object.keys(rawServices));
  const services: ComposeManagedService[] = [];
  for (const [localName, rawDefinition] of Object.entries(rawServices)) {
    const definition = asObject(rawDefinition);
    if (!definition) {
      throw new Error(`Service "${localName}" must be an object.`);
    }

    const command = readCommand(definition);
    const sourceDefinition = { ...definition };
    const dependsOn = readDependsOn(definition)?.map((dependencyName) => {
      if (!localServiceNames.has(dependencyName)) {
        return dependencyName;
      }
      return prefixServiceName(project.name, dependencyName);
    });
    const service: ComposeManagedService = {
      name: prefixServiceName(project.name, localName),
      command,
      cwd: resolveServiceCwd(projectRoot, definition),
      dependsOn,
      env: rewriteEnvPortReferences(readEnv(definition), localServiceNames, project.name),
      port: readPort(definition),
      portMode: readPortMode(definition),
      lastStartedAt: readString(definition, ["lastStartedAt", "last-started-at"]),
      projectName: project.name,
      projectIsMonorepo: project.isMonorepo,
      composePath: path.join(projectRoot, COMPOSE_FILENAME),
      sourceDefinition
    };
    services.push(service);
  }
  return services;
};

const readComposeMtime = async (composePath: string) => {
  try {
    const result = await stat(composePath);
    return result.mtimeMs;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

export class ComposeProjectRegistry {
  private states = new Map<string, ProjectState>();

  private closeState(state: ProjectState) {
    if (state.reloadTimer) {
      clearTimeout(state.reloadTimer);
    }
    state.watcher?.close();
  }

  private buildState(project: RegisteredProject): ProjectState {
    const rootPath = path.resolve(project.path);
    return {
      project,
      rootPath,
      composePath: path.join(rootPath, COMPOSE_FILENAME),
      services: []
    };
  }

  private async reloadProject(state: ProjectState, logger: Logger, options?: { force?: boolean }) {
    try {
      const mtimeMs = await readComposeMtime(state.composePath);
      if (!options?.force && mtimeMs === state.mtimeMs) {
        return;
      }
      state.mtimeMs = mtimeMs;
      if (!mtimeMs) {
        state.services = [];
        return;
      }
      const raw = await readFile(state.composePath, "utf-8");
      state.services = parseComposeServices(state.project, raw);
    } catch (error) {
      state.services = [];
      logger.error(
        { err: error, project: state.project.name, composePath: state.composePath },
        "Failed to load devservers compose file"
      );
    }
  }

  private scheduleReload(projectName: string, logger: Logger) {
    const state = this.states.get(projectName);
    if (!state) {
      return;
    }
    if (state.reloadTimer) {
      clearTimeout(state.reloadTimer);
    }
    state.reloadTimer = setTimeout(() => {
      state.reloadTimer = undefined;
      void this.reloadProject(state, logger);
    }, 120);
  }

  private ensureWatcher(state: ProjectState, logger: Logger) {
    if (state.watcher) {
      return;
    }
    try {
      state.watcher = watch(
        state.rootPath,
        { persistent: false },
        (_eventType, filename) => {
          if (filename && path.basename(filename.toString()) !== COMPOSE_FILENAME) {
            return;
          }
          this.scheduleReload(state.project.name, logger);
        }
      );
      state.watcher.on("error", (error) => {
        logger.error(
          { err: error, project: state.project.name, rootPath: state.rootPath },
          "Compose project watcher failed"
        );
      });
    } catch (error) {
      logger.error(
        { err: error, project: state.project.name, rootPath: state.rootPath },
        "Failed to watch compose project directory"
      );
    }
  }

  async sync(projects: RegisteredProject[], logger: Logger) {
    const nextNames = new Set(projects.map((project) => project.name));
    for (const [name, state] of this.states.entries()) {
      if (nextNames.has(name)) {
        continue;
      }
      this.closeState(state);
      this.states.delete(name);
    }

    for (const project of projects) {
      const existing = this.states.get(project.name);
      const nextRoot = path.resolve(project.path);
      const shouldReplace =
        !existing ||
        existing.rootPath !== nextRoot ||
        existing.project.isMonorepo !== project.isMonorepo;

      let state = existing;
      if (shouldReplace) {
        if (existing) {
          this.closeState(existing);
        }
        state = this.buildState(project);
        this.states.set(project.name, state);
      } else if (state) {
        state.project = project;
      }

      if (!state) {
        continue;
      }

      if (shouldReplace) {
        await this.reloadProject(state, logger, { force: true });
      }
      this.ensureWatcher(state, logger);
    }
  }

  getServices() {
    return [...this.states.values()].flatMap((state) =>
      state.services.map((service) => ({ ...service }))
    );
  }

  getServiceDefinition(name: string) {
    for (const state of this.states.values()) {
      const service = state.services.find((item) => item.name === name);
      if (!service) {
        continue;
      }
      return {
        projectName: service.projectName,
        composePath: service.composePath,
        serviceName: service.name,
        sourceDefinition: { ...service.sourceDefinition }
      };
    }
    return undefined;
  }

  close() {
    for (const state of this.states.values()) {
      this.closeState(state);
    }
    this.states.clear();
  }
}
