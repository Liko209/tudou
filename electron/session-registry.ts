import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { CliKind, PtyDataEvent, PtyExitEvent } from '../shared/ipc-contracts';
import type {
  CurrentTool,
  LatestMessage,
  PreviousSession,
  Session,
  SessionMetrics,
  SessionStatus,
  SessionUpdate,
} from '../shared/session-types';
import { sanitizeSpawnEnv } from './env-sanitizer';
import { setClaudeTheme } from './claude-settings';
import { detectLoginPrompt } from './login-detector';
import type { SessionPersistence } from './session-persistence';
import type { ClaudeHookPayload } from './hook-server';
import type { CliAdapter, SpawnArgsInput } from './adapters/types';

const LOGIN_SCAN_WINDOW_MS = 5000;
const LOGIN_SCAN_BUFFER_LIMIT = 8 * 1024;

/**
 * Whether a PTY write represents genuine user input (a real answer to a
 * permission/choice prompt) rather than a terminal-generated control emission.
 *
 * xterm forwards EVERYTHING it produces to the PTY — including focus in/out
 * (`\x1b[O` / `\x1b[I`), arrow keys, and bracketed-paste markers. Crucially,
 * switching sessions blurs the old terminal, which then emits a focus-out
 * escape. We must NOT treat that as "the user answered", or the blocked bell
 * would vanish on every session switch. So we strip escape sequences and only
 * count it as input if a printable char or Enter/Tab remains.
 */
export function isUserInputData(data: string): boolean {
  /* eslint-disable no-control-regex -- matching terminal control/ESC bytes is the point */
  const stripped = data
    // CSI sequences: focus in/out, arrow keys (\x1b[A), \x1b[200~ paste, reports
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // SS3 sequences: application-mode arrows (\x1bOA), etc.
    .replace(/\x1bO[@-~]/g, '')
    // any lone/leftover ESC
    .replace(/\x1b/g, '');
  // Enter/Tab, or any non-control character (printable text, digits) = input.
  return /[\r\n\t]/.test(stripped) || /[^\x00-\x1f\x7f]/.test(stripped);
  /* eslint-enable no-control-regex */
}
// Trailing debounce for status transitions. Long enough to swallow the
// transcript-replay burst on open (which is microtask-driven, so the timer
// only fires once the burst settles), short enough to be imperceptible live.
const STATUS_COALESCE_MS = 40;

/** Narrow view of PtyManager used by SessionRegistry — keeps tests light. */
export interface PtyHandle {
  spawn(opts: {
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env?: Record<string, string>;
  }): string;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string, signal?: string): void;
  getBuffer(id: string): string;
  on(event: 'data', listener: (e: PtyDataEvent) => void): unknown;
  on(event: 'exit', listener: (e: PtyExitEvent) => void): unknown;
  off(event: 'data', listener: (e: PtyDataEvent) => void): unknown;
  off(event: 'exit', listener: (e: PtyExitEvent) => void): unknown;
  disposeAll(): void;
}

export interface SpawnSessionRequest {
  cli: CliKind;
  cwd: string;
  cols: number;
  rows: number;
  /** Absolute path to the CLI binary (resolve upstream via cli-resolver). */
  shellPath: string;
  spawnArgs?: SpawnArgsInput;
  /** Mark as panel-only (Side chat) — filtered from main sidebar. */
  panelOnly?: boolean;
  /** Forwarded to env-sanitizer → COLORFGBG so the CLI matches our theme. */
  theme?: 'dark' | 'light';
  /** User-configured proxy / custom env to inject into the spawned CLI. */
  extraEnv?: Record<string, string>;
}

/**
 * Root under which ad-hoc Chat working dirs live. If a session's cwd starts
 * with this path it's classified as a Chat (no project basename in its
 * displayName); otherwise it's a Project session.
 *
 * Inject from main via setChatsBaseDir() once at startup.
 */
let chatsRoot = '';
export function setChatsBaseDir(dir: string): void {
  chatsRoot = dir;
}

export interface SpawnSessionResult {
  session: Session;
  ptyId: string;
}

interface SessionDataEvent {
  sessionId: string;
  data: string;
}

