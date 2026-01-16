# Changelog

## Unreleased

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
