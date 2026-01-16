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

## Schema

```json
{
  "version": 1,
  "services": [
    {
      "name": "api",
      "cwd": "/Users/anton/Code/api",
      "command": "pnpm dev",
      "env": { "NODE_ENV": "development" },
      "port": 3000,
      "portMode": "static"
    }
  ]
}
```

### Fields
- `name` (string, required): alphanumeric + `._-` only. Used as the tmux window name.
- `cwd` (string, required): working directory for the command.
- `command` (string, required): shell command to run.
- `env` (object, optional): environment variables injected before command.
- `port` (number, optional): display-only metadata.
- `portMode` (string, optional): `static`, `detect`, or `registry` (default `static`). `detect` updates `port` from logs.
- `lastStartedAt` (string, optional): ISO timestamp of the last successful start (managed by the daemon).
