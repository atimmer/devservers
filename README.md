# Devservers Manager

Local dev server manager for macOS. Runs every service inside a single tmux session and gives you a UI + CLI to control them.

## Requirements

- macOS
- `tmux`
- Node.js 20+
- `pnpm`

## Install (recommended)

```
pnpm add -g @atimmer/devservers
```

## Quickstart

Bootstrap the manager (daemon + UI):

```
devservers bootstrap
```

Open the UI:

```
http://127.0.0.1:4141/ui/
```

Add a service:

```
devservers add --name api --cwd /Users/you/Code/api --command "pnpm dev" --port 3000
```

Start/stop/restart:

```
devservers start api

devservers stop api

devservers restart api
```

## Config

Default config path (macOS):

```
~/Library/Application Support/Devservers Manager/devservers.json
```

Override with:

- `--config /path/to/devservers.json` (CLI or daemon)
- `DEVSERVER_CONFIG=/path/to/devservers.json`

## Skills (Codex)

Install all bundled skills:

```
devservers install-skill
```

Install a single skill:

```
devservers install-skill devservers-register-service
```

Set a custom skills directory:

```
CODEX_HOME=/path/to/codex devservers install-skill
```

## From source (development)

```
pnpm install
```

Start the dev daemon + UI (Vite):

```
pnpm run bootstrap
```

Dev UI:

```
http://127.0.0.1:4142/
```

## Docs

- `docs/BOOTSTRAP.md`
- `docs/CONFIG.md`
- `docs/CLI.md`
- `docs/DAEMON.md`
- `docs/ARCHITECTURE.md`
- `docs/TROUBLESHOOTING.md`

Some of the scripts in this repo are copied from Steipete's excellent agent-scripts repository, see the license in the scripts folder.

## License

MIT
