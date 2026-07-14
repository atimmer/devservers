import { useMemo } from "react";
import type { ServiceInfo } from "../api";
import {
  compareByMostRecentlyStarted,
  fuzzyMatch,
  isServiceActive,
  type MainSelection,
  type WorkingCopyGroup,
} from "../dashboard";
import { StatusDot } from "./Status";

type Props = {
  services: ServiceInfo[];
  groups: WorkingCopyGroup[];
  query: string;
  selection: MainSelection | null;
  onQueryChange: (value: string) => void;
  onSelect: (selection: MainSelection) => void;
};

const ServiceRow = ({
  service,
  selected,
  nested,
  onSelect,
}: {
  service: ServiceInfo;
  selected: boolean;
  nested?: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs transition ${nested ? "pl-5" : ""} ${selected ? "bg-cyan-300/12 text-cyan-100" : "text-slate-300 hover:bg-white/6 hover:text-white"}`}
    title={`${service.name} · ${service.status}`}
  >
    <StatusDot status={service.status} />
    <span className="min-w-0 flex-1 truncate">{service.name}</span>
    {service.status === "starting" ? (
      <span className="h-3 w-3 animate-spin rounded-full border border-sky-300 border-t-transparent" />
    ) : null}
  </button>
);

export function Sidebar({ services, groups, query, selection, onQueryChange, onSelect }: Props) {
  const startedServices = useMemo(
    () =>
      services
        .filter(
          (service) =>
            isServiceActive(service.status) && fuzzyMatch(query, service.name, service.command),
        )
        .sort(compareByMostRecentlyStarted),
    [query, services],
  );
  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          services: fuzzyMatch(query, group.title, group.root)
            ? group.services
            : group.services.filter((service) => fuzzyMatch(query, service.name, service.command)),
        }))
        .filter((group) => group.services.length > 0),
    [groups, query],
  );

  return (
    <aside className="w-full lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:w-72 lg:shrink-0">
      <div className="flex max-h-[42vh] flex-col overflow-hidden border border-white/10 bg-[#0d131b]/95 lg:h-full lg:max-h-none">
        <div className="border-b border-white/10 p-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-white">Services</h2>
            <span className="text-[11px] text-slate-500">{services.length}</span>
          </div>
          <label className="mt-3 block">
            <span className="sr-only">Search services and working copies</span>
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Filter services…"
              className="h-9 w-full border border-white/10 bg-black/20 px-3 text-xs text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/50"
            />
          </label>
        </div>
        {startedServices.length > 0 ? (
          <section className="border-b border-emerald-300/15 bg-emerald-300/[0.035] p-2">
            <div className="flex items-center justify-between px-2 pb-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                Started
              </h3>
              <span className="font-mono text-[10px] text-emerald-300/70">
                {startedServices.length}
              </span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto" aria-label="Started services">
              {startedServices.map((service) => (
                <ServiceRow
                  key={service.name}
                  service={service}
                  selected={
                    selection?.type === "service" && selection.serviceName === service.name
                  }
                  onSelect={() => onSelect({ type: "service", serviceName: service.name })}
                />
              ))}
            </div>
          </section>
        ) : null}
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Services by working copy">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              All services
            </span>
          </div>
          {filteredGroups.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">No matching services.</p>
          ) : (
            filteredGroups.map((group) => {
              const onlyService = group.services.length === 1 ? group.services[0] : null;
              const showGroup = !onlyService || group.title !== onlyService.name;
              const selected =
                selection?.type === "working-copy" && selection.groupKey === group.key;
              const running = group.services.filter((service) =>
                isServiceActive(service.status),
              ).length;
              return (
                <section key={group.key} className="mb-2">
                  {showGroup ? (
                    <button
                      type="button"
                      onClick={() => onSelect({ type: "working-copy", groupKey: group.key })}
                      title={group.root}
                      className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left ${selected ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        className="h-4 w-4 shrink-0 text-slate-500"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h4l1.5 2H16A1.5 1.5 0 0 1 17.5 6.5v8A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-10Z" />
                      </svg>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {group.title}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {running}/{group.services.length}
                      </span>
                    </button>
                  ) : null}
                  <div className={showGroup ? "ml-3 border-l border-white/8 pl-1" : ""}>
                    {group.services.map((service) => (
                      <ServiceRow
                        key={service.name}
                        service={service}
                        nested={showGroup}
                        selected={
                          selection?.type === "service" && selection.serviceName === service.name
                        }
                        onSelect={() => onSelect({ type: "service", serviceName: service.name })}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </nav>
      </div>
    </aside>
  );
}
