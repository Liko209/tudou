# Usage Dashboard — Design

Inspired by `graykode/abtop` ("htop for AI coding agents"), but in Tudou's own
non-terminal visual style. A full-screen **Usage** view that aggregates and
visualizes what each session consumes.

## Placement

A dedicated full-screen view in the center pane, toggled by a **Usage** entry in
the sidebar. Terminals stay mounted underneath (PTYs alive); the Usage view is
an overlay shown when `usageOpen` is true. Selecting a session closes it.

- `ui-store`: `usageOpen: boolean`, `setUsageOpen`. Selecting a session sets it
  false. Sidebar "Usage" button toggles it (highlighted when active).
- `CenterPane`/`AppShell`: render `<UsageView>` absolutely over the center area
  when `usageOpen`, so the terminal stack is preserved.

## Data sources

Tudou already tracks, per session: `metrics.{tokensInput, tokensOutput,
tokensCached, estimatedCostUSD, contextTokens, contextLimit, messageCount}`,
`model`, `cli`, `status`, `cwd`, `gitBranch`, `startedAt`, `lastActivityAt`.
Model pricing + context limits live in `electron/adapters/cost-calculator.ts`.

- **M1 (live)** — pure renderer aggregation of the live `sessions` map. No new
  data plumbing.
- **M2 (history)** — `electron/usage-scanner.ts` scans `~/.claude/projects/**/*.jsonl`
  (+ Codex sessions) and sums usage by day / model / project. IPC
  `usage:getHistory`. Reuses adapter usage-extraction; cached + incremental.
- **M3 (quota)** — investigate where Claude Code persists rate-limit/quota state
  locally (`~/.claude*`). If found, parse + expose via IPC; else degrade to
  "unavailable" with a note.

## Modules / features

### M1 — Live aggregate view (ships first)
- **F1.1** `renderer/lib/usage.ts` `summarizeUsage(sessions)` → `UsageSummary`
  (pure, unit-tested): totals (cost, in/out/cached tokens), `statusCounts`,
  `byModel` breakdown (sessions, tokens, cost), `hasCostData`.
- **F1.2** `UsageView` component — aggregate cards (total cost, total tokens,
  status counts), model-distribution bars, per-session table with context-%
  bars / tokens / cost, using our design tokens + `CliBadge` + `StatusDot`.
- **F1.3** Sidebar **Usage** entry + `ui-store.usageOpen` + center overlay
  wiring; selecting a session closes Usage.

### M2 — Historical usage
- **F2.1** `usage-scanner.ts`: enumerate + parse JSONL, sum usage by day/model/
  project; bounded + cached. Unit-test the parse/aggregate on fixtures.
- **F2.2** IPC `usage:getHistory` + preload `usage` API + types.
- **F2.3** History panels in `UsageView`: today / this week totals, a per-day
  sparkline/bars, by-model and by-project tables.

### M3 — Rate-limit / quota
- **F3.1** Investigate Claude local quota data; document findings.
- **F3.2** If available: parse + IPC `usage:getQuota`; quota gauges in the view.
  Else: graceful "unavailable" state.

## Test strategy

- `summarizeUsage` and the scanner's parse/aggregate: pure unit tests
  (vitest, Node) on fixtures — no real FS for the aggregation logic.
- Scanner FS enumeration: a small temp-dir fixture test (read-only).
- UI: no snapshot tests; rely on typecheck + manual smoke (the `run` skill).

## Status

- [x] M1 — live aggregate view (full-screen, sidebar entry, summarizeUsage + tests)
- [x] M2 — historical usage (Claude): usage-history fold/finalize + usage-scanner
  (mtime-cached) + IPC + History panels (today / 7d / all-time, 14-day bars,
  top models/projects). Codex history is a follow-up.
- [x] M3 — rate-limit / quota (opt-in): Claude exposes `rate_limits`
  (five_hour/seven_day, used%, resets_at) only via the **statusLine** payload.
  A Tudou statusLine wrapper captures it to `~/.claude/tudou-rate-limits.json`
  and delegates to the user's existing statusLine command (preserved).
  parseRateLimits + RateLimitTracker (install/restore) tested; wrapper
  smoke-tested end-to-end. UI: enable CTA + 5h/weekly gauges with reset
  countdown. (System monitor bits — child processes/ports/subagents — remain a
  possible M4.)
