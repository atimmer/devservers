import type {
  DevServerConfig,
  DevServerService,
  PortMode,
  ServiceInfo
} from "@24letters/devservers-shared";
import {
  pruneMissingRegisteredProjects,
  readConfig,
  upsertService,
  writeConfig
} from "./config.js";
import type { ComposeProjectRegistry } from "./compose.js";
import { detectPortFromLogs, PORT_LOG_LINES } from "./port-detection.js";
import { ensureRegistryPort, readPortRegistry } from "./port-registry.js";
import { matchProjectWindowNames } from "./project-windows.js";
import { resolveRepoInfo } from "./repo.js";
import { orderServices } from "./service-order.js";
import {
  capturePane,
  getServiceRuntime,
  listWindows,
  restartWindow,
  startWindow,
  stopWindow
} from "./tmux.js";

const DEFAULT_PORT_MODE: PortMode = "static";

export const SERVICE_SOURCES = {
  config: "config",
  compose: "compose"
} as const;

type ServiceSource = (typeof SERVICE_SOURCES)[keyof typeof SERVICE_SOURCES];
export type ServiceSourceMeta = {
  source: ServiceSource;
  projectName?: string;
  projectIsMonorepo?: boolean;
  managedEnvFile?: string;
};

export type ServiceCatalog = {
  config: DevServerConfig;
  services: DevServerService[];
  sources: Map<string, ServiceSourceMeta>;
};

export type Logger = {
  error: (data: Record<string, unknown>, message: string) => void;
  warn: (data: Record<string, unknown>, message: string) => void;
};

export const findService = (services: DevServerService[], name: string) => {
  return services.find((service) => service.name === name);
};

