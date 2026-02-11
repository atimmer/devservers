import * as Dialog from "@radix-ui/react-dialog";
import React from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

const ViewTransition =
  (React as { ViewTransition?: React.ComponentType<React.PropsWithChildren> }).ViewTransition ??
  (React as { unstable_ViewTransition?: React.ComponentType<React.PropsWithChildren> })
    .unstable_ViewTransition ??
  React.Fragment;
const { startTransition, useCallback, useEffect, useMemo, useRef, useState } = React;

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error?: Error; errorInfo?: React.ErrorInfo }
> {
  state: { error?: Error; errorInfo?: React.ErrorInfo } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
  }

  render() {
    const { error, errorInfo } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-6 py-10 text-slate-100">
        <h1 className="text-2xl font-semibold">Something went wrong.</h1>
        {import.meta.env.DEV ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            <p className="font-semibold">{error.message}</p>
            {errorInfo?.componentStack ? (
              <pre className="mt-2 whitespace-pre-wrap">{errorInfo.componentStack}</pre>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}
import {
  addProject,
  addService,
  createLogsSocket,
  deleteProject,
  deleteService,
  getProjects,
  getServiceConfigDefinition,
  getServices,
  restartService,
  startService,
  stopService,
  updateService,
  type RegisteredProject,
  type ServiceConfigDefinition,
  type ServiceInfo,
  type ServiceStatus,
  type PortMode
} from "./api";

const statusStyles: Record<ServiceStatus, string> = {
  running: "bg-emerald-400/15 text-emerald-200 border-emerald-400/30",
  stopped: "bg-slate-400/10 text-slate-300 border-slate-400/20",
  error: "bg-rose-400/15 text-rose-200 border-rose-400/30"
};

const TMUX_SESSION = "devservers";
const buildServiceUrl = (service: ServiceInfo) => {
  if (!service.port) {
    return null;
  }
  const hostname = typeof window === "undefined" ? "localhost" : window.location.hostname;
  const protocol = typeof window === "undefined" ? "http:" : window.location.protocol;
  const scheme = protocol === "https:" ? "https:" : "http:";
  return `${scheme}//${hostname}:${service.port}`;
};
const formatEnv = (env?: Record<string, string>) => {
  if (!env || Object.keys(env).length === 0) {
    return "";
  }
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
};
const formatWorkspace = (workspace?: string) => {
  if (!workspace) {
    return null;
  }
  if (workspace === ".") {
    return "root";
  }
  return workspace;
};
const portModeLabels: Record<PortMode, string> = {
  static: "Static",
  detect: "Detect from logs",
  registry: "Port registry"
};

const parseEnv = (value: string) => {
  const entries = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    env[key] = rest.join("=");
  }
  return Object.keys(env).length > 0 ? env : undefined;
};

const formatConfigDefinition = (config: ServiceConfigDefinition | null) => {
  if (!config) {
    return "";
  }
  return JSON.stringify(config.definition, null, 2);
};

const LOG_ERROR_PATTERN =
  /\b(error|failed|fatal|exception|panic|traceback|unhandled|eaddrinuse|segmentation fault)\b/i;

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = new RegExp("\\u001b\\[[0-9;]*m", "g");
const stripAnsi = (value: string) => value.replace(ANSI_ESCAPE_PATTERN, "");

const hasLogError = (value: string) => LOG_ERROR_PATTERN.test(stripAnsi(value));

const ServiceStatusPill = ({ status }: { status: ServiceStatus }) => (
  <span
    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusStyles[status]}`}
  >
    {status}
  </span>
);

const ActionButton = ({
  label,
  onClick,
  variant,
  className,
  isLoading = false,
  disabled = false,
  spinnerClassName
}: {
  label: string;
  onClick: () => void;
  variant: "start" | "stop" | "restart";
  className?: string;
  isLoading?: boolean;
  disabled?: boolean;
  spinnerClassName?: string;
}) => {
  const styles =
    variant === "start"
      ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
      : variant === "stop"
        ? "bg-rose-500 text-rose-950 hover:bg-rose-400"
        : "bg-amber-400 text-amber-950 hover:bg-amber-300";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-9 w-full rounded-full px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-70 ${styles} ${className ?? ""}`}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {isLoading ? (
          <span
            className={`h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${spinnerClassName ?? ""}`}
          />
        ) : null}
        <span>{label}</span>
      </span>
    </button>
  );
};

