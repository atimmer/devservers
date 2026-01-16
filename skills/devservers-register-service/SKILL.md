---
name: devservers-register-service
description: Register a dev server in the local Devservers Manager config using the CLI. Use when an agent needs to add/update/remove a service entry (name, cwd, command, env, port, healthUrl) so it appears in the manager UI and tmux session.
---

# Devservers Register Service

## Overview

Register a service via the CLI so the manager UI can control it. Optionally start it through the daemon if requested.
Rule: Use CLI only. Do not edit config files directly.

## Workflow

### 1) Gather inputs

Collect:
- `name` (alphanumeric plus `._-`)
- `cwd` (absolute path)
- `command` (shell command, e.g. `pnpm dev`)
- optional `env` entries (`KEY=VALUE`)
- optional `port` and/or `healthUrl`

Ask if the user wants the service started immediately.

## 2) Register via CLI (preferred)

From the repo root:

```
pnpm -C packages/cli dev -- add \
  --name <name> \
  --cwd <absolute-path> \
  --command "<command>" \
  --port <port> \
  --health-url <url> \
  --env KEY=VALUE
```

- `--port`, `--health-url`, and `--env` are optional.
- Repeat `--env` for multiple vars.

Verify:

```
pnpm -C packages/cli dev -- list
```

### 4) Start service (optional)

If the daemon is running (bootstrap active), start via CLI:

```
pnpm -C packages/cli dev -- start <name>
```

If the daemon is not running, start the manager first:

```
pnpm run bootstrap
```

### 5) Read logs (optional)

Attach to the tmux session and select the service window:

```
tmux attach -t devservers
```

Detach with `Ctrl-b d`.

### 6) Troubleshoot

- If `start` fails, ensure tmux is installed and the daemon is running on `127.0.0.1:4141`.
