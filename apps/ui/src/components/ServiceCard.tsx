import type { RegisteredProject, ServiceInfo } from "../api";
import { formatWorkspace, statusDetail } from "../dashboard";
import { ServiceStatusPill } from "./Status";

export type ServiceAction = "start" | "stop" | "restart";

type Props = {
  service: ServiceInfo;
  project: RegisteredProject | null;
  pendingAction: ServiceAction | null;
  onAction: (action: ServiceAction, service: ServiceInfo) => void;
  onEdit: (service: ServiceInfo) => void;
  onConfig: (service: ServiceInfo) => void;
  onUnregister: (name: string) => void;
};

const serviceUrl = (service: ServiceInfo) =>
  service.port
    ? `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname}:${service.port}`
    : null;

export function ServiceCard({
  service,
  project,
  pendingAction,
  onAction,
  onEdit,
  onConfig,
  onUnregister,
}: Props) {
  const busy = pendingAction !== null || service.status === "starting";
  const detail = statusDetail(service);
  const url = serviceUrl(service);
  return (
    <article className="border border-white/10 bg-[#0e141c]">
      <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{service.name}</h2>
            <ServiceStatusPill service={service} />
          </div>
          {detail ? (
            <p
              className={`mt-2 text-xs ${service.status === "error" ? "text-rose-300" : service.status === "exited" ? "text-amber-200" : "text-slate-400"}`}
            >
              {detail}
            </p>
          ) : null}
          <code className="mt-3 block break-all font-mono text-xs text-cyan-100/80">
            {service.command}
          </code>
          <code className="mt-1 block break-all font-mono text-[11px] text-slate-500">
            {service.cwd}
          </code>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span>{service.port ? `Port ${service.port}` : "No port"}</span>
            <span>{service.portMode ?? "static"} port</span>
            <span>
              {service.source === "compose"
                ? `Compose${service.projectName ? ` · ${service.projectName}` : ""}`
                : "Config"}
            </span>
            {service.repo ? <span>Workspace {formatWorkspace(service.repo.workspace)}</span> : null}
            {service.dependsOn?.length ? (
              <span>Depends on {service.dependsOn.join(", ")}</span>
            ) : null}
          </div>
          {project ? (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span>Registered as {project.name}</span>
              <button
                type="button"
                onClick={() => onUnregister(project.name)}
                className="text-slate-300 underline decoration-white/20 underline-offset-2 hover:text-white"
              >
                Unregister
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 xl:max-w-xs xl:justify-end">
          {service.status !== "running" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("start", service)}
              className="button-primary"
            >
              {pendingAction === "start" ? "Starting…" : "Start"}
            </button>
          ) : null}
          {service.status !== "stopped" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("stop", service)}
              className="button-danger"
            >
              {pendingAction === "stop" ? "Stopping…" : "Stop"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction("restart", service)}
            className="button-warning"
          >
            {pendingAction === "restart" ? "Restarting…" : "Restart"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (service.source === "compose" ? onConfig(service) : onEdit(service))}
            className="button-secondary"
          >
            {service.source === "compose" ? "Config" : "Edit"}
          </button>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="button-secondary">
              Open ↗
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
