# Contributing

Thanks for helping improve Devservers Manager!

## Development setup

```
pnpm install
```

Run the manager in dev mode (daemon + Vite UI):

```
pnpm run bootstrap
```

If you want to use a local config file:

```
DEVSERVER_CONFIG=./devservers.json pnpm -C packages/daemon dev
```

## Quality checks

```
pnpm run lint
pnpm run typecheck
pnpm run test
```

## Pull requests

- Keep changes focused and small.
- Add tests for bugs or regressions when it makes sense.
- Update docs when behavior changes.
