# Devservers Manager CLI

Install:

```
pnpm add -g @24letters/devservers
```

Start the manager (daemon + UI):

```
devservers bootstrap
```

See CLI command overview:

```
devservers --help
```

Run UI through Vite (hot reload):

```
devservers bootstrap --ui vite
```

Add a service:

```
devservers add --name api --cwd /Users/you/Code/api --command "pnpm dev" --port 3000
```

Get the full local URL for a running service:

```
devservers url api
```

Open the UI:

```
http://127.0.0.1:4141/ui/
```

Docs and source: see the repository README.
