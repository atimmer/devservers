# Bootstrap

The manager runs inside the same tmux session used for services.

## Installable (CLI)

Start the daemon in tmux and serve the UI from the daemon:

```
devservers bootstrap
```

Open the UI at:

```
http://127.0.0.1:4141/ui/
```

Restart the daemon window:

```
devservers bootstrap --restart
```

Run the UI through Vite (hot reload):

```
devservers bootstrap --ui vite
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
pnpm -C packages/cli dev bootstrap
```

## Attach

```
tmux attach -t devservers
```
