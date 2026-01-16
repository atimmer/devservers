# Devservers Manager

Local dev server manager for macOS. Runs every service inside a single tmux session and gives you a UI + CLI to control them.

## Requirements

- macOS
- `pnpm`
- `tmux`
- Node.js 20+

## Install

```
pnpm install
```

## Bootstrap (manager UI + daemon)

The manager itself runs inside the same tmux session (`devservers`) that hosts your dev servers.

```
pnpm run bootstrap
```

This creates two tmux windows:
- `manager-daemon` (Fastify daemon)
- `manager-ui` (React UI)

Attach to the session to view logs:

```
tmux attach -t devservers
```

### Restarting the manager

Because the manager runs in tmux, restart it by either:

```
scripts/bootstrap --restart
```

or by killing the windows and re-running bootstrap:

```
tmux kill-window -t devservers:manager-daemon

tmux kill-window -t devservers:manager-ui

scripts/bootstrap
```

## Config

Default config file: `devservers.json` in repo root.
Override with:
- `--config <path>` on CLI or daemon
- `DEVSERVER_CONFIG=/path/to/devservers.json`

Schema:

```json
{
  "version": 1,
  "services": [
    {
      "name": "api",
      "cwd": "/Users/anton/Code/api",
      "command": "pnpm dev",
      "env": { "NODE_ENV": "development" },
      "port": 3000
    }
  ]
}
```

## CLI

The CLI binary is `devservers` (built from `packages/cli`). Common commands:

```
devservers list

devservers add --name api --cwd /Users/anton/Code/api --command "pnpm dev" --port 3000

devservers start api

devservers stop api

devservers restart api

devservers status
```

## UI

The UI polls the daemon and only streams logs when you open the log drawer for a service. Override daemon URL:

```
VITE_DAEMON_URL=http://127.0.0.1:4141
```

## Docs

- `docs/BOOTSTRAP.md`
- `docs/CONFIG.md`
- `docs/CLI.md`
- `docs/DAEMON.md`
- `docs/ARCHITECTURE.md`
- `docs/TROUBLESHOOTING.md`

## Scripts

- `pnpm run bootstrap` - start manager in tmux
- `pnpm run dev` - run UI only
- `pnpm run dev:daemon` - run daemon only
- `pnpm run dev:cli` - run CLI in watch mode
- `pnpm run doctor` - check system prerequisites
- `pnpm run test` - run unit tests

## Notes

- All services are grouped under the `devservers` tmux session.
- One tmux window per service.
- `start` uses tmux `send-keys` and `stop` sends `Ctrl+C`.
