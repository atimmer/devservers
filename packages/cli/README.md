# Devservers Manager CLI

Install:

```
pnpm add -g @atimmer/devservers
```

Start the manager (daemon + UI):

```
devservers bootstrap
```

Add a service:

```
devservers add --name api --cwd /Users/you/Code/api --command "pnpm dev" --port 3000
```

Open the UI:

```
http://127.0.0.1:4141/ui/
```

Docs and source: see the repository README.
