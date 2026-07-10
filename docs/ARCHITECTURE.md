# Architecture

## Overview

- UI (React + Tailwind) talks to the daemon on `http://127.0.0.1:4141`.
- In production, the daemon serves the UI at `/ui/`.
- Daemon manages tmux session `devservers` and exposes REST + WS APIs.
- CLI is a thin wrapper over config + daemon endpoints.
- Desktop UI uses a compact left sidebar with fuzzy search, working-copy hierarchy, status dots, and per-group running counts; the main pane prioritizes service controls and logs.

## Process model

- Installable daemon start uses `devservers daemon start`, launching `manager-daemon` by default (UI served by daemon), or also starting `manager-ui` when `devservers daemon start --ui vite` is used.
- Dev bootstrap starts two tmux windows: `manager-daemon` and `manager-ui` (Vite dev server).
- Each service runs in its own tmux window named after the service.
- One tmux session groups everything for easy inspection.

## Status detection

- `starting`: the daemon is preparing or launching the service pane.
- `running`: the managed pane process is alive.
- `stopped`: no service window exists, or a legacy unmanaged pane is idle.
- `exited`: the managed process completed successfully; its pane and logs are retained.
- `error`: the managed process failed, including its exit code or signal when tmux provides it.

New service panes run the configured command directly with tmux `remain-on-exit`, so exit state and
logs survive daemon restarts. Legacy panes remain compatible and migrate the next time they start.

## Logs

- Logs are streamed by default when a single service is selected in the main view.
- UI opens a WS stream to `WS /services/:name/logs` and receives tail output.
- Uses `tmux capture-pane` to avoid separate log pipes.
- Daemon request/error logs use Fastify logging; interactive terminal runs use pretty console formatting.
