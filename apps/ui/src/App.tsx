import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addService,
  createLogsSocket,
  getServices,
  restartService,
  startService,
  stopService,
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
  variant
}: {
  label: string;
  onClick: () => void;
  variant: "start" | "stop" | "restart";
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
      className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${styles}`}
    >
      {label}
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
  const [showForm, setShowForm] = useState(false);
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

  const submitForm = async () => {
    setError(null);
    const payload = {
      name: formState.name.trim(),
      cwd: formState.cwd.trim(),
      command: formState.command.trim(),
      port: formState.port ? Number(formState.port) : undefined,
      portMode: formState.portMode,
      env: parseEnv(formState.env)
    };

    try {
      await addService(payload);
      resetForm();
      setShowForm(false);
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
              onClick={() => setShowForm(true)}
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
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
                      {service.port ? <span>Port {service.port}</span> : <span>No port yet</span>}
                      <span>Mode {portModeLabels[service.portMode ?? "static"]}</span>
                      {service.env && Object.keys(service.env).length > 0 ? (
                        <span>{Object.keys(service.env).length} env vars</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {service.status === "running" ? null : (
                      <ActionButton
                        label="Start"
                        variant="start"
                        onClick={() => handleAction("start", service.name)}
                      />
                    )}
                    <ActionButton
                      label="Restart"
                      variant="restart"
                      onClick={() => handleAction("restart", service.name)}
                    />
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
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60"
                      >
                        Open
                      </button>
                    ) : null}
                    {service.status === "stopped" ? null : (
                      <ActionButton
                        label="Stop"
                        variant="stop"
                        onClick={() => handleAction("stop", service.name)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveLogService(service)}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60"
                    >
                      Logs
                    </button>
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
                className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60"
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
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">New Service</p>
                <h3 className="text-lg font-semibold text-white">Add a dev server</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
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
              ].map((field) => (
                <label key={field.key} className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
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
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none focus:border-emerald-400/60"
                  />
                </label>
              ))}

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
                  <option value="registry">Port registry (coming soon)</option>
                </select>
              </label>

              <label className="grid gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                Env (KEY=VALUE per line)
                <textarea
                  rows={4}
                  value={formState.env}
                  onChange={(event) => setFormState((prev) => ({ ...prev, env: event.target.value }))}
                  placeholder="NODE_ENV=development"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm tracking-normal text-white outline-none focus:border-emerald-400/60"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
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
                Save Service
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