export const createServiceManager = (
  configPath: string,
  composeProjects: ComposeProjectRegistry,
  mainLogger: Logger
) => {
  const runtimeDetectedPorts = new Map<string, number>();
  const runtimeLastStartedAt = new Map<string, string>();
  const startingServices = new Set<string>();

  const clearRuntimeState = (name: string) => {
    runtimeDetectedPorts.delete(name);
    runtimeLastStartedAt.delete(name);
    startingServices.delete(name);
  };

  const stopServicesForProjects = async (projectNames: string[], logger: Logger) => {
    const windowNames = matchProjectWindowNames(await listWindows(), projectNames);
    for (const windowName of windowNames) {
      try {
        await stopWindow(windowName);
      } catch (error) {
        logger.error(
          { err: error, windowName },
          "Failed to stop service for removed project"
        );
      } finally {
        clearRuntimeState(windowName);
      }
    }
  };

  const readConfigWithPrunedProjects = async (logger: Logger) => {
    const config = await readConfig(configPath);
    const { config: nextConfig, removedProjects } = await pruneMissingRegisteredProjects(config);
    if (removedProjects.length === 0) {
      return config;
    }

    await writeConfig(configPath, nextConfig);
    await composeProjects.sync(nextConfig.registeredProjects, logger);
    await stopServicesForProjects(
      removedProjects.map((project) => project.name),
      logger
    );
    for (const project of removedProjects) {
      logger.warn(
        { project: project.name, path: project.path },
        "Removed registered project with missing directory"
      );
    }
    return nextConfig;
  };

  const buildCatalogFromConfig = async (
    config: DevServerConfig,
    logger: Logger
  ): Promise<ServiceCatalog> => {
    await composeProjects.sync(config.registeredProjects, logger);
    await composeProjects.refresh(logger);
    const composeServices = composeProjects.getServices();

    const services: DevServerService[] = [];
    const sources = new Map<string, ServiceSourceMeta>();

    for (const service of config.services) {
      if (sources.has(service.name)) {
        throw new Error(`Duplicate service name: ${service.name}`);
      }
      sources.set(service.name, { source: SERVICE_SOURCES.config });
      services.push(service);
    }

    for (const service of composeServices) {
      if (sources.has(service.name)) {
        throw new Error(`Duplicate service name: ${service.name}`);
      }
      sources.set(service.name, {
        source: SERVICE_SOURCES.compose,
        projectName: service.projectName,
        projectIsMonorepo: service.projectIsMonorepo,
        managedEnvFile: service.managedEnvFile
      });
      services.push(service);
    }

    return { config, services, sources };
  };

  const resolveServiceCatalog = async (logger: Logger): Promise<ServiceCatalog> => {
    const config = await readConfigWithPrunedProjects(logger);
    return await buildCatalogFromConfig(config, logger);
  };

  const resolvePortMode = (service: DevServerService): PortMode => {
    return service.portMode ?? DEFAULT_PORT_MODE;
  };

  const resolveServicePort = (
    service: DevServerService,
    registryPorts: Record<string, number>
  ) => {
    const portMode = resolvePortMode(service);
    if (portMode === "registry") {
      return registryPorts[service.name];
    }
    if (portMode === "detect") {
      return runtimeDetectedPorts.get(service.name) ?? service.port;
    }
    return service.port;
  };

  const listServices = async (): Promise<ServiceInfo[]> => {
    const catalog = await resolveServiceCatalog(mainLogger);
    const windowNames = new Set(await listWindows());
    let registryPorts: Record<string, number> = {};
    try {
      const registry = await readPortRegistry(configPath);
      registryPorts = registry.ports;
    } catch (error) {
      mainLogger.error({ err: error }, "Failed to read port registry");
    }
    const statuses = await Promise.all(
      catalog.services.map(async (service) => {
        const meta = catalog.sources.get(service.name);
        const runtimeLastStarted = runtimeLastStartedAt.get(service.name);
        const runtime = startingServices.has(service.name)
          ? ({ status: "starting", message: "Starting service." } as const)
          : await getServiceRuntime(service, windowNames);
        return {
          ...service,
          lastStartedAt: service.lastStartedAt ?? runtimeLastStarted,
          repo: await resolveRepoInfo(service.cwd),
          port: resolveServicePort(service, registryPorts),
          source: meta?.source,
          projectName: meta?.projectName,
          projectIsMonorepo: meta?.projectIsMonorepo,
          ...runtime
        } satisfies ServiceInfo;
      })
    );
    const liveNames = new Set(statuses.map((service) => service.name));
    for (const name of runtimeDetectedPorts.keys()) {
      if (!liveNames.has(name)) {
        runtimeDetectedPorts.delete(name);
      }
    }
    for (const name of runtimeLastStartedAt.keys()) {
      if (!liveNames.has(name)) {
        runtimeLastStartedAt.delete(name);
      }
    }
    return orderServices(statuses);
  };

  const resolveSourceMeta = (
    sources: Map<string, ServiceSourceMeta>,
    serviceName: string
  ): ServiceSourceMeta => {
    return sources.get(serviceName) ?? { source: SERVICE_SOURCES.config };
  };

  const isComposeManagedService = (
    sources: Map<string, ServiceSourceMeta>,
    serviceName: string
  ) => {
    return resolveSourceMeta(sources, serviceName).source === SERVICE_SOURCES.compose;
  };

  const persistDetectedPort = async (
    service: DevServerService,
    port: number,
    sourceMeta: ServiceSourceMeta
  ) => {
    runtimeDetectedPorts.set(service.name, port);
    if (sourceMeta.source !== SERVICE_SOURCES.config) {
      return;
    }
    const config = await readConfigWithPrunedProjects(mainLogger);
    const current = findService(config.services, service.name);
    if (!current || current.port === port) {
      return;
    }
    const nextConfig = upsertService(config, { ...current, port });
    await writeConfig(configPath, nextConfig);
  };

  const updateLastStartedAt = async (
    service: DevServerService,
    lastStartedAt: string,
    sourceMeta: ServiceSourceMeta
  ) => {
    runtimeLastStartedAt.set(service.name, lastStartedAt);
    if (sourceMeta.source !== SERVICE_SOURCES.config) {
      return;
    }
    const config = await readConfigWithPrunedProjects(mainLogger);
    const current = findService(config.services, service.name);
    if (!current) {
      return;
    }
    const nextConfig = upsertService(config, { ...current, lastStartedAt });
    await writeConfig(configPath, nextConfig);
  };

  const collectReservedPorts = (services: DevServerService[], currentName: string) => {
    const reserved = new Set<number>();
    for (const service of services) {
      if (service.name === currentName) {
        continue;
      }
      if (typeof service.port === "number" && Number.isFinite(service.port)) {
        reserved.add(service.port);
      }
    }
    return reserved;
  };

  const isValidPort = (value: number | undefined): value is number => {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 65535;
  };

  const resolveServicePorts = async (
    services: DevServerService[],
    logger: Logger,
    overrides: Record<string, number | undefined> = {}
  ) => {
    let registryPorts: Record<string, number> = {};
    try {
      const registry = await readPortRegistry(configPath);
      registryPorts = registry.ports;
    } catch (error) {
      logger.error({ err: error }, "Failed to read port registry");
    }

    const resolved: Record<string, number | undefined> = {};
    for (const item of services) {
      resolved[item.name] = resolveServicePort(item, registryPorts);
    }
    for (const [name, port] of Object.entries(overrides)) {
      if (isValidPort(port)) {
        resolved[name] = port;
      }
    }
    return resolved;
  };

  const resolveStartSettings = async (
    services: DevServerService[],
    service: DevServerService,
    logger: Logger
  ) => {
    const portMode = resolvePortMode(service);
    let resolvedPort: number | undefined;
    if (portMode === "registry") {
      try {
        const reservedPorts = collectReservedPorts(services, service.name);
        const registry = await ensureRegistryPort(configPath, service.name, {
          preferredPort: service.port,
          reservedPorts
        });
        resolvedPort = registry.port;
      } catch (error) {
        logger.error({ err: error }, "Failed to read port registry");
        throw new Error("failed to read port registry");
      }
    } else {
      resolvedPort = service.port;
    }

    const baseline =
      portMode === "detect" ? await capturePane(service.name, PORT_LOG_LINES) : "";
    return { portMode, resolvedPort, baseline };
  };

  const schedulePortDetection = (
    sources: Map<string, ServiceSourceMeta>,
    service: DevServerService,
    baseline: string,
    logger: Logger
  ) => {
    void (async () => {
      try {
        const detectedPort = await detectPortFromLogs(service, baseline);
        if (detectedPort) {
          const sourceMeta = resolveSourceMeta(sources, service.name);
          await persistDetectedPort(service, detectedPort, sourceMeta);
        }
      } catch (error) {
        logger.error({ err: error }, "Failed to detect service port");
      }
    })();
  };

  const runServiceWindow = async (
    operation: "start" | "restart",
    services: DevServerService[],
    sources: Map<string, ServiceSourceMeta>,
    service: DevServerService,
    logger: Logger
  ) => {
    startingServices.add(service.name);
    try {
      const sourceMeta = resolveSourceMeta(sources, service.name);
      const { portMode, resolvedPort, baseline } = await resolveStartSettings(
        services,
        service,
        logger
      );
      const servicePorts = await resolveServicePorts(services, logger, {
        [service.name]: resolvedPort
      });
      const options = {
        resolvedPort,
        servicePorts,
        managedEnvFile: sourceMeta.managedEnvFile
      };
      const started =
        operation === "start"
          ? await startWindow(service, options)
          : await restartWindow(service, options);
      if (started) {
        await updateLastStartedAt(service, new Date().toISOString(), sourceMeta);
        if (portMode === "detect") {
          schedulePortDetection(sources, service, baseline, logger);
        }
      }
      return started;
    } finally {
      startingServices.delete(service.name);
    }
  };

  return {
    buildCatalogFromConfig,
    clearRuntimeState,
    isComposeManagedService,
    listServices,
    readConfigWithPrunedProjects,
    resolveServiceCatalog,
    resolveSourceMeta,
    restartServiceWindow: runServiceWindow.bind(null, "restart"),
    startServiceWindow: runServiceWindow.bind(null, "start"),
    stopServicesForProjects
  };
};

export type ServiceManager = ReturnType<typeof createServiceManager>;
