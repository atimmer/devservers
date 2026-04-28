import * as Dialog from "@radix-ui/react-dialog";
import React from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

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
import { trimTrailingBlankLogLines } from "./logs";

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

type MainSelection =
  | {
      type: "service";
      serviceName: string;
    }
  | {
      type: "working-copy";
      groupKey: string;
    };

const getPathName = (value?: string) => {
  if (!value) {
    return "Standalone";
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) {
    return "Standalone";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
};

const getWorkingDirectory = (service: ServiceInfo) => service.repo?.root ?? service.cwd;
const getLastStartedTimestamp = (service: ServiceInfo) => {
  const parsed = service.lastStartedAt ? Date.parse(service.lastStartedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};
const compareByMostRecentlyStarted = (a: ServiceInfo, b: ServiceInfo) => {
  const timeDiff = getLastStartedTimestamp(b) - getLastStartedTimestamp(a);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
};

const tokenizeQuery = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const fuzzyMatchTerm = (needle: string, haystack: string) => {
  if (!needle) {
    return true;
  }
  if (haystack.includes(needle)) {
    return true;
  }
  let position = -1;
  let first = -1;
  for (const char of needle) {
    const next = haystack.indexOf(char, position + 1);
    if (next === -1) {
      return false;
    }
    if (first === -1) {
      first = next;
    }
    if (position !== -1 && next - position > 4) {
      return false;
    }
    position = next;
  }
  const span = position - first + 1;
  const maxSpan = Math.max(needle.length + 4, needle.length * 2);
  return span <= maxSpan;
};

const fuzzyMatch = (query: string, ...values: Array<string | undefined>) => {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return true;
  }
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  if (!haystack) {
    return false;
  }
  return tokens.every((token) => fuzzyMatchTerm(token, haystack));
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
const isViewportAtBottom = (viewport: HTMLElement) =>
  viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 8;

const ServiceStatusPill = ({ status }: { status: ServiceStatus }) => (
  <span
    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusStyles[status]}`}
  >
    {status}
  </span>
);

const OpenIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
    <path
      d="M14 5h5v5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 14 19 5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19 13v5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ArrowDownIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
    <path
      d="M12 5v14"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="m6 13 6 6 6-6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
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
  const [selection, setSelection] = useState<MainSelection | null>(null);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [activeConfigService, setActiveConfigService] = useState<ServiceInfo | null>(null);
  const [activeConfigDefinition, setActiveConfigDefinition] = useState<ServiceConfigDefinition | null>(
    null
  );
  const [configLoading, setConfigLoading] = useState(false);
  const [logsByService, setLogsByService] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [terminalContainer, setTerminalContainer] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastLogPayloadRef = useRef("");
  const autoScrollEnabledRef = useRef(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [pendingStarts, setPendingStarts] = useState<string[]>([]);
  const [pendingStops, setPendingStops] = useState<string[]>([]);
  const [pendingRestarts, setPendingRestarts] = useState<string[]>([]);
  const [logErrors, setLogErrors] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [editingService, setEditingService] = useState<ServiceInfo | null>(null);
  const [serviceFormError, setServiceFormError] = useState<string | null>(null);
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

  const updateAutoScrollEnabled = useCallback((nextValue: boolean) => {
    autoScrollEnabledRef.current = nextValue;
    setAutoScrollEnabled((currentValue) => (currentValue === nextValue ? currentValue : nextValue));
  }, []);

  const writeLogsToTerminal = useCallback((nextLogs: string, force = false) => {
    const term = terminalRef.current;
    const renderLogs = trimTrailingBlankLogLines(nextLogs);
    if (!term) {
      lastLogPayloadRef.current = renderLogs;
      return;
    }
    const previous = lastLogPayloadRef.current;
    if (force || !previous || !renderLogs.startsWith(previous)) {
      term.reset();
      if (renderLogs) {
        term.write(renderLogs);
      }
    } else {
      const delta = renderLogs.slice(previous.length);
      if (delta) {
        term.write(delta);
      }
    }
    if (autoScrollEnabledRef.current) {
      term.scrollToBottom();
    }
    lastLogPayloadRef.current = renderLogs;
  }, []);

  const markLogError = useCallback((serviceName: string) => {
    setLogErrors((prev) => (prev.includes(serviceName) ? prev : [...prev, serviceName]));
  }, []);

  const storeLogs = useCallback((serviceName: string, nextLogs: string) => {
    setLogsByService((prev) =>
      prev[serviceName] === nextLogs ? prev : { ...prev, [serviceName]: nextLogs }
    );
  }, []);

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
        setLogsByService((prev) => {
          const next = Object.fromEntries(
            Object.entries(prev).filter(([name]) => serviceNames.has(name))
          );
          const prevNames = Object.keys(prev);
          const nextNames = Object.keys(next);
          if (
            prevNames.length === nextNames.length &&
            prevNames.every((name) => Object.hasOwn(next, name))
          ) {
            return prev;
          }
          return next;
        });
        setLogErrors((prev) => prev.filter((name) => serviceNames.has(name)));
        setLoading(false);
      });
    } catch (err) {
      startTransition(() => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    }
  }, []);

  const serviceByName = useMemo(
    () => new Map(services.map((service) => [service.name, service])),
    [services]
  );
  const selectedService = useMemo(() => {
    if (selection?.type !== "service") {
      return null;
    }
    return serviceByName.get(selection.serviceName) ?? null;
  }, [selection, serviceByName]);
  const selectedServiceName = selectedService?.name ?? null;
  const selectedServiceIsRunning = selectedService?.status === "running";
  const selectedServiceLogs = selectedServiceName ? logsByService[selectedServiceName] ?? "" : "";
  const selectedServiceShowsLogs = Boolean(selectedService);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  const previousSelectedServiceNameRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousSelectedServiceNameRef.current === selectedServiceName) {
      return;
    }
    previousSelectedServiceNameRef.current = selectedServiceName;
    setCopied(false);
    lastLogPayloadRef.current = trimTrailingBlankLogLines(selectedServiceLogs);
    updateAutoScrollEnabled(true);
    writeLogsToTerminal(selectedServiceLogs, true);
  }, [selectedServiceLogs, selectedServiceName, updateAutoScrollEnabled, writeLogsToTerminal]);

  useEffect(() => {
    if (!selectedServiceName || !selectedServiceShowsLogs || !terminalContainer) {
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
    const viewport = terminalContainer.querySelector(".xterm-viewport");
    const handleViewportScroll = () => {
      if (
        autoScrollEnabledRef.current &&
        viewport instanceof HTMLElement &&
        !isViewportAtBottom(viewport)
      ) {
        updateAutoScrollEnabled(false);
      }
    };

    if (viewport instanceof HTMLElement) {
      viewport.addEventListener("scroll", handleViewportScroll, { passive: true });
    }

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(terminalContainer);
      resizeObserverRef.current = resizeObserver;
    }

    updateAutoScrollEnabled(true);
    if (lastLogPayloadRef.current) {
      writeLogsToTerminal(lastLogPayloadRef.current, true);
    }

    return () => {
      if (viewport instanceof HTMLElement) {
        viewport.removeEventListener("scroll", handleViewportScroll);
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      term.dispose();
      terminalRef.current = null;
    };
  }, [
    selectedServiceName,
    selectedServiceShowsLogs,
    terminalContainer,
    updateAutoScrollEnabled,
    writeLogsToTerminal
  ]);

  useEffect(() => {
    if (!selectedServiceName || !selectedServiceIsRunning) {
      setCopied(false);
      updateAutoScrollEnabled(true);
      return;
    }

    lastLogPayloadRef.current = "";
    updateAutoScrollEnabled(true);
    const socket = createLogsSocket(selectedServiceName, 200, true);
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
            markLogError(selectedServiceName);
          }
          storeLogs(selectedServiceName, nextLogs);
          writeLogsToTerminal(nextLogs);
        }
      } catch {
        const nextLogs = String(event.data ?? "");
        storeLogs(selectedServiceName, nextLogs);
        writeLogsToTerminal(nextLogs, true);
      }
    };
    socket.onerror = () => {
      const message = "Failed to stream logs.";
      writeLogsToTerminal(message, true);
    };
    return () => socket.close();
  }, [
    selectedServiceName,
    selectedServiceIsRunning,
    markLogError,
    storeLogs,
    updateAutoScrollEnabled,
    writeLogsToTerminal
  ]);

  const handleAction = useCallback(
    async (action: "start" | "stop" | "restart", name: string) => {
      setError(null);
      if (action === "start" || action === "restart") {
        setLogErrors((prev) => prev.filter((serviceName) => serviceName !== name));
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
  const displayLogs = useMemo(() => selectedServiceLogs.replace(/\s+$/, ""), [selectedServiceLogs]);
  const sortedServices = useMemo(
    () =>
      [...services].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
      ),
    [services]
  );
  const dependencyOptions = useMemo(() => {
    return [...sortedServices.map((service) => service.name)];
  }, [sortedServices]);
  const startedServices = useMemo(
    () => services.filter((service) => service.status === "running").sort(compareByMostRecentlyStarted),
    [services]
  );
  const workingCopyGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      title: string;
      root: string;
      services: ServiceInfo[];
    }> = [];
    const groupMap = new Map<string, (typeof groups)[number]>();

    for (const service of services) {
      const root = getWorkingDirectory(service);
      const key = root;
      let group = groupMap.get(key);
      if (!group) {
        group = {
          key,
          title: getPathName(root),
          root,
          services: []
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      group.services.push(service);
    }

    for (const group of groups) {
      group.services.sort(compareByMostRecentlyStarted);
    }

    groups.sort((a, b) => {
      const aLatest = Math.max(...a.services.map(getLastStartedTimestamp), 0);
      const bLatest = Math.max(...b.services.map(getLastStartedTimestamp), 0);
      const latestDiff = bLatest - aLatest;
      if (latestDiff !== 0) {
        return latestDiff;
      }
      const titleCompare = a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
        numeric: true
      });
      if (titleCompare !== 0) {
        return titleCompare;
      }
      return a.root.localeCompare(b.root, undefined, {
        sensitivity: "base",
        numeric: true
      });
    });

    return groups;
  }, [services]);
  const workingCopyMap = useMemo(
    () => new Map(workingCopyGroups.map((group) => [group.key, group])),
    [workingCopyGroups]
  );
  const filteredStartedServices = useMemo(() => {
    return startedServices.filter((service) => fuzzyMatch(sidebarQuery, service.name));
  }, [startedServices, sidebarQuery]);
  const filteredWorkingCopyGroups = useMemo(() => {
    return workingCopyGroups
      .map((group) => {
        const nonRunningServices = group.services.filter((service) => service.status !== "running");
        const groupMatched = fuzzyMatch(sidebarQuery, group.title);
        if (groupMatched) {
          return {
            ...group,
            services: nonRunningServices
          };
        }
        const filteredServices = nonRunningServices.filter((service) =>
          fuzzyMatch(sidebarQuery, service.name)
        );
        return {
          ...group,
          services: filteredServices
        };
      })
      .filter((group) => group.services.length > 0);
  }, [workingCopyGroups, sidebarQuery]);
  const selectedWorkingCopy = useMemo(() => {
    if (selection?.type !== "working-copy") {
      return null;
    }
    return workingCopyMap.get(selection.groupKey) ?? null;
  }, [selection, workingCopyMap]);
  const visibleServices = useMemo(() => {
    if (selection?.type === "service") {
      return selectedService ? [selectedService] : [];
    }
    if (selection?.type === "working-copy") {
      return selectedWorkingCopy?.services ?? [];
    }
    return [];
  }, [selection, selectedService, selectedWorkingCopy]);
  const selectionLabel = useMemo(() => {
    if (selection?.type === "service" && selectedService) {
      return selectedService.name;
    }
    if (selection?.type === "working-copy" && selectedWorkingCopy) {
      return selectedWorkingCopy.title;
    }
    return "No selection";
  }, [selection, selectedService, selectedWorkingCopy]);
  const selectionDescription = useMemo(() => {
    if (selection?.type === "service" && selectedService) {
      return getWorkingDirectory(selectedService);
    }
    if (selection?.type === "working-copy" && selectedWorkingCopy) {
      return `${selectedWorkingCopy.services.length} services`;
    }
    return "";
  }, [selection, selectedService, selectedWorkingCopy]);
  useEffect(() => {
    if (sortedServices.length === 0) {
      setSelection(null);
      return;
    }
    setSelection((previous) => {
      if (previous?.type === "service" && serviceByName.has(previous.serviceName)) {
        return previous;
      }
      if (previous?.type === "working-copy" && workingCopyMap.has(previous.groupKey)) {
        return previous;
      }
      if (startedServices.length > 0) {
        return { type: "service", serviceName: startedServices[0].name };
      }
      return { type: "working-copy", groupKey: workingCopyGroups[0].key };
    });
  }, [sortedServices, startedServices, workingCopyGroups, serviceByName, workingCopyMap]);
  const projectByName = useMemo(
    () => new Map(projects.map((project) => [project.name, project])),
    [projects]
  );
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
    setServiceFormError(null);
    setIsDeleting(false);
    resetForm();
  };

  const submitForm = async () => {
    setError(null);
    setServiceFormError(null);
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
      setServiceFormError(err instanceof Error ? err.message : String(err));
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
    setServiceFormError(null);
    setIsDeleting(true);
    try {
      await deleteService(editingService.name);
      closeForm();
      await refresh();
    } catch (err) {
      setIsDeleting(false);
      setServiceFormError(err instanceof Error ? err.message : String(err));
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

  const unregisterProject = async (name: string) => {
    const confirmed = window.confirm(`Unregister project "${name}"?`);
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

  const openServiceEditor = useCallback((service: ServiceInfo) => {
    setFormMode("edit");
    setEditingService(service);
    setServiceFormError(null);
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
  }, []);

  const openServiceLogs = useCallback((service: ServiceInfo) => {
    setSelection({ type: "service", serviceName: service.name });
  }, []);

  const getProjectForService = useCallback(
    (service: ServiceInfo) => {
      if (service.projectName) {
        const byName = projectByName.get(service.projectName);
        if (byName) {
          return byName;
        }
      }
      for (const project of projects) {
        if (service.cwd === project.path || service.cwd.startsWith(`${project.path}/`)) {
          return project;
        }
      }
      return null;
    },
    [projectByName, projects]
  );
  return (
    <ErrorBoundary>
      <div className="relative min-h-full overflow-hidden bg-[#0b0e12] text-slate-100">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_20%_-10%,#233247,transparent_60%),radial-gradient(700px_circle_at_80%_10%,#2a1d2e,transparent_55%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-slate-950/70 to-transparent" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-6 px-4 py-4 lg:flex-row lg:px-6 lg:py-6">
          <aside className="w-full lg:order-2 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-80 lg:shrink-0">
            <div className="flex h-full max-h-[70vh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0c1118]/85 backdrop-blur lg:max-h-none">
              <div className="border-b border-white/10 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Services</p>
                <p className="mt-1 text-xs text-slate-500">{services.length} total</p>
                <label className="mt-3 block">
                  <span className="sr-only">Search services and working copies</span>
                  <input
                    type="search"
                    value={sidebarQuery}
                    onChange={(event) => {
                      setSidebarQuery(event.target.value);
                    }}
                    placeholder="Search services or working copies"
                    className="h-9 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-xs text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60"
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 space-y-0 overflow-x-hidden overflow-y-auto p-3">
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <p className="text-[10px] uppercase tracking-[0.26em] text-emerald-200">
                      Started
                    </p>
                    <p className="text-[11px] text-emerald-100/80">{filteredStartedServices.length}</p>
                  </div>
                  {filteredStartedServices.length === 0 ? (
                    <p className="px-2 text-xs text-slate-400">No started services found.</p>
                  ) : (
                    <div className="grid gap-0">
                      {filteredStartedServices.map((service) => {
                        const selected =
                          selection?.type === "service" && selection.serviceName === service.name;
                        return (
                          <button
                            key={service.name}
                            type="button"
                            onClick={() => {
                              setSelection({ type: "service", serviceName: service.name });
                            }}
                            className={`h-9 min-w-0 w-full rounded-xl border px-3 text-left text-xs transition ${
                              selected
                                ? "border-emerald-300/60 bg-emerald-400/20 text-emerald-100"
                                : "border-white/10 bg-white/5 text-slate-200 hover:border-emerald-300/30 hover:bg-emerald-500/10"
                            }`}
                            title={service.name}
                          >
                            <span className="block truncate leading-6">{service.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="mt-3 border-t border-white/10 pt-3 space-y-0 overflow-x-hidden">
                  {filteredWorkingCopyGroups.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4 text-xs text-slate-400">
                      No matching services or working copies.
                    </p>
                  ) : (
                    filteredWorkingCopyGroups.map((group) => {
                      const groupSelected =
                        selection?.type === "working-copy" && selection.groupKey === group.key;
                      const showHeader = group.services.length > 1;
                      return (
                        <div key={group.key} className="space-y-0">
                          {showHeader ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelection({ type: "working-copy", groupKey: group.key });
                              }}
                              className={`h-9 min-w-0 w-full rounded-xl px-2 text-left text-sm font-semibold transition ${
                                groupSelected
                                  ? "bg-white/15 text-white"
                                  : "text-slate-300 hover:bg-white/10 hover:text-white"
                              }`}
                              title={group.root}
                            >
                              <span className="block truncate leading-6">{group.title}</span>
                            </button>
                          ) : null}
                          <div className="grid gap-0 overflow-x-hidden">
                            {group.services.map((service) => {
                              const selected =
                                selection?.type === "service" && selection.serviceName === service.name;
                              return (
                                <button
                                  key={service.name}
                                  type="button"
                                  onClick={() => {
                                    setSelection({ type: "service", serviceName: service.name });
                                  }}
                                  className={`h-9 min-w-0 w-full rounded-lg border px-2.5 text-left text-xs transition ${
                                    selected
                                      ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
                                      : "border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5"
                                  }`}
                                  title={service.name}
                                >
                                  <span className="block truncate leading-6">{service.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </section>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1 pb-10 lg:order-1">
            <div className="grid gap-4">
              <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
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
                <div className="flex flex-wrap items-center gap-2">
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
                      setServiceFormError(null);
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

              <section className="grid gap-4">
                {loading ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-sm text-slate-300">
                    Loading services…
                  </div>
                ) : services.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-sm text-slate-300">
                    No services yet. Add one to get started.
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                        Main View
                      </p>
                      <p className="mt-1 text-lg font-semibold text-white">{selectionLabel}</p>
                      {selectionDescription ? (
                        <p className="mt-1 text-xs text-slate-400">{selectionDescription}</p>
                      ) : null}
                    </div>

                    {visibleServices.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-sm text-slate-300">
                        Select a service or working copy from the sidebar.
                      </div>
                    ) : (
                      <>
                        {visibleServices.map((service) => {
                          const status = displayStatus(service);
                          const linkedProject = getProjectForService(service);
                          const logsOpen =
                            selection?.type === "service" && selection.serviceName === service.name;
                          return (
                            <div key={service.name} className="overflow-hidden">
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
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                                      <span>{service.cwd}</span>
                                      {linkedProject ? (
                                        <>
                                          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                                            Working directory is project {linkedProject.name}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              void unregisterProject(linkedProject.name);
                                            }}
                                            className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 transition hover:border-white/50"
                                          >
                                            Unregister
                                          </button>
                                        </>
                                      ) : null}
                                    </div>
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
                                            openServiceEditor(service);
                                          }}
                                          className="h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
                                        >
                                          Edit
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          openServiceLogs(service);
                                        }}
                                        disabled={logsOpen}
                                        className={`h-9 w-full rounded-full border px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] transition ${
                                          logsOpen
                                            ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
                                            : "border-white/20 text-white hover:border-white/60"
                                        } disabled:cursor-not-allowed disabled:opacity-80`}
                                      >
                                        {logsOpen ? "Logs Open" : "Logs"}
                                      </button>
                                      {service.port ? (
                                        <a
                                          href={buildServiceUrl(service) ?? undefined}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex h-9 w-full items-center justify-center rounded-full border border-white/20 px-3 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
                                        >
                                          <span className="inline-flex items-center gap-2">
                                            Open
                                            <OpenIcon className="h-5 w-5" />
                                          </span>
                                        </a>
                                      ) : (
                                        <button
                                          type="button"
                                          className="h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-slate-400"
                                          disabled
                                        >
                                          Open
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {selectedServiceShowsLogs && selectedService ? (
                      <section className="flex h-[65vh] min-h-[360px] flex-col rounded-3xl border border-white/10 bg-[#0c1118] p-6">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Logs</p>
                            <h3 className="text-lg font-semibold text-white">{selectedService.name}</h3>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-200">
                          <code className="break-all text-[11px] text-slate-200">
                            tmux attach -r -t {TMUX_SESSION}:{selectedService.name}
                          </code>
                          <button
                            type="button"
                            onClick={async () => {
                              const command = `tmux attach -r -t ${TMUX_SESSION}:${selectedService.name}`;
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
                          {displayLogs.length === 0 ? (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">
                              {selectedServiceIsRunning
                                ? "Waiting for logs..."
                                : "No logs captured yet."}
                            </div>
                          ) : null}
                          <div className="pointer-events-none absolute bottom-5 right-10 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                updateAutoScrollEnabled(true);
                                terminalRef.current?.scrollToBottom();
                              }}
                              className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] shadow-[0_12px_30px_rgba(2,6,23,0.45)] transition ${
                                autoScrollEnabled
                                  ? "border border-white/15 bg-slate-950/75 text-slate-300 hover:border-white/30 hover:bg-slate-900"
                                  : "border border-sky-400/40 bg-slate-950/90 text-sky-100 hover:border-sky-300/70 hover:bg-slate-900"
                              }`}
                            >
                              <ArrowDownIcon className="h-4 w-4" />
                              {autoScrollEnabled ? "Following" : "Resume Follow"}
                            </button>
                          </div>
                        </div>
                      </section>
                    ) : null}
                  </>
                )}
              </section>
            </div>
          </main>
        </div>

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
              <Dialog.Content className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-6 outline-none sm:items-center sm:px-6 sm:py-10">
                <div className="flex w-full max-w-2xl max-h-[calc(100vh-3rem)] min-h-0 flex-col rounded-3xl border border-white/10 bg-[#0c1118] p-6 sm:max-h-[calc(100vh-5rem)]">
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

                  {serviceFormError ? (
                    <div
                      role="alert"
                      className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
                    >
                      {serviceFormError}
                    </div>
                  ) : null}

                  <div className="mt-6 min-h-0 flex-1 grid gap-4 overflow-y-auto pr-1">
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
                          <div className="grid max-h-40 gap-2 overflow-y-auto pr-1">
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