const ServiceActionButtons = ({
  status,
  name,
  pendingStarts,
  pendingStops,
  pendingRestarts,
  onAction
}: {
  status: ServiceStatus;
  name: string;
  pendingStarts: string[];
  pendingStops: string[];
  pendingRestarts: string[];
  onAction: (action: "start" | "stop" | "restart", name: string) => void;
}) => {
  const actions = [
    {
      label: "Start",
      variant: "start" as const,
      shouldShow: status !== "running",
      isLoading: pendingStarts.includes(name)
    },
    {
      label: "Stop",
      variant: "stop" as const,
      shouldShow: status !== "stopped",
      isLoading: pendingStops.includes(name),
      spinnerClassName: "opacity-100 transition-opacity delay-100 start:opacity-0"
    },
    {
      label: "Restart",
      variant: "restart" as const,
      shouldShow: true,
      isLoading: pendingRestarts.includes(name)
    }
  ];

  return (
    <>
      {actions
        .filter((notice) => notice.shouldShow)
        .map(({ label, variant, isLoading, spinnerClassName }) => (
          <ActionButton
            key={variant}
            label={label}
            variant={variant}
            onClick={() => onAction(variant, name)}
            isLoading={isLoading}
            disabled={isLoading}
            spinnerClassName={spinnerClassName}
            className="w-full justify-center"
          />
        ))}
    </>
  );
};

