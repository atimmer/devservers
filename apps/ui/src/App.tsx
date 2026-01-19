import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [pendingStops, setPendingStops] = useState<string[]>([]);
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

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await getServices();
      setServices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (pendingStarts.length === 0) {
      return;
    }
    const resolved = new Set(
      services
        .filter(
          (service) =>
            pendingStarts.includes(service.name) &&
            (service.status === "running" || service.status === "error")
        )
        .map((service) => service.name)
    );
    if (resolved.size === 0) {
      return;
    }
    setPendingStarts((prev) => prev.filter((name) => !resolved.has(name)));
  }, [pendingStarts, services]);

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
      try {
        if (action === "start") {
          await startService(name);
        } else if (action === "stop") {
          await stopService(name);
        } else {
          await restartService(name);
        }
        await refresh();
        if (action === "stop") {
          setPendingStops((prev) => prev.filter((pending) => pending !== name));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (action === "start") {
          setPendingStarts((prev) => prev.filter((pending) => pending !== name));
        }
        if (action === "stop") {
          setPendingStops((prev) => prev.filter((pending) => pending !== name));
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
    <div className="relative min-h-full overflow-hidden bg-[#0b0e12] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_20%_-10%,#233247,transparent_60%),radial-gradient(700px_circle_at_80%_10%,#2a1d2e,transparent_55%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-slate-950/70 to-transparent" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-10">
        <header className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                Local Orchestration
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">Devservers</h1>
              <p className="mt-3 max-w-2xl text-sm text-slate-300">
                Start, stop, and track local dev servers from a single tmux session. Logs stay
                grouped; visibility stays clean.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFormMode("add");
                setEditingService(null);
                resetForm();
                setShowForm(true);
              }}
              className="rounded-full border border-slate-500/40 bg-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 hover:bg-white/20"
            >
              Add Service
            </button>
          </div>

          <div className="flex flex-wrap gap-4">
            {([
              ["running", statusSummary.running],
              ["stopped", statusSummary.stopped],
              ["error", statusSummary.error]
            ] as const).map(([label, value]) => (
              <div
                key={label}
                className="flex min-w-[140px] items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">{label}</span>
                <span className="text-lg font-semibold text-white">{value}</span>
              </div>
            ))}
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
            services.map((service) => (
              <div
                key={service.name}
                className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_40px_rgba(0,0,0,0.2)]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-semibold text-white">{service.name}</h2>
                      <ServiceStatusPill status={service.status} />
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
                      {service.status === "running" ? null : (
                        <ActionButton
                          label="Start"
                          variant="start"
                          onClick={() => handleAction("start", service.name)}
                          isLoading={pendingStarts.includes(service.name)}
                          disabled={pendingStarts.includes(service.name)}
                          className="w-full justify-center"
                        />
                      )}
                      {service.status === "stopped" ? null : (
                        <ActionButton
                          label="Stop"
                          variant="stop"
                          onClick={() => handleAction("stop", service.name)}
                          isLoading={pendingStops.includes(service.name)}
                          disabled={pendingStops.includes(service.name)}
                          spinnerClassName="opacity-100 transition-opacity delay-100 start:opacity-0"
                          className="w-full justify-center"
                        />
                      )}
                      <ActionButton
                        label="Restart"
                        variant="restart"
                        onClick={() => handleAction("restart", service.name)}
                        className="w-full justify-center"
                      />
                    </div>
                    <div className="grid w-[140px] max-w-full content-start items-start gap-2">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        Utilities
                      </p>
                      {service.status === "running" && service.port ? (
                        <button
                          type="button"
                          onClick={() => {
                            const url = buildServiceUrl(service);
                            if (!url) {
                              return;
                            }
                            window.open(url, "_blank", "noopener,noreferrer");
                          }}
                          className="h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
                        >
                          Open
                        </button>
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
                        onClick={() => setActiveLogService(service)}
                        className="h-9 w-full rounded-full border border-white/20 px-3 py-0 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-white transition hover:border-white/60"
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
            ))
          )}
        </section>
      </div>

      {activeLogService ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 px-6 py-10">
          <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#0c1118] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Logs</p>
                <h3 className="text-lg font-semibold text-white">{activeLogService.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveLogService(null)}
                className="rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white transition hover:border-white/60"
              >
                Close
              </button>
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
        </div>
      ) : null}

      {showForm ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-6 py-10">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0c1118] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  {formMode === "edit" ? "Edit Service" : "New Service"}
                </p>
                <h3 className="text-lg font-semibold text-white">
                  {formMode === "edit" ? "Update the dev server" : "Add a dev server"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  closeForm();
                }}
                className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60"
              >
                Close
              </button>
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
                  onChange={(event) => setFormState((prev) => ({ ...prev, env: event.target.value }))}
                  placeholder={"NODE_ENV=development\nPORT=$PORT\nNEXT_PUBLIC_URL=http://localhost:$PORT"}
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
        </div>
      ) : null}
    </div>
  );
}
