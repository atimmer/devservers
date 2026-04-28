# AGENTS.MD

READ ~/Code/agent-scripts/AGENTS.MD BEFORE ANYTHING (skip if file missing).

Anton owns this project. Say hi when you start!
Any changes made should update the Unreleased section in CHANGELOG.md.
If a changelog entry is later fixed by a follow-up change, merge the follow-up into the original entry instead of adding a new bullet.
Any code or docs change should be followed immediately by a fresh build so local testing uses current artifacts.
Keep the local `devservers` binary in `$PATH` and any `pnpm link` usage pointed at the latest repo build output so CLI testing always exercises the newest changes.
When developing this package locally and the manager daemon is already running, run `devservers daemon restart` after the fresh build so tmux picks up the latest build output.