interface SessionRegistryEvents {
  add: [Session];
  update: [Session];
  remove: [{ id: string }];
  data: [SessionDataEvent];
  /**
   * Fired only at the moments that actually warrant a notification — a
   * Claude hook reporting end-of-turn (Stop) or a mid-turn permission
   * request (Notification). Distinct from `update`/status flicker, which
   * the JSONL adapter emits many times per turn (e.g. between tool calls).
   */
  attention: [Session];
}

export class SessionRegistry extends EventEmitter<SessionRegistryEvents> {
  private readonly sessions = new Map<string, Session>();
  private readonly adapterControllers = new Map<string, AbortController>();
  private readonly ptyToSession = new Map<string, string>();
  /**
   * cliSessionIds we've heard from via the hook pipeline. Once a session
   * appears here, all subsequent applyUpdates for it stay at
   * statusConfidence='high' — we've proven the hook is wired up.
   */
  private readonly hookActiveCliSessionIds = new Set<string>();

  /**
   * The session the user is currently viewing (reported by the renderer). Used
   * only to suppress the sound cue for the session you're already watching —
   * not authoritative for anything else. null = none / unknown.
   */
  private activeSessionId: string | null = null;

  /**
   * Per-session running PTY-output buffer for login-prompt detection.
   * Populated only during the first few seconds after spawn; cleared
   * once we either flag the session or hit the time window.
   */
  private readonly loginScanBuffers = new Map<string, string>();
  private readonly loginScanTimers = new Map<string, NodeJS.Timeout>();
  private readonly onPtyExit: (e: PtyExitEvent) => void;
  private readonly onPtyData: (e: PtyDataEvent) => void;

