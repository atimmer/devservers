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

## From source (dev)

```
pnpm run bootstrap
```

Creates tmux session `devservers` with windows:
- `manager-daemon`
- `manager-ui` (Vite dev server)

Open the dev UI at:

```
http://127.0.0.1:4142/
```

Restart dev windows:

```
./scripts/bootstrap --restart
```

## Attach

```
tmux attach -t devservers
```
