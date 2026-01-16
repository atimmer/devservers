# Architecture

## Overview

- UI (React + Tailwind) talks to the daemon on `http://127.0.0.1:4141`.
- Daemon manages tmux session `devservers` and exposes REST + WS APIs.
- CLI is a thin wrapper over config + daemon endpoints.

## Process model

- Manager bootstrap starts two tmux windows: `manager-daemon` and `manager-ui`.
- Each service runs in its own tmux window named after the service.
- One tmux session groups everything for easy inspection.

## Status detection

- `stopped`: window doesn\'t exist
- `running`: window exists and pane is alive
- `error`: tmux reports pane dead

## Logs

- No logs loaded by default.
- UI opens a WS stream to `WS /services/:name/logs` and receives tail output.
- Uses `tmux capture-pane` to avoid separate log pipes.
