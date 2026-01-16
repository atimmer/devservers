# Daemon

Fastify server that manages tmux windows and exposes REST + WebSocket APIs.

When UI assets are bundled, the daemon serves the UI at `/ui/` and redirects `/` → `/ui/`.

## Endpoints

- `GET /services` → `{ services: ServiceInfo[] }`
- `POST /services` → add or update a service
- `PUT /services/:name` → update service by name
- `DELETE /services/:name` → remove service
- `POST /services/:name/start`
- `POST /services/:name/stop`
- `POST /services/:name/restart`
- `WS /services/:name/logs?lines=200` → streams `{ type: "logs", payload: string }`

## Status model
- `stopped`: window does not exist
- `running`: window exists and pane is alive
- `error`: pane marked dead by tmux

## tmux
- Session: `devservers`
- Window per service; window name = service name
- Stop sends `Ctrl+C`
