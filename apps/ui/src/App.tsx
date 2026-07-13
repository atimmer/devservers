import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  addProject,
  addService,
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
  type ServiceInput,
} from "./api";
import { ConfigDialog, ProjectDialog, ServiceDialog } from "./components/Dialogs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { ServiceCard, type ServiceAction } from "./components/ServiceCard";
import {
  getStopImpact,
  getWorkingDirectory,
  groupServices,
  isServiceActive,
  summarizeAction,
  type MainSelection,
} from "./dashboard";

type Notice = { id: number; kind: "success" | "error"; message: string };
const selectionKey = "devservers.selection";
const LogsPanel = lazy(() =>
  import("./components/LogsPanel").then((module) => ({ default: module.LogsPanel })),
);

const readSelection = (): MainSelection | null => {
  try {
    const value = JSON.parse(localStorage.getItem(selectionKey) ?? "null") as unknown;
    if (typeof value !== "object" || value === null || !("type" in value)) return null;
    if (value.type === "service" && "serviceName" in value && typeof value.serviceName === "string")
      return { type: "service", serviceName: value.serviceName };
    if (value.type === "working-copy" && "groupKey" in value && typeof value.groupKey === "string")
      return { type: "working-copy", groupKey: value.groupKey };
  } catch {
    return null;
  }
  return null;
};

