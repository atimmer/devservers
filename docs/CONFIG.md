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
  "registeredProjects": [
    {
      "name": "academy",
      "path": "/Users/anton/Code/rendement-academy",
      "isMonorepo": true
    }
  ],
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
- `registeredProjects` (array, optional): project references that may contain `devservers-compose.yml`.
  - `name` (string, required): project label.
  - `path` (string, required): absolute path to project root.
  - `isMonorepo` (boolean, optional): hint for UI display.
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

## Project compose file (`devservers-compose.yml`)

If a registered project contains a `devservers-compose.yml` file, the daemon loads services from it and watches for file changes.

Compose shape (docker-compose style):

```yaml
services:
  rendement-academy:
    command: "pnpm --filter=rendement-academy dev"
    port-mode: registry
    depends_on:
      - ucms
    env:
      - PORT=$PORT
      - API_URL=http://localhost:${PORT:ucms}
```

Supported keys per service:
- `command` (required)
- `cwd`, `working_dir`, or `working-dir` (optional; defaults to project root)
- `dependsOn`, `depends_on`, or `depends-on` (optional array)
- `env` or `environment` (optional object or `KEY=VALUE` list)
- `port` (optional number)
- `portMode`, `port_mode`, or `port-mode` (optional `static|detect|registry`)

Service names in the file are local to the project. At runtime, daemon service names are prefixed as `<projectName>_<serviceName>` so one compose file can be reused across multiple checkouts.

`depends_on` and `${PORT:<name>}` references can use local compose service names; the daemon rewrites local references to prefixed runtime names.

Compose-loaded services can be started/stopped/restarted like normal services. In the UI they expose a `Config` button (read-only definition view) instead of edit controls.

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
