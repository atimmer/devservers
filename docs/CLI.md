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
```

## Options
- `-c, --config <path>`: override config file path
- `--daemon <url>`: daemon URL (default `http://127.0.0.1:4141`)