  constructor(
    private readonly pty: PtyHandle,
    private readonly adapters: Record<CliKind, CliAdapter>,
    private readonly persistence?: SessionPersistence,
  ) {
    super();
    this.onPtyExit = (event) => this.handlePtyExit(event);
    this.onPtyData = (event) => this.handlePtyData(event);
    this.pty.on('exit', this.onPtyExit);
    this.pty.on('data', this.onPtyData);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  get(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  ptyIdFor(sessionId: string): string | null {
    for (const [ptyId, sid] of this.ptyToSession) {
      if (sid === sessionId) return ptyId;
    }
    return null;
  }

  sessionIdForPty(ptyId: string): string | null {
    return this.ptyToSession.get(ptyId) ?? null;
  }

  /**
   * Recent PTY output for the session, used to repopulate a fresh
   * xterm after a renderer reload. Empty string if the session has
   * no PTY (already exited) or no buffered output yet.
   */
  getScrollback(sessionId: string): string {
    const ptyId = this.ptyIdFor(sessionId);
    if (!ptyId) return '';
    return this.pty.getBuffer(ptyId);
  }

  /**
   * Spawn a new CLI session. Creates a Session record in 'starting' state,
   * spawns the PTY, then asynchronously waits for the CLI's JSONL file to
   * appear and starts adapter watch in the background.
   */
  spawn(request: SpawnSessionRequest): SpawnSessionResult {
    const adapter = this.adapters[request.cli];
    const args = adapter.buildSpawnArgs(request.spawnArgs ?? {});
    const startedAt = new Date();

    // Claude reads its theme from ~/.claude/settings.json at startup —
    // make sure it matches the dashboard before we launch.
    if (request.cli === 'claude' && request.theme) {
      setClaudeTheme(request.theme);
    }

    const ptyId = this.pty.spawn({
      shell: request.shellPath,
      args,
      cwd: request.cwd,
      cols: request.cols,
      rows: request.rows,
      env: sanitizeSpawnEnv(process.env, { theme: request.theme, extraEnv: request.extraEnv }),
    });

    // Preserve a prior session's identity when resuming: the custom/auto title
    // and name (so a rename survives) AND the original creation time (so the
    // sidebar — sorted by creation — keeps the session in place instead of
    // jumping it to the top on every resume).
    let carried: { displayName: string; title: string | null; startedAt: string } | null = null;
    if (this.persistence && request.spawnArgs?.resume) {
      const prior = this.persistence
        .list()
        .find((r) => r.cli === request.cli && r.cliSessionId === request.spawnArgs!.resume);
      if (prior) {
        carried = { displayName: prior.displayName, title: prior.title ?? null, startedAt: prior.startedAt };
      }
    }

    const sessionId = randomUUID();
    const session: Session = {
      id: sessionId,
      cli: request.cli,
      cliSessionId: null,
      cwd: request.cwd,
      gitBranch: null,
      displayName: carried?.displayName ?? autoName(request.cwd, startedAt, request.cli),
      title: carried?.title ?? null,
      status: 'starting',
      statusConfidence: 'low',
      startedAt: carried?.startedAt ?? startedAt.toISOString(),
      lastActivityAt: startedAt.toISOString(),
      metrics: freshMetrics(),
      latestMessage: null,
      currentTool: null,
      ptyExitCode: null,
      ...(request.panelOnly ? { panelOnly: true } : {}),
    };

    this.sessions.set(sessionId, session);
    this.ptyToSession.set(ptyId, sessionId);

    // Arm login-prompt detection for the spawn window.
    this.loginScanBuffers.set(sessionId, '');
    this.loginScanTimers.set(
      sessionId,
      setTimeout(() => this.stopLoginScan(sessionId), LOGIN_SCAN_WINDOW_MS),
    );

    // Persistence: drop any stale prior record for the resumed cli session
    // (so we don't accumulate duplicates over many resumes), then write a
    // provisional record for this new spawn. cliSessionId will be patched
    // in once the adapter discovers it.
    if (this.persistence) {
      if (request.spawnArgs?.resume) {
        this.persistence.removeByCliSessionId(request.cli, request.spawnArgs.resume);
      }
      this.persistence.upsert({
        id: sessionId,
        cli: request.cli,
        cliSessionId: request.spawnArgs?.resume ?? null,
        cwd: request.cwd,
        displayName: session.displayName,
        title: session.title,
        startedAt: session.startedAt,
      });
    }

    this.emit('add', session);

    void this.startWatching(
      sessionId,
      request.cli,
      request.cwd,
      startedAt,
      request.spawnArgs?.resume,
    );

    return { session, ptyId };
  }

  /** Terminate a session — kills the PTY, which fires exit cleanup. */
  kill(sessionId: string, signal?: string): void {
    const ptyId = this.ptyIdFor(sessionId);
    if (ptyId) this.pty.kill(ptyId, signal);
  }

  /** Defer to the per-CLI adapter for "what can I resume in this cwd?". */
  listResumable(cli: CliKind, cwd: string) {
    return this.adapters[cli].listResumable(cwd);
  }

  /**
   * Reconcile persisted records against the CLIs' on-disk session files.
   * Each persisted record becomes a PreviousSession marked `resumable`
   * (file still present) or not (file gone, e.g. CLI history cleared).
   */
  async listPrevious(): Promise<PreviousSession[]> {
    if (!this.persistence) return [];
    const records = this.persistence.list();
    const result: PreviousSession[] = [];
    for (const rec of records) {
      let resumable = false;
      if (rec.cliSessionId) {
        const file = await this.adapters[rec.cli].findFileBySessionId(
          rec.cwd,
          rec.cliSessionId,
        );
        resumable = file !== null;
      }
      result.push({
        id: rec.id,
        cli: rec.cli,
        cliSessionId: rec.cliSessionId,
        cwd: rec.cwd,
        displayName: rec.displayName,
        title: rec.title ?? null,
        startedAt: rec.startedAt,
        resumable,
      });
    }
    // Newest first.
    return result.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /** Drop a single persisted record (no live session involved). */
  dismissPrevious(id: string): void {
    this.persistence?.remove(id);
  }

  /** Drop all persisted records that are NOT currently live. */
  dismissAllPrevious(): void {
    if (!this.persistence) return;
    const live = new Set(this.sessions.keys());
    for (const rec of this.persistence.list()) {
      if (!live.has(rec.id)) this.persistence.remove(rec.id);
    }
  }

  /**
   * Apply a Claude hook event. Looks up the dashboard session by the
   * Claude-native session_id; ignores hooks for sessions we don't own
   * (which is correct — Claude fires the same hook for every active
   * Claude CLI on the machine, dashboard-spawned or not).
   */
  applyHookEvent(payload: ClaudeHookPayload): void {
    const cliSessionId = payload.session_id;
    const event = payload.hook_event_name;
    if (!cliSessionId) return;

    let targetId: string | null = null;
    for (const [id, s] of this.sessions) {
      if (s.cli === 'claude' && s.cliSessionId === cliSessionId) {
        targetId = id;
        break;
      }
    }

    // Drift recovery: if no session matches the hook's session_id but exactly
    // one of our live Claude sessions is in the hook's cwd and hasn't been
    // hook-wired yet, adopt this id for it. The hook payload's (session_id, cwd)
    // is authoritative, so this self-heals a stale/wrong cliSessionId (e.g. a
    // resume that captured the wrong id) — otherwise the session is stuck on the
    // adapter's flaky status forever, never going hook-active.
    if (!targetId && payload.cwd) {
      const candidates = [...this.sessions.entries()].filter(
        ([, s]) =>
          s.cli === 'claude' &&
          s.cwd === payload.cwd &&
          s.status !== 'exited' &&
          s.status !== 'errored' &&
          !(s.cliSessionId !== null && this.hookActiveCliSessionIds.has(s.cliSessionId)),
      );
      const only = candidates.length === 1 ? candidates[0] : null;
      if (only) {
        targetId = only[0];
        this.applyUpdate(targetId, { cliSessionId }, false); // re-point to the real id
      }
    }
    if (!targetId) return; // not our session

    // Mark hook as wired for this session — future updates stay 'high'.
    this.hookActiveCliSessionIds.add(cliSessionId);

    const prevStatus = this.sessions.get(targetId)?.status;

    const update: SessionUpdate = { statusConfidence: 'high' };
    // Map the hook event to a status:
    //  - Stop              → 'waiting'  (turn finished, your turn)
    //  - UserPromptSubmit  → 'working'  (model now acting on your input)
    //  - PermissionRequest → 'blocked'  (a permission/choice dialog appeared)
    //  - Notification      → depends on notification_type: an idle prompt means
    //    Claude finished and is waiting ('waiting'); anything else needing a
    //    decision (e.g. permission_prompt) is 'blocked'.
    //
    // PermissionRequest is what makes 'blocked' reliable: Notification only
    // arrives when Claude actually sends an OS notification (suppressed while
    // the terminal is focused), so on its own it missed prompts the user was
    // staring at — leaving the session stuck on the adapter's 'working' spinner.
    if (event === 'Stop') update.status = 'waiting';
    else if (event === 'UserPromptSubmit') update.status = 'working';
    else if (event === 'PermissionRequest') update.status = 'blocked';
    else if (event === 'Notification')
      update.status = payload.notification_type === 'idle_prompt' ? 'waiting' : 'blocked';
    this.applyUpdate(targetId, update, true);

    // 'waiting'/'blocked' are the authoritative "notify now" signals — emit a
    // dedicated event so the lifecycle manager can notify on them rather than on
    // noisy adapter status flicker. Dedup only the blocked RE-FIRE: when both
    // PermissionRequest and a Notification(permission_prompt) arrive for the same
    // prompt, the second sees us already 'blocked' and stays quiet. A 'waiting'
    // (Stop) always notifies — turn-end is meaningful even if the adapter had
    // already flickered the status there.
    const needsUser = update.status === 'waiting' || update.status === 'blocked';
    const blockedReFire = update.status === 'blocked' && prevStatus === 'blocked';
    if (needsUser && !blockedReFire) {
      const session = this.sessions.get(targetId);
      if (session) this.emit('attention', session);
    }
  }

  /** Record which session the user is currently viewing (renderer hint). */
  setActiveSession(id: string | null): void {
    this.activeSessionId = id;
  }

  /** The session the user is currently viewing, if any. */
  get activeSession(): string | null {
    return this.activeSessionId;
  }

  /**
   * True once a Claude hook has fired for this session — i.e. we have the
   * reliable Stop/Notification signal and no longer need to fall back to
   * the JSONL adapter's heuristic status transitions for notifications.
   */
  isHookActive(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    return s?.cliSessionId != null && this.hookActiveCliSessionIds.has(s.cliSessionId);
  }

  /** Forward user keystrokes (or pasted text) to the session's PTY. */
  write(sessionId: string, data: string): void {
    const ptyId = this.ptyIdFor(sessionId);
    if (!ptyId) return;
    // Responding to a permission/choice prompt clears 'blocked' immediately:
    // genuine input (picking an option, hitting enter) means the session is
    // moving again. We force it through (fromHook) to beat the blocked
    // suppression; the adapter / next hook re-confirm the status from there.
    // Terminal-generated escapes (notably the focus-out a session emits when
    // you switch away) are NOT input, so the bell survives session switches —
    // it only clears when the user actually answers.
    const session = this.sessions.get(sessionId);
    if (session?.status === 'blocked' && isUserInputData(data)) {
      this.applyUpdate(sessionId, { status: 'working' }, true);
    }
    this.pty.write(ptyId, data);
  }

  /** Resize the session's PTY (rows × cols). */
  resize(sessionId: string, cols: number, rows: number): void {
    const ptyId = this.ptyIdFor(sessionId);
    if (!ptyId) return;
    this.pty.resize(ptyId, cols, rows);
  }

  /** Stop watching + remove the record without killing the PTY. */
  forget(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    this.cleanupWatch(sessionId);
    this.sessions.delete(sessionId);
    for (const [ptyId, sid] of this.ptyToSession) {
      if (sid === sessionId) this.ptyToSession.delete(ptyId);
    }
    this.persistence?.remove(sessionId);
    this.emit('remove', { id: sessionId });
  }

  /**
   * Like `forget`, but keeps the persistence record so the session can
   * be lazily resumed later from the sidebar. Used when the user closes
   * a live session tab — the underlying CLI history file still exists,
   * so we want it to reappear as a dormant entry next refresh.
   */
  release(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    this.cleanupWatch(sessionId);
    this.sessions.delete(sessionId);
    for (const [ptyId, sid] of this.ptyToSession) {
      if (sid === sessionId) this.ptyToSession.delete(ptyId);
    }
    this.emit('remove', { id: sessionId });
  }

  /**
   * Set a custom title on a session. Works for both live sessions (updates
   * the in-memory record + emits an update) and dormant ones (patches the
   * persistence record only). An empty/whitespace title clears it back to
   * null, which re-enables first-prompt auto-seeding.
   */
  rename(sessionId: string, title: string): void {
    const clean = title.trim();
    const next = clean === '' ? null : clean;
    const session = this.sessions.get(sessionId);
    if (session) {
      const updated: Session = {
        ...session,
        title: next,
        lastActivityAt: new Date().toISOString(),
      };
      this.sessions.set(sessionId, updated);
      this.persistence?.patch(sessionId, { title: next });
      this.emit('update', updated);
      return;
    }
    // Dormant session — only the persisted record exists.
    this.persistence?.patch(sessionId, { title: next });
  }

  disposeAll(): void {
    for (const ctl of this.adapterControllers.values()) ctl.abort();
    this.adapterControllers.clear();
    for (const timer of this.loginScanTimers.values()) clearTimeout(timer);
    this.loginScanTimers.clear();
    this.loginScanBuffers.clear();
    this.ptyToSession.clear();
    this.sessions.clear();
    this.pty.off('exit', this.onPtyExit);
    this.pty.off('data', this.onPtyData);
    this.pty.disposeAll();
  }

  // ---- internals ----

  private async startWatching(
    sessionId: string,
    cli: CliKind,
    cwd: string,
    after: Date,
    resumeId?: string,
  ): Promise<void> {
    const adapter = this.adapters[cli];
    const controller = new AbortController();
    this.adapterControllers.set(sessionId, controller);

    try {
      // Resume fast-path: we know the file exactly, no need to wait for
      // the CLI to materialize it. Parser reads existing content and
      // promotes status from 'starting' → whatever the last line says
      // (usually 'waiting').
      let file: string | null = null;
      if (resumeId) {
        file = await adapter.findFileBySessionId(cwd, resumeId);
      }
      if (!file) {
        file = await adapter.locateSessionFile(cwd, after, controller.signal);
      }
      if (!file || controller.signal.aborted) return;

      // Coalesce STATUS only. Opening a session replays the whole transcript
      // (one update per line, all in a microtask burst), so the dot would
      // flicker green↔amber through every historical turn. We apply the
      // other fields (metrics, latestMessage, …) immediately — that keeps
      // the count-up and first-prompt title seeding intact — but buffer the
      // status and apply just the final value once the burst goes quiet.
      let pendingStatus: SessionStatus | undefined;
      let statusTimer: ReturnType<typeof setTimeout> | null = null;
      let initialReplayDone = false;
      const flushStatus = (): void => {
        statusTimer = null;
        if (pendingStatus === undefined || !this.sessions.has(sessionId)) return;
        // On resume, the transcript's trailing status is historical: the CLI
        // loaded the session and is idle (waiting for input), not actually
        // mid-task — even when the transcript ends on an open tool_use or a
        // tool_result. Clamp that first settled status to 'waiting' so the dot
        // isn't a misleading green. Live updates afterward drive it normally.
        const clampStale =
          !initialReplayDone && resumeId !== undefined && pendingStatus === 'working';
        this.applyUpdate(sessionId, { status: clampStale ? 'waiting' : pendingStatus });
        initialReplayDone = true;
        pendingStatus = undefined;
      };
      try {
        for await (const update of adapter.watch(file, controller.signal)) {
          if (!this.sessions.has(sessionId)) break;
          const { status, ...rest } = update;
          if (Object.keys(rest).length > 0) this.applyUpdate(sessionId, rest);
          if (status !== undefined) {
            pendingStatus = status;
            if (statusTimer) clearTimeout(statusTimer);
            statusTimer = setTimeout(flushStatus, STATUS_COALESCE_MS);
          }
        }
      } finally {
        if (statusTimer) clearTimeout(statusTimer);
        flushStatus();
      }
    } catch (err) {
      if (this.sessions.has(sessionId)) {
        this.markErrored(sessionId, err);
      }
    }
  }

  private applyUpdate(sessionId: string, update: SessionUpdate, fromHook = false): void {
    const current = this.sessions.get(sessionId);
    if (!current) return;

    // If this session's hook has ever fired, force high confidence — we
    // know the hook is wired and adapter polling is now redundant.
    const hookActive =
      current.cliSessionId !== null && this.hookActiveCliSessionIds.has(current.cliSessionId);
    const nextConfidence = hookActive
      ? 'high'
      : (update.statusConfidence ?? current.statusConfidence);

    // Status authority for hook-active sessions is ASYMMETRIC:
    //  - The hook is the source of truth for END of turn — only Stop moves a
    //    hook-active session to 'waiting'. The adapter's JSONL heuristic flips
    //    to 'waiting' on any text-only assistant message, which would drop the
    //    pulse mid-turn; we suppress that.
    //  - The adapter MAY turn the pulse ON ('working'): JSONL activity reliably
    //    means the session is busy. This self-heals a missed UserPromptSubmit
    //    hook — without it the session would be stuck at 'waiting' for the whole
    //    turn while clearly working.
    //  - EXCEPT it must not override 'blocked' (Notification hook = needs your
    //    decision/permission). While blocked, the offending tool_use stays open,
    //    so the adapter keeps emitting 'working'; letting that through would mask
    //    the blocked state. Only a hook (Stop/UserPromptSubmit) clears blocked.
    // Non-hook sessions: adapter owns status entirely, as before.
    const applyStatus =
      update.status !== undefined &&
      (fromHook ||
        !hookActive ||
        (update.status === 'working' && current.status !== 'blocked'));

    // Auto-seed a title from the first user prompt so sessions sharing a
    // project don't all read `<project> · HH:MM`. Only fires while title is
    // still empty — a user rename (non-null) is never clobbered, and later
    // prompts don't keep rewriting it.
    const seededTitle =
      !current.title && update.latestMessage?.role === 'user'
        ? deriveTitle(update.latestMessage.preview)
        : null;

    const next: Session = {
      ...current,
      ...(applyStatus ? { status: update.status } : {}),
      ...(update.cliSessionId !== undefined ? { cliSessionId: update.cliSessionId } : {}),
      ...(update.gitBranch !== undefined ? { gitBranch: update.gitBranch } : {}),
      ...(update.metrics !== undefined ? { metrics: update.metrics } : {}),
      ...(update.latestMessage !== undefined ? { latestMessage: update.latestMessage } : {}),
      ...(update.currentTool !== undefined ? { currentTool: update.currentTool } : {}),
      ...(update.model !== undefined ? { model: update.model } : {}),
      ...(seededTitle ? { title: seededTitle } : {}),
      statusConfidence: nextConfidence,
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, next);

    // Persist newly-discovered cliSessionId so future resumes can find it.
    if (
      this.persistence &&
      update.cliSessionId !== undefined &&
      update.cliSessionId !== current.cliSessionId
    ) {
      this.persistence.patch(sessionId, { cliSessionId: update.cliSessionId });
    }
    if (this.persistence && seededTitle) {
      this.persistence.patch(sessionId, { title: seededTitle });
    }

    this.emit('update', next);
  }

  private handlePtyData({ id: ptyId, data }: PtyDataEvent): void {
    const sessionId = this.ptyToSession.get(ptyId);
    if (!sessionId) return;
    this.emit('data', { sessionId, data });
    this.scanForLoginPrompt(sessionId, data);
  }

  private scanForLoginPrompt(sessionId: string, chunk: string): void {
    const prev = this.loginScanBuffers.get(sessionId);
    if (prev === undefined) return; // window closed
    const next = (prev + chunk).slice(-LOGIN_SCAN_BUFFER_LIMIT);
    this.loginScanBuffers.set(sessionId, next);
    if (detectLoginPrompt(next)) {
      this.stopLoginScan(sessionId);
      this.markLoginRequired(sessionId);
    }
  }

  private stopLoginScan(sessionId: string): void {
    const timer = this.loginScanTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.loginScanTimers.delete(sessionId);
    }
    this.loginScanBuffers.delete(sessionId);
  }

  private markLoginRequired(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const cliName = session.cli;
    this.applyUpdate(sessionId, {
      status: 'errored',
      latestMessage: {
        role: 'tool',
        preview: `Login required — run \`${cliName}\` once outside the dashboard to sign in, then start a new session.`,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private handlePtyExit({ id: ptyId, exitCode }: PtyExitEvent): void {
    const sessionId = this.ptyToSession.get(ptyId);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const next: Session = {
      ...session,
      status: exitCode === 0 ? 'exited' : 'errored',
      ptyExitCode: exitCode,
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, next);
    this.emit('update', next);
    this.cleanupWatch(sessionId);
    this.ptyToSession.delete(ptyId);
  }

  private markErrored(sessionId: string, err: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const next: Session = {
      ...session,
      status: 'errored',
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, next);
    this.emit('update', next);
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[session ${sessionId}] adapter error:`, err);
    }
  }

  private cleanupWatch(sessionId: string): void {
    const ctl = this.adapterControllers.get(sessionId);
    ctl?.abort();
    this.adapterControllers.delete(sessionId);
  }
}

// ---- helpers ----

function freshMetrics(): SessionMetrics {
  return {
    tokensInput: 0,
    tokensOutput: 0,
    tokensCached: 0,
    estimatedCostUSD: null,
    messageCount: 0,
  };
}

const TITLE_MAX = 40;

/**
 * Turn the first user prompt into a compact one-line title: first
 * non-empty line, whitespace collapsed, capped at TITLE_MAX chars.
 * Returns null if nothing usable remains (e.g. a blank prompt).
 */
function deriveTitle(preview: string): string | null {
  const firstLine = preview
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const collapsed = firstLine.replace(/\s+/g, ' ');
  return collapsed.length > TITLE_MAX ? `${collapsed.slice(0, TITLE_MAX - 1).trimEnd()}…` : collapsed;
}

function autoName(cwd: string, at: Date, cli: CliKind): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (chatsRoot && cwd.startsWith(chatsRoot)) {
    // Chat: don't surface the uuid working dir; lead with the CLI name.
    const label = cli === 'claude' ? 'Claude' : cli === 'codex' ? 'Codex' : cli;
    return `${label} · ${time}`;
  }
  const base = basename(cwd) || cwd;
  return `${base} · ${time}`;
}

// Silence unused-type warnings if these are imported solely for narrowing
void (null as unknown as LatestMessage | CurrentTool | SessionStatus);
