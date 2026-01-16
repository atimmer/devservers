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
