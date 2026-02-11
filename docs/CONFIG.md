# Config

Default file (macOS):

```
~/Library/Application Support/Devservers Manager/devservers.json
```

Default file (Linux):

```
~/.config/devservers/devservers.json
```

Default file (Windows):

```
%APPDATA%\\Devservers Manager\\devservers.json
```

Override with:
- CLI/daemon `--config /path/to/file.json`
- env `DEVSERVER_CONFIG=/path/to/file.json`

The repo ships a sample `devservers.json` for development; pass `--config ./devservers.json` to use it.

Port registry file (used when `portMode` is `registry`):

Default file (macOS):

```
~/Library/Application Support/Devservers Manager/port-registry.json
```

Default file (Linux):

```
~/.config/devservers/port-registry.json
```

Default file (Windows):

```
%APPDATA%\\Devservers Manager\\port-registry.json
```

Override with:
- env `DEVSERVER_PORT_REGISTRY=/path/to/port-registry.json`

When starting a service with `portMode: "registry"`, the daemon will create an
empty registry file if it is missing and assign the next available port when
the service does not yet have an entry (starting at 3100).

## Schema

```json
{
  "version": 1,
  "services": [
    {
      "name": "api",
      "cwd": "/Users/anton/Code/api",
      "command": "pnpm dev",
      "dependsOn": ["db"],
      "env": { "NODE_ENV": "development" },
      "port": 3000,
      "portMode": "static"
    }
  ]
}
```

### Fields
- `name` (string, required): alphanumeric + `._-` only. Used as the tmux window name.
- `cwd` (string, required): working directory for the command.
- `command` (string, required): shell command to run.
- `dependsOn` (string[], optional): other service names that must be running first.
- `env` (object, optional): environment variables injected before command.
- `port` (number, optional): display-only metadata.
- `portMode` (string, optional): `static`, `detect`, or `registry` (default `static`). `detect` updates `port` from logs.
- `lastStartedAt` (string, optional): ISO timestamp of the last successful start (managed by the daemon).

### Dependency behavior
- Starting a service auto-starts its dependencies first.
- Restarting a service does not stop dependents.
- Stopping a service also stops dependents (in reverse order).

### Port registry format

```json
{
  "version": 1,
  "services": {
    "api": 3000,
    "web": 5173
  }
}
```

Service names must match `services[].name` in `devservers.json`.

### Port templates in env

Env values may include:
- `$PORT` or `${PORT}` to inject the current service's resolved port.
- `${PORT:service-name}` to inject another service's resolved port (useful with `dependsOn`).

When `portMode` is `registry`, the port comes from the port registry; otherwise it uses `services[].port`.
