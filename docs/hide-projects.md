# Hide Projects — Design Note

**Status:** Implemented
**Date:** 2026-06-15

## Goal

Let the user remove a project from the left sidebar without deleting any files
or session history. "Hidden" is purely a view filter — the underlying sessions,
PTYs, and `~/.claude` / `~/.codex` logs are untouched.

## Key facts

- A "project" is not a first-class entity. It's a group of sessions sharing the
  same `cwd` (see `buildSidebarItems` in `sessions-store.ts`). So a project's
  identity is its **`cwd`** (absolute path).
- Preferences are persisted to disk as one JSON object and flow renderer↔main
  through the existing `preferences.get` / `preferences.set` IPC. No new channel
  is needed.

## Design

### Persistence
`Preferences.hiddenProjects: string[]` — a list of hidden cwds. Defaults to `[]`.
`mergeWithDefaults` validates it (array of strings, de-duplicated).

### Renderer state (single source of truth)
`ui-store.hiddenProjects` mirrors the persisted list. Both the sidebar and the
Settings page read it and mutate it through store actions, so a change in one
place reflects everywhere immediately:
- `loadHiddenProjects()` — fetch from prefs on app start (called by AppShell).
- `hideProject(cwd)` / `unhideProject(cwd)` — optimistic local update + write
  through to disk via `preferences.set`.
- `setHiddenProjects(list)` — pure setter used by load and post-reset sync.

### Filtering
`filterHiddenProjects(projects, hidden)` (pure, in `sessions-store.ts`) drops any
group whose cwd is hidden. The sidebar applies it to the built project list.

### Entry points
- **Hide:** an eye-off button appears on a project header on hover. If the
  project has a *running* session, a confirm dialog warns that the session keeps
  running but disappears from the list (unhide from Settings). Dormant-only
  projects hide immediately (fully reversible, low stakes).
- **Unhide:** Settings → "Hidden projects" lists each hidden cwd with an Unhide
  button.

### Auto-unhide
When a new session is spawned (`onAdd` in `use-session-bridge`) whose cwd is
hidden, it's auto-unhidden — so starting fresh work in a previously-hidden
folder never leaves a running-but-invisible session. Covers every spawn path
(modal, resume, project "+").

## Tests
- `preferences.test.ts` — `hiddenProjects` defaults, persistence, validation.
- `stores.test.ts` — `filterHiddenProjects` purity; `hideProject`/`unhideProject`
  optimistic transitions and de-duplication.
