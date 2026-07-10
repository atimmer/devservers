import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceInfo } from "../api";
import { createLogsSocket } from "../api";
import { trimTrailingBlankLogLines } from "../logs";

const isAtBottom = (element: HTMLElement) =>
  element.scrollTop + element.clientHeight >= element.scrollHeight - 8;

export function LogsPanel({ service }: { service: ServiceInfo }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [hasLogs, setHasLogs] = useState(false);
  const [following, setFollowing] = useState(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const previousRef = useRef("");
  const followingRef = useRef(true);

  const updateFollowing = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);

  const write = useCallback((nextValue: string) => {
    const next = trimTrailingBlankLogLines(nextValue);
    const previous = previousRef.current;
    const terminal = terminalRef.current;
    if (terminal) {
      if (!previous || !next.startsWith(previous)) {
        terminal.reset();
        if (next) terminal.write(next);
      } else if (next.length > previous.length) terminal.write(next.slice(previous.length));
      if (followingRef.current) terminal.scrollToBottom();
    }
    previousRef.current = next;
    setHasLogs(next.length > 0);
  }, []);

  useEffect(() => {
    if (!container) return;
    const terminal = new Terminal({
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      fontSize: 12,
      scrollback: 4000,
      theme: { background: "#080b0f", foreground: "#d8e1ed", cursor: "#67e8f9" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    fit.fit();
    const viewport = container.querySelector(".xterm-viewport");
    const onScroll = () => {
      if (viewport instanceof HTMLElement && !isAtBottom(viewport)) updateFollowing(false);
    };
    viewport?.addEventListener("scroll", onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit.fit());
    observer?.observe(container);
    write(previousRef.current);
    return () => {
      viewport?.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [container, updateFollowing, write]);

  useEffect(() => {
    const socket = createLogsSocket(service.name, 300, true);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string; payload?: string };
        if (payload.type === "logs") write(payload.payload ?? "");
      } catch {
        write(String(event.data ?? ""));
      }
    };
    socket.onerror = () => setStreamError("Log stream disconnected. Service status is unaffected.");
    return () => socket.close();
  }, [service.name, updateFollowing, write]);

  const command = `tmux attach -r -t devservers:${service.name}`;
  return (
    <section className="flex min-h-[440px] flex-1 flex-col border border-white/10 bg-[#080b0f]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Live logs</h3>
          <code className="font-mono text-[11px] text-slate-500">{command}</code>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(command)}
            className="button-secondary"
          >
            Copy attach command
          </button>
          <button
            type="button"
            onClick={() => {
              updateFollowing(true);
              terminalRef.current?.scrollToBottom();
            }}
            className={`button-secondary ${following ? "opacity-60" : "border-cyan-300/40 text-cyan-100"}`}
          >
            {following ? "Following" : "Resume follow"}
          </button>
        </div>
      </header>
      {streamError ? (
        <p
          role="alert"
          className="border-b border-amber-400/20 bg-amber-400/8 px-4 py-2 text-xs text-amber-200"
        >
          {streamError}
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1 p-3">
        <div ref={setContainer} className="logs-terminal h-full w-full" />
        {!hasLogs ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-slate-600">
            {service.status === "running" || service.status === "starting"
              ? "Waiting for output…"
              : "No output captured."}
          </div>
        ) : null}
      </div>
    </section>
  );
}
