# Devservers Manager Daemon

Fastify daemon that manages tmux windows and serves the Devservers Manager UI.

Typically installed as a dependency of `@24letters/devservers`.

Manual start (advanced):

```
node dist/index.js --config /path/to/devservers.json --port 4141
```

UI:

```
http://127.0.0.1:4141/ui/
```

## Service lifecycle API

`GET /services` reports daemon-owned process state as `starting`, `running`, `stopped`,
`exited`, or `error`. Completed processes include a human-readable `message` and, when tmux
provides them, `exitCode` and `exitSignal`.

Start, stop, restart, and delete responses include the requested `target` and an `affected`
array in execution order. Log websocket requests accept a `lines` query parameter capped at
2,000 lines.
