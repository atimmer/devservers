# Architecture

## Overview

- UI (React + Tailwind) talks to the daemon on `http://127.0.0.1:4141`.
- In production, the daemon serves the UI at `/ui/`.
- Daemon manages tmux session `devservers` and exposes REST + WS APIs.
- CLI is a thin wrapper over config + daemon endpoints.
- Desktop UI uses a right sidebar: fuzzy search at top, started services pinned first, then working-copy groups sorted by working-directory name.

## Process model

- Installable daemon start uses `devservers daemon start`, launching `manager-daemon` by default (UI served by daemon), or also starting `manager-ui` when `devservers daemon start --ui vite` is used.
- Dev bootstrap starts two tmux windows: `manager-daemon` and `manager-ui` (Vite dev server).
- Each service runs in its own tmux window named after the service.
- One tmux session groups everything for easy inspection.

## Status detection

- `stopped`: window doesn\'t exist
- `running`: window exists and pane is alive
- `error`: tmux reports pane dead

## Logs

- Logs are streamed by default when a single service is selected in the main view.
- UI opens a WS stream to `WS /services/:name/logs` and receives tail output.
- Uses `tmux capture-pane` to avoid separate log pipes.
- Daemon request/error logs use Fastify logging; interactive terminal runs use pretty console formatting.
