---
name: devservers-start-service
description: Start or restart a dev server managed by the local Devservers Manager (tmux-based). Use when an agent needs to boot a service in the manager, verify daemon health, or recover a stopped service from the UI/CLI.
---

# Devservers Start Service

## Overview

Start or restart a configured service using the daemon/CLI so it runs in the `devservers` tmux session.
Rule: Use CLI only. Do not edit config files directly.

## Workflow

### 1) Verify manager is running

Check daemon health:

```
curl -s http://127.0.0.1:4141/services
```

If not running, bootstrap the manager:

```
devservers bootstrap
```

Repo dev:

```
pnpm run bootstrap
```

### 2) Start or restart the service

Preferred (installed CLI):

```
devservers start <name>
```

Restart if already running:

```
devservers restart <name>
```

Repo dev:

```
pnpm -C packages/cli dev -- start <name>
pnpm -C packages/cli dev -- restart <name>
```

### 3) Verify status

```
devservers status
```

Repo dev:

```
pnpm -C packages/cli dev -- status
```

### 4) Read logs

```
tmux attach -t devservers
```

Detach with `Ctrl-b d`.

## Notes

- Daemon binds to `127.0.0.1:4141`.
- Each service gets its own tmux window.
