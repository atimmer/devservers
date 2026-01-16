---
name: devservers-start-service
description: Start, restart, or stop a dev server managed by the local Devservers Manager using the CLI.
---

# Devservers Start Service

## Overview

Start, restart, or stop a configured service using the CLI.
Rule: Use CLI only. Do not edit config files directly or interact with internal services.

## Workflow

### 1) Start or restart the service

```
devservers start <name>
```

Restart if already running:

```
devservers restart <name>
```

### 2) Stop a service (optional)

```
devservers stop <name>
```

### 3) Verify status

```
devservers status
```

## Notes

- If a CLI call fails due to connectivity, ask the user to start the manager and retry.
