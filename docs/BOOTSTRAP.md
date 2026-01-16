# Bootstrap

The manager itself (daemon + UI) runs inside the same tmux session used for services.

## Start

```
pnpm run bootstrap
```

Creates tmux session `devservers` with windows:
- `manager-daemon`
- `manager-ui`

## Restart

```
./scripts/bootstrap --restart
```

This kills and recreates the manager windows while leaving service windows intact.

## Attach

```
tmux attach -t devservers
```
