---
name: devservers-register-service
description: Register a dev server using the CLI. Use when an agent needs to add/update/remove a service entry (name, cwd, command, env, port).
---

# Devservers Register Service

## Overview

Register a service via the CLI so it can be managed. Optionally start it if requested.
Rule: Use CLI only. Do not edit config files directly or interact with internal services.

## Workflow

### 1) Gather inputs

Collect:
- `name` (alphanumeric plus `._-`)
- `cwd` (absolute path)
- `command` (shell command, e.g. `pnpm dev`)
- optional `env` entries (`KEY=VALUE`)
- optional `port`

Ask if the user wants the service started immediately.

## 2) Register via CLI

CLI (from anywhere):

```
devservers add \
  --name <name> \
  --cwd <absolute-path> \
  --command "<command>" \
  --port <port> \
  --env KEY=VALUE
```

- `--port` and `--env` are optional.
- Repeat `--env` for multiple vars.

Verify:

```
devservers list
```

### 3) Start service (optional)

Start via CLI:

```
devservers start <name>
```
### 4) Troubleshoot

- If a CLI call fails due to connectivity, ask the user to start the manager and retry.
