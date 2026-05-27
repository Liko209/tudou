# Fixtures

Synthetic JSONL session files modeled after real Claude Code and Codex CLI
output. Used by adapter parser unit tests so we don't ship anyone's real
prompts or paths in the repo.

All fields here are hand-crafted to mirror observed real-world shapes
(verified 2026-05-27 against:
- ~/.claude/projects/-Users-leecoor-Documents-Workspace-Personal-agent-dashboard/b6223bf4-…jsonl
- ~/.codex/archived_sessions/rollout-2026-05-24T21-16-04-…jsonl
- ~/.claude/projects/-Users-leecoor/sessions-index.json
- ~/.codex/session_index.jsonl
).

When the upstream CLIs add or rename event types, refresh by inspecting a
new real session and updating these fixtures (keep them small and synthetic).
