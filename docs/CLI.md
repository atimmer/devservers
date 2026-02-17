# CLI

Binary name: `devservers`

## Commands

```
devservers list

devservers status

devservers url api

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

devservers bootstrap

devservers install-skill

devservers install-skill devservers-register-service
```

Note: `start`, `stop`, `restart`, and `url` will auto-start the local daemon/UI when they are not running.
Note: `status` includes the current port when known (e.g. `api: running (port 3000)`).
Note: `url <service>` prints a full local URL for running services (e.g. `http://localhost:3000/`).

## Options
- `-c, --config <path>`: override config file path
- `--daemon <url>`: daemon URL (default `http://127.0.0.1:4141`)
## Add options
- `--depends-on <name...>`: declare service dependencies
- `--port <port>`: service port (optional)
- `--port-mode <mode>`: `static`, `detect`, or `registry`

## URL options
- `--scheme <scheme>`: URL scheme (default `http`)
- `--host <host>`: URL host (default `localhost`)
- `--path <path>`: URL path (default `/`)

## Bootstrap options
- `--port <port>`: daemon port (default `4141`)
- `--ui <mode>`: `daemon` (serve bundled UI at `/ui/`) or `vite` (run Vite dev UI on `http://localhost:4142/`)
- `--restart`: restart the manager daemon window

## Skill install options
- `--agent <name>`: target agent (default `codex`, uses `<AGENT>_HOME` or `~/.<agent>` as the base path)
- `--dest <path>`: override the agent skills directory
- `--force`: overwrite existing skills
- `--dry-run`: show actions without writing