function AppContent() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [projects, setProjects] = useState<RegisteredProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<MainSelection | null>(readSelection);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Record<string, ServiceAction>>({});
  const [notices, setNotices] = useState<Notice[]>([]);
  const [editingService, setEditingService] = useState<ServiceInfo | null>(null);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [configService, setConfigService] = useState<ServiceInfo | null>(null);
  const [configDefinition, setConfigDefinition] = useState<ServiceConfigDefinition | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  const addNotice = useCallback((kind: Notice["kind"], message: string, replacePrefix?: string) => {
    setNotices((current) => [
      ...current.filter((notice) => !replacePrefix || !notice.message.startsWith(replacePrefix)),
      { id: Date.now() + Math.random(), kind, message },
    ]);
  }, []);

  const refresh = useCallback(
    async (initial = false) => {
      try {
        const [nextServices, nextProjects] = await Promise.all([getServices(), getProjects()]);
        startTransition(() => {
          setServices(nextServices);
          setProjects(nextProjects);
          setLoading(false);
          setNotices((current) =>
            current.filter((notice) => !notice.message.startsWith("Refresh failed:")),
          );
        });
      } catch (cause) {
        if (initial) setLoading(false);
        addNotice(
          "error",
          `Refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          "Refresh failed:",
        );
      }
    },
    [addNotice],
  );

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const groups = useMemo(() => groupServices(services), [services]);
  const serviceMap = useMemo(
    () => new Map(services.map((service) => [service.name, service])),
    [services],
  );
  const groupMap = useMemo(() => new Map(groups.map((group) => [group.key, group])), [groups]);
  const selectedService =
    selection?.type === "service" ? (serviceMap.get(selection.serviceName) ?? null) : null;
  const selectedGroup =
    selection?.type === "working-copy" ? (groupMap.get(selection.groupKey) ?? null) : null;
  const visibleServices = selectedService ? [selectedService] : (selectedGroup?.services ?? []);

  const select = useCallback((next: MainSelection) => {
    setSelection(next);
    localStorage.setItem(selectionKey, JSON.stringify(next));
  }, []);

  useEffect(() => {
    if (services.length === 0) {
      setSelection(null);
      return;
    }
    if (selection?.type === "service" && serviceMap.has(selection.serviceName)) return;
    if (selection?.type === "working-copy" && groupMap.has(selection.groupKey)) return;
    const running = services.find((service) => isServiceActive(service.status));
    select(
      running
        ? { type: "service", serviceName: running.name }
        : { type: "working-copy", groupKey: groups[0].key },
    );
  }, [groupMap, groups, select, selection, serviceMap, services]);

  const projectFor = useCallback(
    (service: ServiceInfo) =>
      projects.find(
        (project) =>
          project.name === service.projectName ||
          service.cwd === project.path ||
          service.cwd.startsWith(`${project.path}/`),
      ) ?? null,
    [projects],
  );

  const runAction = useCallback(
    async (action: ServiceAction, service: ServiceInfo) => {
      if (pending[service.name]) return;
      if (action === "stop") {
        const impact = getStopImpact(services, service.name).filter(
          (name) => serviceMap.get(name)?.status !== "stopped",
        );
        if (
          impact.length > 1 &&
          !window.confirm(
            `Stopping ${service.name} also stops dependents: ${impact.slice(1).join(", ")}. Continue?`,
          )
        )
          return;
      }
      setPending((current) => ({ ...current, [service.name]: action }));
      try {
        const result =
          action === "start"
            ? await startService(service.name)
            : action === "stop"
              ? await stopService(service.name)
              : await restartService(service.name);
        addNotice("success", summarizeAction(result));
        await refresh();
      } catch (cause) {
        addNotice(
          "error",
          `${action} ${service.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      } finally {
        setPending((current) => {
          const next = { ...current };
          delete next[service.name];
          return next;
        });
      }
    },
    [addNotice, pending, refresh, serviceMap, services],
  );

  const saveService = async (input: ServiceInput, restart: boolean) => {
    if (editingService) {
      await updateService(editingService.name, input);
      if (restart) addNotice("success", summarizeAction(await restartService(editingService.name)));
      else addNotice("success", `Saved ${editingService.name}.`);
    } else {
      await addService(input);
      addNotice("success", `Added ${input.name}.`);
    }
    setServiceDialogOpen(false);
    setEditingService(null);
    await refresh();
  };

  const removeService = async (service: ServiceInfo) => {
    const result = await deleteService(service.name);
    addNotice("success", `${summarizeAction(result)} Its managed process was stopped.`);
    setServiceDialogOpen(false);
    setEditingService(null);
    await refresh();
  };

  const openConfig = async (service: ServiceInfo) => {
    setConfigService(service);
    setConfigDefinition(null);
    setConfigLoading(true);
    try {
      setConfigDefinition(await getServiceConfigDefinition(service.name));
    } catch (cause) {
      addNotice(
        "error",
        `Config failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setConfigLoading(false);
    }
  };

  const counts = useMemo(
    () => ({
      running: services.filter((service) => isServiceActive(service.status)).length,
      attention: services.filter(
        (service) => service.status === "error" || service.status === "exited",
      ).length,
    }),
    [services],
  );
  const title = selectedService?.name ?? selectedGroup?.title ?? "Dev servers";
  const subtitle = selectedService
    ? getWorkingDirectory(selectedService)
    : (selectedGroup?.root ?? "Choose a service from the sidebar");

  return (
    <div className="relative min-h-full bg-[#090d12] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(800px_circle_at_10%_-10%,rgba(20,80,100,.24),transparent_55%),linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] bg-[size:auto,32px_32px,32px_32px]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col gap-3 p-3 lg:flex-row lg:p-4">
        <Sidebar
          services={services}
          groups={groups}
          query={query}
          selection={selection}
          onQueryChange={setQuery}
          onSelect={select}
        />
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          <header className="flex flex-wrap items-center justify-between gap-4 border border-white/10 bg-[#0d131b]/90 px-4 py-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-white">{title}</h1>
              <code className="block truncate font-mono text-[11px] text-slate-500">
                {subtitle}
              </code>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>
                <b className="text-emerald-300">{counts.running}</b> running
              </span>
              {counts.attention ? (
                <span>
                  <b className="text-amber-300">{counts.attention}</b> attention
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setEditingService(null);
                  setServiceDialogOpen(true);
                }}
                className="button-primary"
              >
                Add service
              </button>
              <button
                type="button"
                onClick={() => setProjectDialogOpen(true)}
                className="button-secondary"
              >
                Register project
              </button>
            </div>
          </header>
          {notices.length ? (
            <section aria-label="Notifications" className="grid gap-2">
              {notices.map((notice) => (
                <div
                  key={notice.id}
                  role={notice.kind === "error" ? "alert" : "status"}
                  className={`flex items-center justify-between gap-3 border px-3 py-2 text-xs ${notice.kind === "error" ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-emerald-400/20 bg-emerald-400/8 text-emerald-100"}`}
                >
                  <span>{notice.message}</span>
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    onClick={() =>
                      setNotices((current) => current.filter((item) => item.id !== notice.id))
                    }
                    className="text-current opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          {loading ? (
            <div className="grid flex-1 place-items-center border border-white/10 text-sm text-slate-500">
              Loading services…
            </div>
          ) : services.length === 0 ? (
            <div className="grid flex-1 place-items-center border border-dashed border-white/15 p-10 text-sm text-slate-400">
              No services registered yet.
            </div>
          ) : visibleServices.length === 0 ? (
            <div className="grid flex-1 place-items-center border border-dashed border-white/15 p-10 text-sm text-slate-400">
              Select a service or working copy.
            </div>
          ) : (
            <>
              <section className="grid gap-2">
                {visibleServices.map((service) => (
                  <ServiceCard
                    key={service.name}
                    service={service}
                    project={projectFor(service)}
                    pendingAction={pending[service.name] ?? null}
                    onAction={(action, target) => void runAction(action, target)}
                    onEdit={(target) => {
                      setEditingService(target);
                      setServiceDialogOpen(true);
                    }}
                    onConfig={(target) => void openConfig(target)}
                    onUnregister={(name) => {
                      if (window.confirm(`Unregister project ${name}?`))
                        void deleteProject(name)
                          .then(() => refresh())
                          .catch((cause: unknown) =>
                            addNotice(
                              "error",
                              cause instanceof Error ? cause.message : String(cause),
                            ),
                          );
                    }}
                  />
                ))}
              </section>
              {selectedService ? (
                <Suspense
                  fallback={
                    <div className="grid min-h-[440px] place-items-center border border-white/10 text-xs text-slate-500">
                      Loading terminal…
                    </div>
                  }
                >
                  <LogsPanel key={selectedService.name} service={selectedService} />
                </Suspense>
              ) : null}
            </>
          )}
        </main>
      </div>
      {serviceDialogOpen ? (
        <ServiceDialog
          open
          service={editingService}
          serviceNames={services.map((service) => service.name)}
          onClose={() => {
            setServiceDialogOpen(false);
            setEditingService(null);
          }}
          onSave={saveService}
          onDelete={removeService}
        />
      ) : null}
      {projectDialogOpen ? (
        <ProjectDialog
          open
          onClose={() => setProjectDialogOpen(false)}
          onSave={async (project) => {
            await addProject(project);
            addNotice("success", `Registered ${project.name}.`);
            setProjectDialogOpen(false);
            await refresh();
          }}
        />
      ) : null}
      {configService ? (
        <ConfigDialog
          service={configService}
          definition={configDefinition}
          loading={configLoading}
          onClose={() => {
            setConfigService(null);
            setConfigDefinition(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
