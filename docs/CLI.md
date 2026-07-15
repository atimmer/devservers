# CLI

Binary name: `devservers`

Overview:

```
devservers --help
```

## Commands

```
devservers list

devservers status

devservers --json status

devservers url api

devservers logs api

devservers logs api --lines 50

devservers add \
  --name api \
  --cwd /Users/anton/Code/api \
  --command "pnpm dev" \
  --depends-on db \
  --port 3000 \
  --port-mode detect \
  --env NODE_ENV=development

devservers remove api

devservers start api

devservers stop api

devservers restart api

devservers daemon start

devservers daemon restart

devservers daemon status

devservers daemon stop

devservers install-skill

devservers install-skill devservers-register-service
```

Note: `start`, `stop`, `restart`, and `url` will auto-start the local daemon/UI when they are not running.
Note: `status` includes the current port when known (e.g. `api: running (port 3000)`).
Note: `url <service>` prints a full local URL for running services (e.g. `http://localhost:3000/`).
Note: `logs <service>` prints a bounded snapshot of the service's actual tmux output (200 lines by default).

## Options
- `-h, --help`: show command overview
- `-c, --config <path>`: override config file path
- `--daemon <url>`: daemon URL (default `http://127.0.0.1:4141`)
- `--json`: print machine-readable JSON for list, status, URL, logs, service mutations, and lifecycle actions

`add` and `remove` use the daemon validation and lifecycle routes. Removing a service therefore stops
its managed process before deleting the config entry. Start, stop, and restart output lists services
actually affected by dependency cascades.

## Add options
- `--depends-on <name...>`: declare service dependencies
- `--port <port>`: service port (optional)
- `--port-mode <mode>`: `static`, `detect`, or `registry`

## URL options
- `--scheme <scheme>`: URL scheme (default `http`)
- `--host <host>`: URL host (default `localhost`)
- `--path <path>`: URL path (default `/`)

## Logs options
- `-n, --lines <count>`: number of recent lines to print (default `200`, capped by the daemon at `2000`)
- `--ansi`: preserve ANSI terminal escape sequences (stripped by default)

Plain output contains only the captured log text so agents can inspect or pipe it directly. `--json`
returns the service name, current status, and logs. Stopped services with no retained pane output return an
empty snapshot; unknown service names fail with a non-zero exit code.

## Daemon start options
- `--port <port>`: daemon port (default `4141`)
- `--ui <mode>`: `daemon` (serve bundled UI at `/ui/`) or `vite` (run Vite dev UI on `http://localhost:4142/`)
- `--restart`: restart the manager daemon window

## Daemon restart options
- `--port <port>`: daemon port (default `4141`)
- `--ui <mode>`: `daemon` (serve bundled UI at `/ui/`) or `vite` (ensure the Vite UI window exists without restarting it)

## Daemon status behavior
- `devservers daemon status`: reports tmux session/window state plus daemon `/services` and `/ui/` reachability without starting or stopping anything

## Daemon stop behavior
- `devservers daemon stop`: stops the `manager-daemon` tmux window and also stops `manager-ui` if it is running

## Skill install options
- `--agent <name>`: target agent (default `codex`, uses `<AGENT>_HOME` or `~/.<agent>` as the base path)
- `--dest <path>`: override the agent skills directory
- `--force`: overwrite existing skills
- `--dry-run`: show actions without writing
