import type { ServiceInfo, ServiceStatus } from "../api";
import { statusDetail, statusLabel } from "../dashboard";

const styles: Record<ServiceStatus, string> = {
  starting: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  running: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  stopped: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  exited: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  error: "border-rose-400/30 bg-rose-400/10 text-rose-200",
};

export const StatusDot = ({ status }: { status: ServiceStatus }) => (
  <span
    className={`h-2 w-2 shrink-0 rounded-full ${styles[status].split(" ")[1]}`}
    aria-label={statusLabel(status)}
  />
);

export const ServiceStatusPill = ({ service }: { service: ServiceInfo }) => {
  const detail = statusDetail(service);
  return (
    <span
      title={detail ?? undefined}
      className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium ${styles[service.status]}`}
    >
      {statusLabel(service.status)}
      {service.status === "exited" && service.exitCode !== undefined
        ? ` · ${service.exitCode}`
        : ""}
    </span>
  );
};
