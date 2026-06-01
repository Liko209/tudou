# Tudou — Multi-agent Collaboration Roadmap

**Status:** Draft v1
**Date:** 2026-05-28
**Author:** Liko + Claude Code (with input from Codex)
**Scope:** Phase 2 of the Tudou product, building on the Phase 1 MVP (single-session dashboard, Claude + Codex hosting, dormant resume).

---

## 0. Why this doc exists

Phase 1 shipped a working **observability console** — one window, many AI CLI sessions, status / cost / branch surfaced per session. The next phase is the differentiating one: **let those sessions actually collaborate on shared work**, both within one user's setup and (eventually) across users.

This doc was triggered by analysis of [hesamsheikh/octogent](https://github.com/hesamsheikh/octogent), an adjacent project with the same single-repo / multi-Claude target. Octogent has converged on patterns we can borrow (tentacles, hook-driven state, git worktree per worker) and also revealed pitfalls to avoid (agent-as-scheduler, in-memory channels, single-vendor lock-in).

The Phase 2 build-out is four milestones, executed in this order:

| # | Milestone | Cost | Unlock |
|---|---|---|---|
| 1 | **Per-session git worktree** | 1–2 days | Multiple agents safely edit the same project |
| 2 | **Shared project context (`.tudou/CONTEXT.md`)** | 1 day | Agents pull common context without human relaying |
| 3 | **Agent-to-agent messaging (same user)** | 2 days | "Agent A asks Agent B" without human in middle |
| 4 | **Tasks board** | 2–3 days | Visual task ↔ agent assignment surface |

Phase 3+ (cross-user A2A, federated relay, optional Slack adapter) builds on top of milestone 3. The design choices in milestone 3 are load-bearing for the future cross-user story — Section 4 covers this in detail.

---

## 1. Phase ordering rationale

Original instinct was 1 → 2 → 3 → 4 (worktree → context → tasks → A2A). On reflection we swapped 3 and 4 because:

- **Worktree (1) is infrastructure.** Without it, multi-agent work in one project will race the git index. Everything downstream depends on this.
- **Shared context (2) is the data substrate.** It gives agents a shared language (markdown files they all read/write), preparatory for messaging.
- **A2A messaging (3) is the strategic differentiator.** It directly delivers the "remove human as messenger" vision. Going early validates the architecture under real use.
- **Tasks board (4) is UX polish on top.** It makes the previous three legible to humans but doesn't enable anything new — it just exposes existing capability nicely.

---

## 2. Milestone 1 — Per-session git worktree

### Problem

Today, two sessions spawned in the same project share the same cwd. If both run `git checkout -b feature` or both modify the same file, results are non-deterministic at best, corrupting at worst. Multi-agent collaboration is impossible without process-level isolation.

### Approach (steal from Octogent)

When a session is spawned in a project (not chat) mode AND the project is a git repo, **automatically create a worktree**:

```bash
git worktree add ~/Library/Application\ Support/Tudou/worktrees/<sessionId> -b tudou/<sessionId-short>
```

The session's cwd becomes that worktree path. The session sees a normal git repo with all branches; it's just on its own branch in its own copy. PTY-spawned subprocesses (`git`, `pnpm`, `pytest`) see a normal working tree and behave correctly.

### Defaults & escape hatch

- **Default ON** for project sessions in git repos (the common case).
- **Default OFF** for chat sessions (no project, no worktree needed).
- **User toggle in NewSessionModal**: "Run in isolated worktree (recommended)". Opt-out for users who explicitly want to share the cwd.
- If `git worktree add` fails (e.g., uncommitted main-branch changes blocking branch creation), fall back to plain cwd + flag in InfoSheet so user sees they're on the main worktree.

### Lifecycle

- On session `release` (× from sidebar on live): worktree stays. Branch `tudou/<id>` remains so the user can merge later.
- On session `forget` (full removal from persistence): also `git worktree remove --force` + delete branch (with confirm dialog mentioning loss of uncommitted work in worktree).
- App quit: worktrees survive across restarts (they're on disk; only PTY died).

### IPC surface

Extends existing `SessionSpawnRequest`:

```ts
interface SessionSpawnRequest {
  // ... existing fields ...
  worktree?: boolean;  // default: true if project + git repo
}
```

New IPC channel `session:worktree-info` returns the worktree branch / path for an existing session so InfoSheet can display it.

### New file: `electron/git-worktree.ts`

Thin wrapper over `git` CLI. Functions:
- `createWorktree(repoRoot, sessionId): Promise<{ path: string; branch: string } | null>`
- `removeWorktree(repoRoot, sessionId): Promise<void>`
- `isGitRepo(path): Promise<boolean>`
- `listWorktrees(repoRoot): Promise<WorktreeInfo[]>` (for housekeeping / orphan detection on startup)

### UI surface

- NewSessionModal: checkbox "Run in isolated worktree" (default checked when project mode + git repo detected).
- Sidebar SessionRow: tiny branch icon next to live worktree sessions (with branch name in tooltip).
- InfoSheet: a "Workspace" field showing `worktree: tudou/abc123 @ .tudou/worktrees/...`.

### Risks

- Worktree paths in `~/Library/Application Support/Tudou/worktrees/` won't show in user's normal `git worktree list` from the project. We add a `tudou worktree` panel later if it becomes confusing — or use `<projectRoot>/.tudou/worktrees/` so it's local to the repo (matches Octogent's pattern).
- Auto-creating branches will accumulate. Add a `tudou worktree prune` action (or run on app quit) that removes worktrees for sessions older than X days with status='exited'.

---

## 3. Milestone 2 — Shared project context (Tentacle for Tudou)

### Problem

Today, every new session starts fresh. Agents have no shared notion of "what this project is", "what conventions to follow", "what other sessions did earlier". The user is forced to retype context into each session — or worse, paste between sessions manually.

### Approach

Adopt Octogent's **tentacle pattern**, scoped to the **project** (since one project may host many sessions). On a project's first session spawn (or via explicit init), Tudou creates:

```
<projectRoot>/.tudou/
├── CONTEXT.md         # project-wide context, read by every spawned agent
├── notes/
│   ├── <sessionId>.md # per-session scratch notes (agent writes; Tudou shows in InfoSheet)
│   └── ...
├── handoff/
│   ├── <date>-<from>-<to>.md  # explicit transfer artifacts between sessions
│   └── ...
├── channels/          # used by Milestone 3 — see Section 4
└── worktrees/         # if we adopt project-local instead of userData
```

### CONTEXT.md auto-injection

When spawning a session in a project that has `.tudou/CONTEXT.md`, Tudou prepends to the launch prompt:

```
There is project context at .tudou/CONTEXT.md. Read it before doing
anything else, and add to it as you learn things worth other sessions
knowing.
```

This works across all CLIs (Claude, Codex, Gemini) because we're just sending text to stdin via PTY — same byte stream all vendors accept.

### Notes tab in InfoSheet

The Session "info" sheet gains a "Notes" tab that edits `.tudou/notes/<sessionId>.md` directly (Monaco mini-editor or textarea, autosave). Agents write here too; humans read alongside.

### File watching

`.tudou/` is watched via chokidar. Changes by agents (via Edit / Write tools) trigger UI refresh — operator sees notes / context update live.

### IPC surface

New IPC channels:
- `project:init-tudou-dir(cwd)` — creates `.tudou/CONTEXT.md` skeleton
- `project:read-context(cwd)` — reads CONTEXT.md
- `project:write-context(cwd, content)` — overwrites
- `project:list-notes(cwd)` — returns `{sessionId, modified}[]`

### Why this is more than "another markdown file"

The trick is **automaticity**: agents are explicitly nudged to read CONTEXT.md and write notes. With shared substrate + multi-vendor support, the file becomes the actual cross-agent communication medium for Tudou — Claude can write a plan in CONTEXT.md and Codex can implement it 10 minutes later without any human relay. This is the **MVP of the "no human in middle" vision**, well before any messaging infrastructure.

---

## 4. Milestone 3 — Agent-to-agent messaging (same user MVP + cross-user design)

This milestone is **architecturally load-bearing for the next 2 years**. Decisions here lock in transport flexibility for cross-user expansion. The detailed discussion in Section 4 of this doc is more elaborate than the other milestones because the cost of getting this wrong is high.

### 4.1 Same-user MVP (`LocalFileTransport`)

What we ship in milestone 3:

```
<projectRoot>/.tudou/channels/
└── <roomId>/
    ├── 1709123456789-01HXYZ.json   # envelope per file
    ├── 1709123456800-01HABC.json
    └── ...
```

- Each room is a folder. Each message is a file (envelope JSON) named `<ts>-<id>.json` for lexicographic ordering.
- Tudou main process watches all room folders via chokidar.
- When a new envelope file appears AND `to.sessionId` matches a live session, AND that session's `status === 'idle'`, Tudou injects the payload's text representation into the target PTY (prefixed `[from <displayName> @ <hh:mm>] `).
- If target is `working` / `waiting`, queue and inject when next idle.
- If target is `exited`, leave the envelope on disk for the next time that session is resumed.

### 4.2 The architectural insight

What ships in milestone 3 looks trivial (chokidar + write to PTY). But the **envelope schema** and **`Channel` interface** we define are the actual deliverables, because they survive into Phase 3 cross-user.

```
┌────────────────────────────────────────────────────────┐
│  Application layer (Tudou UI, agent injection, files)  │
└────────────────────────────────────────────────────────┘
                          │
                  ChannelEnvelope (JSON)
                          │
┌────────────────────────────────────────────────────────┐
│  Channel interface                                      │
│    send(env) / subscribe() / presence() / close()       │
└────────────────────────────────────────────────────────┘
                          │
             swappable Transport impls
                          │
   ┌────────────┬────────────┬───────────────┬──────────┐
   ▼            ▼            ▼               ▼          ▼
┌─────────┐ ┌──────────┐ ┌──────────────┐ ┌────────┐ ┌──────┐
│ Local   │ │ Tudou    │ │ Slack        │ │ Discord│ │ Self │
│ File    │ │ Relay    │ │ adapter      │ │ adapter│ │-host │
│ (Ph 2)  │ │ (Ph 3)   │ │ (optional)   │ │ (later)│ │ relay│
└─────────┘ └──────────┘ └──────────────┘ └────────┘ └──────┘
```

In milestone 3 we only implement `LocalFileTransport`. But all higher-layer code (UI message lists, dedup, notification rendering) consumes envelopes — so adding `TudouRelayTransport` later is a transport-only patch.

### 4.3 Envelope draft (TODO: refine with Codex)

```ts
interface ChannelEnvelope {
  v: 1;
  id: string;            // ULID — total ordering + dedup
  threadId: string | null;
  ts: number;            // unix ms
  from: AgentAddress;
  to:   AgentAddress | RoomAddress;
  payload: ChannelPayload;
}

interface AgentAddress {
  userId: string;        // local = "self"; cross-user = identity provider id (gh:12345 / google:abc@gmail.com)
  sessionId: string;     // dashboard internal session id
  agentKind: 'claude' | 'codex' | 'gemini';
  displayName?: string;
}

interface RoomAddress {
  roomId: string;        // ULID
  // optional broadcast hint:
  targetAgentKind?: 'claude' | 'codex' | 'gemini';
}

type ChannelPayload =
  | { type: 'text'; body: string }
  | { type: 'task'; taskRef: string; instruction: string }
  | { type: 'handoff'; tentaclePath: string; summary: string }
  | { type: 'tool-result'; toolName: string; result: unknown }
  | { type: 'status'; state: 'idle' | 'working' | 'blocked' };
```

**This schema is preliminary.** Before locking it in milestone 3, run a design review with Codex specifically on:
- Backward compatibility strategy (envelope `v: 1` → 2 → 3 over years)
- Optional encryption envelope wrapping (for future remote transports)
- Threading model — flat `threadId` vs hierarchical `parentId`
- Whether `tool-result` payload should embed binary or only reference
- Whether `RoomAddress` and `AgentAddress` should be a tagged union or fully separate types

### 4.4 Why we won't make Slack the primary transport

Captured here so future-us doesn't relitigate:

| Concern | Impact |
|---|---|
| Bot/app install friction | Each user must install Tudou's Slack app, OAuth, pick channels — much higher than "open app, click send" |
| Workspace boundary is hard | Want to A2A with a friend at another company? Need guest invite or shared channel. Dev collab radius is much wider than "same Slack workspace" |
| Vendor lock-in | Slack API / pricing / free-tier changes hit us directly. Twitter API lesson is recent |
| Latency | 200–500 ms typical for Slack API; agent back-and-forth benefits from <100 ms |
| Format constraints | Slack messages are text-first; our payloads are structured. Cramming JSON into code blocks works but distorts |
| Pay gates | Free Slack workspaces have 90-day message retention — agent traffic burns through that fast |

Slack does win on auth + delivery being already-built. **We keep that win** by exposing Slack as an **optional transport adapter** later, not as the primary infrastructure.

### 4.5 Why we also won't build an IM from scratch

| Concern | Impact |
|---|---|
| Auth done right is hard | OAuth flows, MFA, account recovery — a separate product |
| Channel discovery / membership management | UI + backend stack |
| Spam / abuse | Mandatory once user count grows |
| Server cost + SLA | If we kill the service, cross-user feature dies |
| Yet-another-account friction | Devs hate it |

### 4.6 The middle path: federated relay with OAuth identity (Phase 3, not now)

When cross-user A2A becomes a priority (estimated 6–12 months out):

- **Identity**: GitHub OAuth (primary) + Google OAuth (secondary).
  - GitHub: most devs have it, free avatar / displayName, established OAuth pattern. `userId` = `gh:<numeric-stable-id>`.
  - Google: extremely common login, covers non-GitHub users (e.g. PMs, designers using AI agents). `userId` = `google:<sub>`.
  - Future: Apple / Microsoft if user base demands.
- **Transport**: thin WebSocket relay we host (Cloudflare Workers / Fly.io — keep cost trivial). Relay does **not parse payload** — it's a blind forwarder, enabling future E2E encryption.
- **Open source the relay** so privacy-sensitive teams can self-host. Tudou client supports custom relay URL.
- **Room model**: explicit invite (room ID + invite link); no public directory.

This is a real product investment but creates moat and avoids any single-vendor risk.

### 4.7 Operational concerns punted to Phase 3

- Rate limiting per user / per room
- Message retention policy
- Audit log for org-deployed scenarios
- Federation between two self-hosted relays (Matrix-style; probably not worth doing)
- E2E encryption (probably libsodium / age-style asymmetric)

### 4.8 What milestone 3 commits us to (and what it doesn't)

**Commits:**
- The `ChannelEnvelope` shape (modulo Codex review)
- The `Channel` interface (`send` / `subscribe` / `presence` / `close`)
- `userId` namespace ("self" for local, provider-prefixed for remote)
- File layout `.tudou/channels/<roomId>/<ts>-<id>.json`

**Does NOT commit us to:**
- Specific cross-user transport (relay or Slack or whatever — that's Phase 3)
- Authentication provider (we pick at Phase 3 time)
- Whether rooms are project-scoped or global (Phase 3 design call)

### 4.9 Open questions for Codex collaboration

When we get to milestone 3 implementation, run these by Codex:
- Envelope schema robustness (versioning, extension fields, payload type registry)
- Whether to use ULID vs UUIDv7 vs timestamp+random for `id`
- Inbox polling semantics: what happens to messages addressed to a forgotten session? TTL? Dead-letter?
- Same-user multi-instance: if user runs Tudou on laptop + desktop, do they share `.tudou/channels/`? Network filesystem races?

---

## 5. Milestone 4 — Tasks board

### Problem

Even with shared context, A2A messaging, and worktrees, the human operator needs a **visual surface** to assign work. Today, "agent A does this, agent B does that" lives only in the human's head or in `CONTEXT.md` prose.

### Approach (steal from Octogent)

Project-level `.tudou/tasks.md` with GitHub-flavored markdown checkboxes:

```md
## In progress
- [ ] Refactor auth middleware (@claude-1)
- [ ] Add session timeout (@codex-2)

## Backlog
- [ ] Write migration tests
- [ ] Update README
```

### Tudou-side rendering

- New Panel kind `tasks` (alongside `files` / `sidechat` / `terminal`).
- Parses `tasks.md` into a clickable checklist grouped by `## sections`.
- Each task displays: text, assigned agent (`@claude-1` parsed), checkbox state.
- **Click an unassigned task** → opens a NewSessionModal pre-filled:
  - The first line is the task text
  - Initial agent prompt: "You've been assigned this task from .tudou/tasks.md: <text>. When done, update the checkbox and add notes to .tudou/notes/<your-session-id>.md."
  - Spawn the session; assigned agent now shows in tasks.md (Tudou writes back the `@agent-id` reference)
- **Agent updates checkbox** → file change → UI refreshes → human sees progress.

### Cross-vendor handoff

Because this is just markdown, **the same task list works across Claude / Codex / Gemini**. A task started by Claude can be re-assigned to Codex by clicking → spawn Codex on it. This is a Tudou advantage Octogent can't have (single-vendor).

### Out of scope for milestone 4

- Kanban view (just a flat list per section is enough)
- Dependencies between tasks
- Time tracking / estimation
- Sub-tasks (use sub-bullet lists if needed)
- Notifications when tasks complete (we already have system notifications for status — wire later)

---

## 6. Out of scope for Phase 2 entirely

Things we explicitly are **not** doing, ranked by how often we'll be tempted to do them anyway:

- **Parent-coordinator-as-agent (Octogent's pattern)** — burns tokens to do scheduler work Tudou can do for free. Tudou's edge is being a real app; don't put LLMs in the control plane.
- **Cross-user A2A** — Phase 3 only. Milestone 3 makes it cheap to add but doesn't try.
- **Persistent identity / accounts** — no Tudou login screen yet. Identity comes with cross-user.
- **Marketplace of prebuilt agents / templates** — interesting but separate product surface.
- **Team / org features (multi-user shared projects on one machine)** — covered by cross-user A2A naturally if individuals just share a relay room.

---

## 7. Inspiration credits

- [hesamsheikh/octogent](https://github.com/hesamsheikh/octogent) — tentacle pattern, hook-driven state, parent-worker spawn pattern (rejected, see above), todo-as-API insight. Read the [mental-model](https://github.com/hesamsheikh/octogent/blob/main/docs/concepts/mental-model.md) and [inter-agent-messaging](https://github.com/hesamsheikh/octogent/blob/main/docs/guides/inter-agent-messaging.md) docs.

---

## 8. Sequencing summary

| When | What |
|---|---|
| **Now** | Phase 1 demo (Tudou v0.1) on internal / friends usage. Validate the single-session foundation. |
| **Phase 2 milestone 1** | Worktree per session |
| **Phase 2 milestone 2** | `.tudou/CONTEXT.md` + auto-injection |
| **Phase 2 milestone 3** | Same-user A2A with envelope architecture locked in (Codex review on envelope schema before lock-in) |
| **Phase 2 milestone 4** | Tasks board |
| **Phase 3 (6-12 months out)** | Tudou Relay + GitHub OAuth + Google OAuth → cross-user A2A |
| **Phase 3+** | Slack adapter (optional), self-hostable relay, E2E encryption |
