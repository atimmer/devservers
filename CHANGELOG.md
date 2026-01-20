# Changelog

## Unreleased

### Changed
- Logs viewer now renders ANSI color output via xterm.js when requested.

### Fixed
- Slow-starting services no longer flip to error unless logs show an error.

## 0.2.1 - 2026-01-20

### Changed
- Release checklist now only documents prep work plus tagging/pushing (publishing handled by GitHub Actions).
- Condensed the UI header into a compact stats bar with a more prominent Add Service button, flush to the top with squared upper corners.
- Updated the README UI screenshot.
- CLI status output now includes service ports when known, with skills/docs noting how to retrieve them.
- Open button now uses a link targeting a new tab, centered like the other buttons.

### Fixed
- UI build now includes React type definitions for TypeScript.
- Error boundary now stores caught errors along with component stacks for strict builds.
- Port registry tests now use bracketed env access to satisfy strict typing.
- Start failures now clear the start spinner, surface an error badge, and highlight Logs until opened.
- Dialogs now close on Escape using Radix UI.
- Modals now sit above view transitions and use higher z-index overlays to prevent background bleed-through.

## 0.2.0 - 2026-01-19

### Added
- UI now shows a dev-only error boundary message when rendering fails.

### Changed
- Controls now use a shared action button helper and consistent sizing (Stop above Restart, 140x36 buttons).
- Start/stop/restart actions now show spinners based on refreshed status (stop delayed; restart persists until running).
- Service cards now animate reordering via React ViewTransition (requires React canary), with slower timing.
- Clarified changelog guidance to merge follow-up fixes into the original entry.

### Fixed
- Publish workflow now uses `pnpm publish --filter` to avoid npm workspace publish errors.
- Bootstrap now starts the daemon from an existing window even if it was left in a different directory.
- CLI bootstrap now waits for the daemon to become reachable before returning.
- Stopping a service now removes its tmux window to avoid stale sessions.
- ViewTransition wrapper now references the runtime React export to avoid undefined component crashes.

## 0.1.2 - 2026-01-16

### Fixed
- GitHub Actions publish workflow no longer fails during Node setup by avoiding the pnpm cache hook.
- Publish workflow now uses `pnpm publish` with OIDC provenance so workspace deps are rewritten for published packages.
- Package metadata now points to the correct GitHub repository for provenance validation.

## 0.1.1 - 2026-01-16

### Added
- `devservers install-skill --agent <name>` to target non-Codex agents, with per-agent skills directories.

### Fixed
- Vite production build now sets base to `/ui/` so daemon-served UI assets resolve correctly.

## 0.1.0 - 2026-01-16

### Added
- Devservers Manager daemon (Fastify) with REST + WebSocket APIs to manage tmux windows and stream logs.
- Web UI for service controls, logs, edit flow, and quick actions; UI served from the daemon at `/ui/`.
- `devservers` CLI with bootstrap, list/status/add/remove/start/stop/restart; auto-starts daemon/UI if needed.
- Config schema with service env, optional port, and `portMode` (`static`, `detect`, `registry`), including log-based port detection.
- `lastStartedAt` tracking for service runs.
- Bundled Codex skills plus `install-skill` for agent workflows.
