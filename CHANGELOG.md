# Changelog

## Unreleased

### Added
- Stop action now shows a delayed spinner if the request takes longer than 100ms.
- UI now shows a dev-only error boundary message when rendering fails.
- Restart action now shows a spinner while the request is in flight.

### Changed
- Service cards now keep controls/utilities top-aligned with consistent button sizing and reserved utility space (Stop above Restart, 140x36 buttons).
- Controls now render via a shared action button helper component.
- Action spinners now resolve based on refreshed service status instead of local effects.
- Service cards now animate reordering via React ViewTransition (requires React canary).
- Slowed ViewTransition animation timing for service reorders.

### Fixed
- Publish workflow now uses `pnpm publish --filter` to avoid npm workspace publish errors.
- Bootstrap now starts the daemon from an existing window even if it was left in a different directory.
- CLI bootstrap now waits for the daemon to become reachable before returning.
- Stopping a service now removes its tmux window to avoid stale sessions.
- Restart spinner now persists until the service is running again.
- ViewTransition wrapper now references the runtime React export to avoid undefined component crashes.
- ViewTransition now pulls from the default React export so Vite's CJS interop can resolve it.

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
