import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import type { PortMode, ServiceConfigDefinition, ServiceInfo, ServiceInput } from "../api";
import { formatEnv, parseEnv } from "../dashboard";

const overlay = "fixed inset-0 z-50 bg-black/70";
const content =
  "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 outline-none sm:items-center";
const panel = "w-full max-w-2xl border border-white/10 bg-[#0c1118] p-5 shadow-2xl";
const input =
  "w-full border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-cyan-300/50";
const label = "grid gap-1.5 text-xs text-slate-400";

const Header = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <Dialog.Description className="text-[11px] text-slate-500">{eyebrow}</Dialog.Description>
      <Dialog.Title className="text-lg font-semibold text-white">{title}</Dialog.Title>
    </div>
    <Dialog.Close className="button-secondary">Close</Dialog.Close>
  </div>
);

type ServiceFormState = {
  name: string;
  cwd: string;
  command: string;
  port: string;
  portMode: PortMode;
  env: string;
  dependsOn: string[];
};
const emptyForm: ServiceFormState = {
  name: "",
  cwd: "",
  command: "",
  port: "",
  portMode: "static",
  env: "",
  dependsOn: [],
};

export function ServiceDialog({
  open,
  service,
  serviceNames,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  service: ServiceInfo | null;
  serviceNames: string[];
  onClose: () => void;
  onSave: (input: ServiceInput, restart: boolean) => Promise<void>;
  onDelete: (service: ServiceInfo) => Promise<void>;
}) {
  const [form, setForm] = useState<ServiceFormState>(() =>
    service
      ? {
          name: service.name,
          cwd: service.cwd,
          command: service.command,
          port: service.port ? String(service.port) : "",
          portMode: service.portMode ?? "static",
          env: formatEnv(service.env),
          dependsOn: service.dependsOn ?? [],
        }
      : emptyForm,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"save" | "restart" | "delete" | null>(null);
  const dependencies = useMemo(
    () => serviceNames.filter((name) => name !== form.name.trim()),
    [serviceNames, form.name],
  );
  const submit = async (restart: boolean) => {
    setError(null);
    setSaving(restart ? "restart" : "save");
    try {
      await onSave(
        {
          name: form.name.trim(),
          cwd: form.cwd.trim(),
          command: form.command.trim(),
          port: form.port ? Number(form.port) : undefined,
          portMode: form.portMode,
          env: parseEnv(form.env),
          dependsOn: form.dependsOn.length ? form.dependsOn : undefined,
        },
        restart,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(null);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content}>
          <div className={panel}>
            <Header
              eyebrow={service ? "Edit service" : "New service"}
              title={service ? service.name : "Add a dev server"}
            />
            {error ? (
              <p
                role="alert"
                className="mt-4 border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
              >
                {error}
              </p>
            ) : null}
            <div className="mt-5 grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
              <label className={label}>
                Name
                <input
                  className={input}
                  disabled={Boolean(service)}
                  value={form.name}
                  onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                />
              </label>
              <label className={label}>
                Working directory
                <input
                  className={input}
                  value={form.cwd}
                  onChange={(e) => setForm((v) => ({ ...v, cwd: e.target.value }))}
                />
              </label>
              <label className={label}>
                Command
                <input
                  className={input}
                  value={form.command}
                  onChange={(e) => setForm((v) => ({ ...v, command: e.target.value }))}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={label}>
                  Port mode
                  <select
                    className={input}
                    value={form.portMode}
                    onChange={(e) =>
                      setForm((v) => ({ ...v, portMode: e.target.value as PortMode }))
                    }
                  >
                    <option value="static">Static</option>
                    <option value="detect">Detect from logs</option>
                    <option value="registry">Registry</option>
                  </select>
                </label>
                {form.portMode === "static" ? (
                  <label className={label}>
                    Port
                    <input
                      inputMode="numeric"
                      className={input}
                      value={form.port}
                      onChange={(e) => setForm((v) => ({ ...v, port: e.target.value }))}
                    />
                  </label>
                ) : null}
              </div>
              <fieldset className="border border-white/10 p-3">
                <legend className="px-1 text-xs text-slate-400">Dependencies</legend>
                <div className="grid max-h-32 grid-cols-2 gap-2 overflow-y-auto">
                  {dependencies.length ? (
                    dependencies.map((name) => (
                      <label key={name} className="flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={form.dependsOn.includes(name)}
                          onChange={(e) =>
                            setForm((v) => ({
                              ...v,
                              dependsOn: e.target.checked
                                ? [...v.dependsOn, name]
                                : v.dependsOn.filter((entry) => entry !== name),
                            }))
                          }
                        />
                        {name}
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">No other services.</p>
                  )}
                </div>
              </fieldset>
              <label className={label}>
                Environment{" "}
                <span className="text-[10px] text-slate-600">KEY=VALUE, one per line</span>
                <textarea
                  className={input}
                  rows={4}
                  value={form.env}
                  onChange={(e) => setForm((v) => ({ ...v, env: e.target.value }))}
                />
              </label>
            </div>
            <footer className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
              {service ? (
                <button
                  type="button"
                  disabled={Boolean(saving)}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${service.name}? A running process will be stopped first.`,
                      )
                    ) {
                      setSaving("delete");
                      void onDelete(service).catch((cause: unknown) => {
                        setError(cause instanceof Error ? cause.message : String(cause));
                        setSaving(null);
                      });
                    }
                  }}
                  className="button-secondary text-rose-200"
                >
                  {saving === "delete" ? "Deleting…" : "Delete"}
                </button>
              ) : null}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(saving)}
                  onClick={() => void submit(false)}
                  className="button-primary"
                >
                  {saving === "save" ? "Saving…" : "Save"}
                </button>
                {service?.status === "running" ? (
                  <button
                    type="button"
                    disabled={Boolean(saving)}
                    onClick={() => void submit(true)}
                    className="button-warning"
                  >
                    {saving === "restart" ? "Saving and restarting…" : "Save & restart"}
                  </button>
                ) : null}
              </div>
            </footer>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ProjectDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (project: { name: string; path: string; isMonorepo: boolean }) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: "", path: "", isMonorepo: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...form, name: form.name.trim(), path: form.path.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content}>
          <div className={`${panel} max-w-lg`}>
            <Header eyebrow="Register project" title="Add a compose project" />
            {error ? (
              <p role="alert" className="mt-4 text-sm text-rose-200">
                {error}
              </p>
            ) : null}
            <div className="mt-5 grid gap-4">
              <label className={label}>
                Name
                <input
                  className={input}
                  value={form.name}
                  onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                />
              </label>
              <label className={label}>
                Path
                <input
                  className={input}
                  value={form.path}
                  onChange={(e) => setForm((v) => ({ ...v, path: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={form.isMonorepo}
                  onChange={(e) => setForm((v) => ({ ...v, isMonorepo: e.target.checked }))}
                />
                Monorepo
              </label>
            </div>
            <footer className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="button-primary"
              >
                {saving ? "Saving…" : "Save project"}
              </button>
            </footer>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfigDialog({
  service,
  definition,
  loading,
  onClose,
}: {
  service: ServiceInfo | null;
  definition: ServiceConfigDefinition | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={Boolean(service)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content}>
          <div className={`${panel} flex h-[75vh] max-w-4xl flex-col`}>
            <Header eyebrow="Compose definition" title={service?.name ?? "Config"} />
            <code className="mt-4 break-all font-mono text-[11px] text-slate-500">
              {definition?.path}
            </code>
            <pre className="mt-4 min-h-0 flex-1 overflow-auto border border-white/10 bg-black/30 p-4 font-mono text-xs text-slate-200">
              {loading ? "Loading…" : JSON.stringify(definition?.definition ?? {}, null, 2)}
            </pre>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