export default function App() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [projects, setProjects] = useState<RegisteredProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLogService, setActiveLogService] = useState<ServiceInfo | null>(null);
  const [activeConfigService, setActiveConfigService] = useState<ServiceInfo | null>(null);
  const [activeConfigDefinition, setActiveConfigDefinition] = useState<ServiceConfigDefinition | null>(
    null
  );
  const [configLoading, setConfigLoading] = useState(false);
  const [logs, setLogs] = useState("");
  const [copied, setCopied] = useState(false);
  const [terminalContainer, setTerminalContainer] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastLogPayloadRef = useRef("");
  const shouldScrollRef = useRef(false);
  const [pendingStarts, setPendingStarts] = useState<string[]>([]);
  const [pendingStops, setPendingStops] = useState<string[]>([]);
  const [pendingRestarts, setPendingRestarts] = useState<string[]>([]);
  const [logErrors, setLogErrors] = useState<string[]>([]);
  const [logHighlights, setLogHighlights] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [editingService, setEditingService] = useState<ServiceInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formState, setFormState] = useState({
    name: "",
    cwd: "",
    command: "",
    port: "",
    env: "",
    portMode: "static" as PortMode,
    dependsOn: [] as string[]
  });
  const [projectFormState, setProjectFormState] = useState({
    name: "",
    path: "",
    isMonorepo: false
  });
  const [isSavingProject, setIsSavingProject] = useState(false);

  const writeLogsToTerminal = useCallback((nextLogs: string, force = false) => {
    const term = terminalRef.current;
    if (!term) {
      lastLogPayloadRef.current = nextLogs;
      return;
    }
    const previous = lastLogPayloadRef.current;
    if (force || !previous || !nextLogs.startsWith(previous)) {
      term.reset();
      if (nextLogs) {
        term.write(nextLogs);
      }
    } else {
      const delta = nextLogs.slice(previous.length);
      if (delta) {
        term.write(delta);
      }
    }
    if (shouldScrollRef.current) {
      term.scrollToBottom();
      shouldScrollRef.current = false;
    }
    lastLogPayloadRef.current = nextLogs;
  }, []);

  const markLogError = useCallback(
    (serviceName: string) => {
      setLogErrors((prev) => (prev.includes(serviceName) ? prev : [...prev, serviceName]));
      setLogHighlights((prev) => {
        if (activeLogService?.name === serviceName) {
          return prev;
        }
        return prev.includes(serviceName) ? prev : [...prev, serviceName];
      });
    },
    [activeLogService]
  );

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [data, projectData] = await Promise.all([getServices(), getProjects()]);
      const serviceNames = new Set(data.map((service) => service.name));
      const serviceByName = new Map(data.map((service) => [service.name, service]));

      startTransition(() => {
        setServices(data);
        setProjects(projectData);
        setPendingStarts((prev) =>
          prev.filter((name) => {
            if (!serviceNames.has(name)) {
              return false;
            }
            const service = serviceByName.get(name);
            return service ? service.status !== "running" : false;
          })
        );
        setPendingRestarts((prev) =>
          prev.filter((name) => {
            if (!serviceNames.has(name)) {
              return false;
            }
            const service = serviceByName.get(name);
            return service ? service.status !== "running" && service.status !== "error" : false;
          })
        );
        setPendingStops((prev) =>
          prev.filter((name) => {
            if (!serviceNames.has(name)) {
              return false;
            }
            const service = serviceByName.get(name);
            return service ? service.status !== "stopped" : false;
          })
        );
        setLogErrors((prev) => prev.filter((name) => serviceNames.has(name)));
        setLogHighlights((prev) => prev.filter((name) => serviceNames.has(name)));
        setLoading(false);
      });
    } catch (err) {
      startTransition(() => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!activeLogService || !terminalContainer) {
      return;
    }

    terminalContainer.innerHTML = "";
    const term = new Terminal({
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      scrollback: 4000,
      theme: {
        background: "#0b0e12",
        foreground: "#e2e8f0"
      }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainer);
    fitAddon.fit();
    terminalRef.current = term;

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(terminalContainer);
      resizeObserverRef.current = resizeObserver;
    }

    if (lastLogPayloadRef.current) {
      writeLogsToTerminal(lastLogPayloadRef.current, true);
    }

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      term.dispose();
      terminalRef.current = null;
    };
  }, [activeLogService, terminalContainer, writeLogsToTerminal]);

  useEffect(() => {
    if (!activeLogService) {
      setLogs("");
      setCopied(false);
      shouldScrollRef.current = false;
      lastLogPayloadRef.current = "";
      return;
    }

    setLogs("");
    lastLogPayloadRef.current = "";
    shouldScrollRef.current = true;
    const socket = createLogsSocket(activeLogService.name, 200, true);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type: string; payload: string };
        if (payload.type === "logs") {
          const nextLogs = payload.payload ?? "";
          const previousLogs = lastLogPayloadRef.current;
          const delta = nextLogs.startsWith(previousLogs)
            ? nextLogs.slice(previousLogs.length)
            : nextLogs;
          if (delta && hasLogError(delta)) {
            markLogError(activeLogService.name);
          }
          setLogs(nextLogs);
          writeLogsToTerminal(nextLogs);
        }
      } catch {
        const nextLogs = String(event.data ?? "");
        setLogs(nextLogs);
        writeLogsToTerminal(nextLogs, true);
      }
    };
    socket.onerror = () => {
      const message = "Failed to stream logs.";
      setLogs(message);
      writeLogsToTerminal(message, true);
    };
    return () => socket.close();
  }, [activeLogService, markLogError, writeLogsToTerminal]);

  const handleAction = useCallback(
    async (action: "start" | "stop" | "restart", name: string) => {
      setError(null);
      if (action === "start" || action === "restart") {
        setLogErrors((prev) => prev.filter((serviceName) => serviceName !== name));
        setLogHighlights((prev) => prev.filter((serviceName) => serviceName !== name));
      }
      if (action === "start") {
        setPendingStarts((prev) => (prev.includes(name) ? prev : [...prev, name]));
      }
      if (action === "stop") {
        setPendingStops((prev) => (prev.includes(name) ? prev : [...prev, name]));
      }
      if (action === "restart") {
        setPendingRestarts((prev) => (prev.includes(name) ? prev : [...prev, name]));
      }
      try {
        if (action === "start") {
          await startService(name);
        } else if (action === "stop") {
          await stopService(name);
        } else {
          await restartService(name);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (action === "start") {
          setPendingStarts((prev) => prev.filter((pending) => pending !== name));
        }
        if (action === "stop") {
          setPendingStops((prev) => prev.filter((pending) => pending !== name));
        }
        if (action === "restart") {
          setPendingRestarts((prev) => prev.filter((pending) => pending !== name));
        }
      }
    },
    [refresh]
  );

  const logErrorSet = useMemo(() => new Set(logErrors), [logErrors]);
  const displayStatus = useCallback(
    (service: ServiceInfo): ServiceStatus => {
      if (logErrorSet.has(service.name)) {
        return "error";
      }
      return service.status === "error" ? "stopped" : service.status;
    },
    [logErrorSet]
  );
  const statusSummary = useMemo(() => {
    const counts = { running: 0, stopped: 0, error: 0 };
    for (const service of services) {
      counts[displayStatus(service)] += 1;
    }
    return counts;
  }, [services, displayStatus]);
  const logHighlightSet = useMemo(() => new Set(logHighlights), [logHighlights]);
  const displayLogs = useMemo(() => logs.replace(/\s+$/, ""), [logs]);
  const isModalOpen =
    Boolean(activeLogService) || Boolean(activeConfigService) || showForm || showProjectForm;
  const CardTransition = isModalOpen ? React.Fragment : ViewTransition;
  const dependencyOptions = useMemo(() => {
    return [...services.map((service) => service.name)].sort((a, b) => a.localeCompare(b));
  }, [services]);
  const groupedServices = useMemo(() => {
    const groups: Array<{
      key: string;
      title: string;
      root?: string;
      services: ServiceInfo[];
    }> = [];
    const groupMap = new Map<string, (typeof groups)[number]>();

    for (const service of services) {
      const repo = service.repo;
      const key = repo?.root ?? "__ungrouped__";
      let group = groupMap.get(key);
      if (!group) {
        group = {
          key,
          title: repo?.name ?? "Standalone",
          root: repo?.root,
          services: []
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      group.services.push(service);
    }

    return groups;
  }, [services]);
  const availableDependencies = useMemo(() => {
    const currentName = formState.name.trim();
    return dependencyOptions.filter((option) => option !== currentName);
  }, [dependencyOptions, formState.name]);

  const resetForm = () =>
    setFormState({
      name: "",
      cwd: "",
      command: "",
      port: "",
      env: "",
      portMode: "static",
      dependsOn: []
    });
  const closeForm = () => {
    setShowForm(false);
    setFormMode("add");
    setEditingService(null);
    setIsDeleting(false);
    resetForm();
  };

  const submitForm = async () => {
    setError(null);
    const name = formState.name.trim();
    const payload = {
      name,
      cwd: formState.cwd.trim(),
      command: formState.command.trim(),
      port: formState.port ? Number(formState.port) : undefined,
      portMode: formState.portMode,
      env: parseEnv(formState.env),
      dependsOn: formState.dependsOn.length > 0 ? formState.dependsOn : undefined
    };

    try {
      if (formMode === "edit" && editingService) {
        await updateService(editingService.name, payload);
      } else {
        await addService(payload);
      }
      closeForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    if (!editingService || isDeleting) {
      return;
    }
    const confirmed = window.confirm(
      `Delete "${editingService.name}"? This removes it from your config.`
    );
    if (!confirmed) {
      return;
    }
    setError(null);
    setIsDeleting(true);
    try {
      await deleteService(editingService.name);
      closeForm();
      await refresh();
    } catch (err) {
      setIsDeleting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const closeProjectForm = () => {
    setShowProjectForm(false);
    setIsSavingProject(false);
    setProjectFormState({ name: "", path: "", isMonorepo: false });
  };

  const submitProjectForm = async () => {
    setError(null);
    setIsSavingProject(true);
    try {
      await addProject({
        name: projectFormState.name.trim(),
        path: projectFormState.path.trim(),
        isMonorepo: projectFormState.isMonorepo
      });
      closeProjectForm();
      await refresh();
    } catch (err) {
      setIsSavingProject(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeProjectRef = async (name: string) => {
    const confirmed = window.confirm(`Remove project "${name}"?`);
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await deleteProject(name);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openConfigDefinition = async (service: ServiceInfo) => {
    setError(null);
    setActiveConfigService(service);
    setActiveConfigDefinition(null);
    setConfigLoading(true);
    try {
      const definition = await getServiceConfigDefinition(service.name);
      setActiveConfigDefinition(definition);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfigLoading(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="relative min-h-full overflow-hidden bg-[#0b0e12] text-slate-100">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_20%_-10%,#233247,transparent_60%),radial-gradient(700px_circle_at_80%_10%,#2a1d2e,transparent_55%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-slate-950/70 to-transparent" />

        <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 pb-10 pt-0">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl rounded-t-none border border-white/10 bg-white/5 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              {([
                ["running", statusSummary.running],
                ["stopped", statusSummary.stopped],
                ["error", statusSummary.error]
              ] as const).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <span className="text-xs uppercase tracking-widest text-slate-400">{label}</span>
                  <span className="text-sm font-semibold text-white">{value}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                {projects.length} projects
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowProjectForm(true);
                }}
                className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white transition hover:border-white/60"
              >
                Add Project
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormMode("add");
                  setEditingService(null);
                  resetForm();
                  setShowForm(true);
                }}
                className="rounded-full bg-emerald-400 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Add Service
              </button>
            </div>
          </header>

          {error ? (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          {projects.length > 0 ? (
            <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Registered projects
              </p>
              <div className="flex flex-wrap gap-2">
                {projects.map((project) => (
                  <div
                    key={project.name}
                    className="flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-slate-200"
                  >
                    <span>{project.name}</span>
                    {project.isMonorepo ? (
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">
                        monorepo
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        void removeProjectRef(project.name);
                      }}
                      className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 transition hover:border-white/50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-6">
            {loading ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-sm text-slate-300">
                Loading services…
              </div>
            ) : services.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-sm text-slate-300">
                No services yet. Add one to get started.
              </div>
            ) : (
              groupedServices.map((group) => (
                <div key={group.key} className="grid gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <p className="text-xs uppercase tracking-widest text-slate-400">
                        {group.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {group.root ?? "No repo root detected"}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">
                      {group.services.length} services
                    </p>
                  </div>

                  {group.services.map((service) => {
                    const status = displayStatus(service);
                    return (
                      <CardTransition key={service.name}>
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-3">
                              <h2 className="text-xl font-semibold text-white">{service.name}</h2>
                              <ServiceStatusPill status={status} />
                            </div>
                            <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
                              {service.command}
                            </div>
                            {service.repo ? (
                              <div className="text-xs uppercase tracking-widest text-slate-500">
                                Workspace {formatWorkspace(service.repo.workspace)}
                              </div>
                            ) : null}
                            <div className="text-xs text-slate-300">{service.cwd}</div>
                            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                              {service.portMode === "detect" ? (
                                service.status === "running" ? (
                                  service.port ? (
                                    <span>Port {service.port}</span>
                                  ) : (
                                    <span>Port ....</span>
                                  )
                                ) : null
                              ) : service.port ? (
                                <span>Port {service.port}</span>
                              ) : (
                                <span>No port yet</span>
                              )}
                              <span>Mode {portModeLabels[service.portMode ?? "static"]}</span>
                              <span>
                                Source{" "}
                                {service.source === "compose"
                                  ? `Compose${service.projectName ? ` (${service.projectName})` : ""}`
                                  : "Config"}
                              </span>
                              {service.env && Object.keys(service.env).length > 0 ? (
                                <span>{Object.keys(service.env).length} env vars</span>
                              ) : null}
                            </div>
                            {service.dependsOn && service.dependsOn.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                                <span className="text-slate-500">Depends on</span>
                                {service.dependsOn.map((dep) => (
                                  <span
                                    key={dep}
                                    className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs uppercase tracking-wider text-slate-200"
                                  >
                                    {dep}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                            <div className="flex flex-col items-start gap-4 sm:flex-none sm:flex-row sm:items-start">
                            <div className="grid w-[140px] max-w-full content-start items-start gap-2">
                              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                Controls
                              </p>
                              <ServiceActionButtons
                                status={service.status}
                                name={service.name}
                                pendingStarts={pendingStarts}
                                pendingStops={pendingStops}
                                pendingRestarts={pendingRestarts}
                                onAction={handleAction}
                              />
                            </div>
                            <div className="grid w-[140px] max-w-full content-start items-start gap-2">
                              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                                Utilities
                              </p>
                              {service.status === "running" && service.port ? (
                                <a
                                  href={buildServiceUrl(service) ?? undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex h-9 w-full items-center justify-center rounded-full border border-white/20 px-3 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
                                >
                                  Open
                                </a>
                              ) : null}
                              {service.source === "compose" ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void openConfigDefinition(service);
                                  }}
                                  className="h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
                                >
                                  Config
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFormMode("edit");
                                    setEditingService(service);
                                    setFormState({
                                      name: service.name,
                                      cwd: service.cwd,
                                      command: service.command,
                                      port: service.port ? String(service.port) : "",
                                      env: formatEnv(service.env),
                                      portMode: service.portMode ?? "static",
                                      dependsOn: service.dependsOn ?? []
                                    });
                                    setShowForm(true);
                                  }}
                                  className="h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
                                >
                                  Edit
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveLogService(service);
                                  setLogHighlights((prev) =>
                                    prev.filter((highlighted) => highlighted !== service.name)
                                  );
                                }}
                                className={`h-9 w-full rounded-full border px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] transition ${
                                  logHighlightSet.has(service.name)
                                    ? "border-amber-400/70 bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/40 hover:border-amber-300/80"
                                    : "border-white/20 text-white hover:border-white/60"
                                }`}
                              >
                                Logs
                              </button>
                              {service.status === "running" && service.port ? null : (
                                <button
                                  type="button"
                                  className="invisible h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white"
                                  aria-hidden="true"
                                  tabIndex={-1}
                                  disabled
                                >
                                  Open
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        </div>
                      </CardTransition>
                    );
                  })}
                </div>
              ))
            )}
          </section>
        </div>

        <Dialog.Root
          open={Boolean(activeLogService)}
          onOpenChange={(open) => {
            if (!open) {
              setActiveLogService(null);
            }
          }}
        >
          {activeLogService ? (
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
              <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10 outline-none">
                <div className="flex h-[85vh] w-full max-w-5xl flex-col rounded-3xl border border-white/10 bg-[#0c1118] p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Dialog.Description className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Logs
                      </Dialog.Description>
                      <Dialog.Title className="text-lg font-semibold text-white">
                        {activeLogService.name}
                      </Dialog.Title>
                    </div>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white transition hover:border-white/60"
                      >
                        Close
                      </button>
                    </Dialog.Close>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-200">
                    <code className="break-all text-[11px] text-slate-200">
                      tmux attach -r -t {TMUX_SESSION}:{activeLogService.name}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        const command = `tmux attach -r -t ${TMUX_SESSION}:${activeLogService.name}`;
                        try {
                          await navigator.clipboard.writeText(command);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        } catch {
                          setCopied(false);
                        }
                      }}
                      className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-white transition hover:border-white/60"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-slate-200">
                    <div ref={setTerminalContainer} className="logs-terminal h-full w-full" />
                    {displayLogs.length > 0 || logs ? null : (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">
                        Waiting for logs...
                      </div>
                    )}
                  </div>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          ) : null}
        </Dialog.Root>

        <Dialog.Root
          open={Boolean(activeConfigService)}
          onOpenChange={(open) => {
            if (!open) {
              setActiveConfigService(null);
              setActiveConfigDefinition(null);
              setConfigLoading(false);
            }
          }}
        >
          {activeConfigService ? (
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
              <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10 outline-none">
                <div className="flex h-[75vh] w-full max-w-4xl flex-col rounded-3xl border border-white/10 bg-[#0c1118] p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Dialog.Description className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Config Definition
                      </Dialog.Description>
                      <Dialog.Title className="text-lg font-semibold text-white">
                        {activeConfigService.name}
                      </Dialog.Title>
                    </div>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white transition hover:border-white/60"
                      >
                        Close
                      </button>
                    </Dialog.Close>
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300">
                    <p>Source: {activeConfigDefinition?.source ?? activeConfigService.source ?? "unknown"}</p>
                    <p className="mt-1 break-all text-slate-400">
                      {activeConfigDefinition?.path ?? "Loading path..."}
                    </p>
                  </div>
                  <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4">
                    {configLoading ? (
                      <p className="text-sm text-slate-400">Loading definition…</p>
                    ) : (
                      <pre className="whitespace-pre-wrap text-xs text-slate-200">
                        {formatConfigDefinition(activeConfigDefinition)}
                      </pre>
                    )}
                  </div>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          ) : null}
        </Dialog.Root>

        <Dialog.Root
          open={showForm}
          onOpenChange={(open) => {
            if (!open) {
              closeForm();
            }
          }}
        >
          {showForm ? (
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
              <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10 outline-none">
                <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0c1118] p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Dialog.Description className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        {formMode === "edit" ? "Edit Service" : "New Service"}
                      </Dialog.Description>
                      <Dialog.Title className="text-lg font-semibold text-white">
                        {formMode === "edit" ? "Update the dev server" : "Add a dev server"}
                      </Dialog.Title>
                    </div>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60"
                      >
                        Close
                      </button>
                    </Dialog.Close>
                  </div>

                  <div className="mt-6 grid gap-4">
                    {[
                      { label: "Name", key: "name", placeholder: "api" },
                      { label: "Working dir", key: "cwd", placeholder: "/Users/anton/Code/api" },
                      { label: "Command", key: "command", placeholder: "pnpm dev" }
                    ].map((field) => {
                      const isNameField = field.key === "name";
                      const isDisabled = formMode === "edit" && isNameField;
                      return (
                        <label
                          key={field.key}
                          className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400"
                        >
                          {field.label}
                          <input
                            type="text"
                            value={formState[field.key as keyof typeof formState]}
                            onChange={(event) =>
                              setFormState((prev) => ({
                                ...prev,
                                [field.key]: event.target.value
                              }))
                            }
                            placeholder={field.placeholder}
                            disabled={isDisabled}
                            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none transition focus:border-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </label>
                      );
                    })}

                    <div className="grid gap-2 text-xs uppercase tracking-widest text-slate-400">
                      Dependencies
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                        {availableDependencies.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No other services to depend on yet.
                          </p>
                        ) : (
                          <div className="grid gap-2">
                            {availableDependencies.map((name) => {
                              const checked = formState.dependsOn.includes(name);
                              return (
                                <label key={name} className="flex items-center gap-3 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => {
                                      const next = event.target.checked;
                                      setFormState((prev) => ({
                                        ...prev,
                                        dependsOn: next
                                          ? [...prev.dependsOn, name]
                                          : prev.dependsOn.filter((entry) => entry !== name)
                                      }));
                                    }}
                                    className="h-4 w-4 rounded border-white/20 bg-transparent text-emerald-400 focus:ring-2 focus:ring-emerald-300/60"
                                  />
                                  <span className="text-slate-200">{name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <label className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                      Port mode
                      <select
                        value={formState.portMode}
                        onChange={(event) =>
                          setFormState((prev) => ({
                            ...prev,
                            portMode: event.target.value as PortMode
                          }))
                        }
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none focus:border-emerald-400/60"
                      >
                        <option value="static">Static (use configured port)</option>
                        <option value="detect">Detect from logs</option>
                        <option value="registry">Port registry (use registry file)</option>
                      </select>
                    </label>

                    {formState.portMode === "static" ? (
                      <label className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                        Port
                        <input
                          type="text"
                          value={formState.port}
                          onChange={(event) =>
                            setFormState((prev) => ({
                              ...prev,
                              port: event.target.value
                            }))
                          }
                          placeholder="3000"
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none transition focus:border-emerald-400/60"
                        />
                      </label>
                    ) : null}

                    <label className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                      Env (KEY=VALUE per line, $PORT and ${"{PORT:service}"} supported)
                      <textarea
                        rows={4}
                        value={formState.env}
                        onChange={(event) =>
                          setFormState((prev) => ({ ...prev, env: event.target.value }))
                        }
                        placeholder={
                          "NODE_ENV=development\nPORT=$PORT\nAPI_URL=http://localhost:${PORT:api}\nNEXT_PUBLIC_URL=http://localhost:$PORT"
                        }
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none focus:border-emerald-400/60"
                      />
                    </label>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {formMode === "edit" && editingService ? (
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 transition hover:border-white/30 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete service
                      </button>
                    ) : null}
                    <div className="ml-auto flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        closeForm();
                      }}
                      disabled={isDeleting}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitForm}
                      disabled={isDeleting}
                      className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {formMode === "edit" ? "Save Changes" : "Save Service"}
                    </button>
                    </div>
                  </div>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          ) : null}
        </Dialog.Root>

        <Dialog.Root
          open={showProjectForm}
          onOpenChange={(open) => {
            if (!open) {
              closeProjectForm();
            }
          }}
        >
          {showProjectForm ? (
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
              <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10 outline-none">
                <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#0c1118] p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Dialog.Description className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Register Project
                      </Dialog.Description>
                      <Dialog.Title className="text-lg font-semibold text-white">
                        Add devservers-compose.yml project
                      </Dialog.Title>
                    </div>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60"
                      >
                        Close
                      </button>
                    </Dialog.Close>
                  </div>

                  <div className="mt-6 grid gap-4">
                    <label className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                      Name
                      <input
                        type="text"
                        value={projectFormState.name}
                        onChange={(event) =>
                          setProjectFormState((prev) => ({ ...prev, name: event.target.value }))
                        }
                        placeholder="academy"
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>

                    <label className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                      Path
                      <input
                        type="text"
                        value={projectFormState.path}
                        onChange={(event) =>
                          setProjectFormState((prev) => ({ ...prev, path: event.target.value }))
                        }
                        placeholder="/Users/anton/Code/academy"
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none transition focus:border-emerald-400/60"
                      />
                    </label>

                    <label className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-300">
                      <input
                        type="checkbox"
                        checked={projectFormState.isMonorepo}
                        onChange={(event) =>
                          setProjectFormState((prev) => ({
                            ...prev,
                            isMonorepo: event.target.checked
                          }))
                        }
                        className="h-4 w-4 rounded border-white/20 bg-transparent text-emerald-400 focus:ring-2 focus:ring-emerald-300/60"
                      />
                      Is monorepo
                    </label>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={closeProjectForm}
                      disabled={isSavingProject}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void submitProjectForm();
                      }}
                      disabled={isSavingProject}
                      className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save Project
                    </button>
                  </div>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          ) : null}
        </Dialog.Root>
      </div>
    </ErrorBoundary>
  );
}
