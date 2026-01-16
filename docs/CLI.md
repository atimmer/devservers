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
  --env NODE_ENV=development

devservers remove api

devservers start api

devservers stop api

devservers restart api

devservers bootstrap

devservers install-skill

devservers install-skill devservers-register-service
```

## Options
- `-c, --config <path>`: override config file path
- `--daemon <url>`: daemon URL (default `http://127.0.0.1:4141`)

## Bootstrap options
- `--port <port>`: daemon port (default `4141`)
- `--restart`: restart the manager daemon window

## Skill install options
- `--dest <path>`: override `$CODEX_HOME/skills`
- `--force`: overwrite existing skills
- `--dry-run`: show actions without writing
