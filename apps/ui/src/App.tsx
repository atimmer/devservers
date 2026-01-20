import * as Dialog from "@radix-ui/react-dialog";
import React from "react";

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
  addService,
  createLogsSocket,
  getServices,
  restartService,
  startService,
  stopService,
  updateService,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLogService, setActiveLogService] = useState<ServiceInfo | null>(null);
  const [logs, setLogs] = useState("");
  const [copied, setCopied] = useState(false);
  const logsRef = useRef<HTMLPreElement | null>(null);
  const shouldScrollRef = useRef(false);
  const [pendingStarts, setPendingStarts] = useState<string[]>([]);
  const pendingStartsRef = useRef<string[]>([]);
  const [pendingStops, setPendingStops] = useState<string[]>([]);
  const [pendingRestarts, setPendingRestarts] = useState<string[]>([]);
  const [startFailures, setStartFailures] = useState<string[]>([]);
  const [logHighlights, setLogHighlights] = useState<string[]>([]);
  const lastStartedAtRef = useRef<Record<string, string | undefined>>({});
  const startFailuresRef = useRef<string[]>([]);
  const errorServicesRef = useRef<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [editingService, setEditingService] = useState<ServiceInfo | null>(null);
  const [formState, setFormState] = useState({
    name: "",
    cwd: "",
    command: "",
    port: "",
    env: "",
    portMode: "static" as PortMode
  });

  useEffect(() => {
    pendingStartsRef.current = pendingStarts;
  }, [pendingStarts]);

  useEffect(() => {
    startFailuresRef.current = startFailures;
  }, [startFailures]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await getServices();
      const serviceNames = new Set(data.map((service) => service.name));
      const serviceByName = new Map(data.map((service) => [service.name, service]));
      const statusErrors = new Set(
        data.filter((service) => service.status === "error").map((service) => service.name)
      );
      const failedStarts = new Set<string>();
      const nextLastStartedAt: Record<string, string | undefined> = {};
      for (const service of data) {
        nextLastStartedAt[service.name] = service.lastStartedAt;
      }

      for (const name of pendingStartsRef.current) {
        const service = serviceByName.get(name);
        if (!service) {
          continue;
        }
        const lastStartedAt = service.lastStartedAt;
        const lastStartedChanged =
          Boolean(lastStartedAt) && lastStartedAt !== lastStartedAtRef.current[name];
        if (service.status === "error" || (service.status === "stopped" && lastStartedChanged)) {
          failedStarts.add(name);
        }
      }
      const nextStartFailures = new Set(
        startFailuresRef.current.filter((name) => serviceNames.has(name))
      );
      for (const service of data) {
        if (service.status === "running") {
          nextStartFailures.delete(service.name);
        }
      }
      for (const name of statusErrors) {
        nextStartFailures.add(name);
      }
      for (const name of failedStarts) {
        nextStartFailures.add(name);
      }
      const currentErrorNames = new Set(nextStartFailures);
      const newErrorNames = new Set(
        Array.from(currentErrorNames).filter((name) => !errorServicesRef.current.has(name))
      );

      startTransition(() => {
        setServices(data);
        setPendingStarts((prev) =>
          prev.filter((name) => {
            if (!serviceNames.has(name)) {
              return false;
            }
            if (failedStarts.has(name)) {
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
        setStartFailures(Array.from(nextStartFailures));
        setLogHighlights((prev) => {
          const next = new Set(prev.filter((name) => serviceNames.has(name)));
          for (const name of newErrorNames) {
            next.add(name);
          }
          return Array.from(next);
        });
        setLoading(false);
      });
      errorServicesRef.current = currentErrorNames;
      lastStartedAtRef.current = nextLastStartedAt;
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
    if (!activeLogService) {
      setLogs("");
      setCopied(false);
      shouldScrollRef.current = false;
      return;
    }

    setLogs("");
    shouldScrollRef.current = true;
    const socket = createLogsSocket(activeLogService.name, 200);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type: string; payload: string };
        if (payload.type === "logs") {
          setLogs(payload.payload ?? "");
        }
      } catch {
        setLogs(String(event.data ?? ""));
      }
    };
    socket.onerror = () => {
      setLogs("Failed to stream logs.");
    };
    return () => socket.close();
  }, [activeLogService]);

  const handleAction = useCallback(
    async (action: "start" | "stop" | "restart", name: string) => {
      setError(null);
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

  const statusSummary = useMemo(() => {
    const counts = services.reduce(
      (acc, service) => {
        acc[service.status] += 1;
        return acc;
      },
      { running: 0, stopped: 0, error: 0 }
    );
    return counts;
  }, [services]);
  const startFailureSet = useMemo(() => new Set(startFailures), [startFailures]);
  const logHighlightSet = useMemo(() => new Set(logHighlights), [logHighlights]);
  const displayLogs = useMemo(() => logs.replace(/\s+$/, ""), [logs]);

  useEffect(() => {
    if (!activeLogService || !shouldScrollRef.current || displayLogs.length === 0) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      const container = logsRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      shouldScrollRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeLogService, displayLogs]);

  const resetForm = () =>
    setFormState({
      name: "",
      cwd: "",
      command: "",
      port: "",
      env: "",
      portMode: "static"
    });
  const closeForm = () => {
    setShowForm(false);
    setFormMode("add");
    setEditingService(null);
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
      env: parseEnv(formState.env)
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
              services.map((service) => (
                <ViewTransition key={service.name}>
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                          <h2 className="text-xl font-semibold text-white">{service.name}</h2>
                          <ServiceStatusPill
                            status={startFailureSet.has(service.name) ? "error" : service.status}
                          />
                        </div>
                        <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
                          {service.command}
                        </div>
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
                          {service.env && Object.keys(service.env).length > 0 ? (
                            <span>{Object.keys(service.env).length} env vars</span>
                          ) : null}
                        </div>
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
                                portMode: service.portMode ?? "static"
                              });
                              setShowForm(true);
                            }}
                            className="h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
                          >
                            Edit
                          </button>
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
                </ViewTransition>
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
              <Dialog.Overlay className="fixed inset-0 z-20 bg-black/60" />
              <Dialog.Content className="fixed inset-0 z-20 flex items-end justify-center px-6 py-10 outline-none">
                <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#0c1118] p-6">
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
                  <pre
                    ref={logsRef}
                    className="mt-4 max-h-[50vh] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-slate-200"
                  >
                    {displayLogs.length > 0 ? displayLogs : logs ? "" : "Waiting for logs..."}
                  </pre>
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
              <Dialog.Overlay className="fixed inset-0 z-20 bg-black/60" />
              <Dialog.Content className="fixed inset-0 z-20 flex items-center justify-center px-6 py-10 outline-none">
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
                      { label: "Command", key: "command", placeholder: "pnpm dev" },
                      { label: "Port", key: "port", placeholder: "3000" }
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

                    <label className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                      Env (KEY=VALUE per line, $PORT supported)
                      <textarea
                        rows={4}
                        value={formState.env}
                        onChange={(event) =>
                          setFormState((prev) => ({ ...prev, env: event.target.value }))
                        }
                        placeholder={
                          "NODE_ENV=development\nPORT=$PORT\nNEXT_PUBLIC_URL=http://localhost:$PORT"
                        }
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none focus:border-emerald-400/60"
                      />
                    </label>
                  </div>

                  <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        closeForm();
                      }}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitForm}
                      className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-950 transition hover:bg-emerald-400"
                    >
                      {formMode === "edit" ? "Save Changes" : "Save Service"}
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
