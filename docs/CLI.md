# CLI

Binary name: `devservers`

## Commands

```
devservers list

devservers status

devservers add \
  --name api \
  --cwd /Users/anton/Code/api \
  --command "pnpm dev" \
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

Note: `start`, `stop`, and `restart` will auto-start the local daemon/UI when they are not running.

## Options
- `-c, --config <path>`: override config file path
- `--daemon <url>`: daemon URL (default `http://127.0.0.1:4141`)
## Add options
- `--port <port>`: service port (optional)
- `--port-mode <mode>`: `static`, `detect`, or `registry`

## Bootstrap options
- `--port <port>`: daemon port (default `4141`)
- `--restart`: restart the manager daemon window

## Skill install options
- `--agent <name>`: target agent (default `codex`, uses `<AGENT>_HOME` or `~/.<agent>` as the base path)
- `--dest <path>`: override the agent skills directory
- `--force`: overwrite existing skills
- `--dry-run`: show actions without writing
