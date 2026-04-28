# Bootstrap

The manager runs inside the same tmux session used for services.

## Installable (CLI)

Start the daemon in tmux and serve the UI from the daemon:

```
devservers daemon start
```

Open the UI at:

```
http://127.0.0.1:4141/ui/
```

Restart the daemon window:

```
devservers daemon restart
```

Check daemon and UI status without changing state:

```
devservers daemon status
```

Run the UI through Vite (hot reload):

```
devservers daemon start --ui vite
```

Stop the manager daemon and optional Vite UI window:

```
devservers daemon stop
```

## From source (dev)

```
pnpm run bootstrap
```

Creates tmux session `devservers` with windows:
- `manager-daemon`
- `manager-ui` (Vite dev server)

Open the dev UI at:

```
http://localhost:4142/
```

Restart dev windows:

```
./scripts/bootstrap --restart
```

Or run the CLI directly in source mode (defaults to Vite UI):

```
pnpm -C packages/cli dev daemon start
```

If the daemon is already running and you rebuilt the package locally, reload it with:

```
pnpm -C packages/cli dev daemon restart
```

## Attach

```
tmux attach -t devservers
```
