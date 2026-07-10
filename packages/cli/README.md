# Devservers Manager CLI

Install:

```
pnpm add -g @24letters/devservers
```

Start the manager (daemon + UI):

```
devservers daemon start
```

See CLI command overview:

```
devservers --help
```

Add `--json` before a command for machine-readable output, for example:

```
devservers --json status
```

Run UI through Vite (hot reload):

```
devservers daemon start --ui vite
```

Check manager status:

```
devservers daemon status
```

Restart the manager daemon:

```
devservers daemon restart
```

Stop the manager:

```
devservers daemon stop
```

Add a service:

```
devservers add --name api --cwd /Users/you/Code/api --command "pnpm dev" --port 3000
```

Service add/remove operations use daemon validation. Removing a service stops its managed process
before deleting the config entry.

Get the full local URL for a running service:

```
devservers url api
```

Open the UI:

```
http://127.0.0.1:4141/ui/
```

Docs and source: see the repository README.
