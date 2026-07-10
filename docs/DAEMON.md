# Daemon

Fastify server that manages tmux windows and exposes REST + WebSocket APIs.

When UI assets are bundled, the daemon serves the UI at `/ui/` and redirects `/` → `/ui/`.

## Endpoints

- `GET /projects` → `{ projects: RegisteredProject[] }`
- `POST /projects` → add/update a project reference
- `DELETE /projects/:name` → remove a project reference
- `GET /services` → `{ services: ServiceInfo[] }`
- `GET /services/:name/config` → read service definition from config/compose source
- `POST /services` → add or update a service
- `PUT /services/:name` → update service by name
- `DELETE /services/:name` → remove service
- `POST /services/:name/start`
- `POST /services/:name/stop`
- `POST /services/:name/restart`
- `WS /services/:name/logs?lines=200[&ansi=1]` → streams `{ type: "logs", payload: string }`

Lifecycle mutations return `{ ok, action, target, affected }`. `affected` contains the services that
were actually changed, in execution order, including dependency or dependent cascades. Log requests
are capped at 2,000 lines.

## Dependencies
- `start` auto-starts dependencies first.
- `stop` stops dependents before the target.
- `restart` only restarts the target (dependents keep running).

Compose services (from `devservers-compose.yml`) participate in the same dependency graph as config-defined services.

## Status model
- `starting`: daemon launch work is in progress
- `running`: managed pane process is alive
- `stopped`: window does not exist, or a legacy pane is idle
- `exited`: managed process exited successfully
- `error`: managed process exited unsuccessfully or could not be inspected

Exited and errored services retain their logs and expose `message`, `exitCode`, and `exitSignal` when
available. Deleting a config-managed service stops its pane before removing it from the config.

## tmux
- Session: `devservers`
- Window per service; window name = service name
- Stop sends `Ctrl+C`
