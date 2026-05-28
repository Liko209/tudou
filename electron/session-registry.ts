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
import { detectLoginPrompt } from './login-detector';
import type { SessionPersistence } from './session-persistence';
import type { ClaudeHookPayload } from './hook-server';
import type { CliAdapter, SpawnArgsInput } from './adapters/types';

const LOGIN_SCAN_WINDOW_MS = 5000;
const LOGIN_SCAN_BUFFER_LIMIT = 8 * 1024;

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
   * Spawn a new CLI session. Creates a Session record in 'starting' state,
   * spawns the PTY, then asynchronously waits for the CLI's JSONL file to
   * appear and starts adapter watch in the background.
   */
  spawn(request: SpawnSessionRequest): SpawnSessionResult {
    const adapter = this.adapters[request.cli];
    const args = adapter.buildSpawnArgs(request.spawnArgs ?? {});
    const startedAt = new Date();

    const ptyId = this.pty.spawn({
      shell: request.shellPath,
      args,
      cwd: request.cwd,
      cols: request.cols,
      rows: request.rows,
      env: sanitizeSpawnEnv(process.env),
    });

    const sessionId = randomUUID();
    const session: Session = {
      id: sessionId,
      cli: request.cli,
      cliSessionId: null,
      cwd: request.cwd,
      gitBranch: null,
      displayName: autoName(request.cwd, startedAt),
      status: 'starting',
      statusConfidence: 'low',
      startedAt: startedAt.toISOString(),
      lastActivityAt: startedAt.toISOString(),
      metrics: freshMetrics(),
      latestMessage: null,
      currentTool: null,
      ptyExitCode: null,
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
    if (!targetId) return; // not our session

    // Mark hook as wired for this session — future updates stay 'high'.
    this.hookActiveCliSessionIds.add(cliSessionId);

    const update: SessionUpdate = { statusConfidence: 'high' };
    // Stop = end of turn, Notification = mid-turn permission/decision —
    // both mean "user needs to act". UserPromptSubmit means model is now
    // thinking on the user's input.
    if (event === 'Stop' || event === 'Notification') update.status = 'waiting';
    else if (event === 'UserPromptSubmit') update.status = 'working';
    this.applyUpdate(targetId, update);
  }

  /** Forward user keystrokes (or pasted text) to the session's PTY. */
  write(sessionId: string, data: string): void {
    const ptyId = this.ptyIdFor(sessionId);
    if (!ptyId) return;
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

      for await (const update of adapter.watch(file, controller.signal)) {
        if (!this.sessions.has(sessionId)) return;
        this.applyUpdate(sessionId, update);
      }
    } catch (err) {
      if (this.sessions.has(sessionId)) {
        this.markErrored(sessionId, err);
      }
    }
  }

  private applyUpdate(sessionId: string, update: SessionUpdate): void {
    const current = this.sessions.get(sessionId);
    if (!current) return;

    // If this session's hook has ever fired, force high confidence — we
    // know the hook is wired and adapter polling is now redundant.
    const hookActive =
      current.cliSessionId !== null && this.hookActiveCliSessionIds.has(current.cliSessionId);
    const nextConfidence = hookActive
      ? 'high'
      : (update.statusConfidence ?? current.statusConfidence);

    const next: Session = {
      ...current,
      ...(update.status !== undefined ? { status: update.status } : {}),
      ...(update.cliSessionId !== undefined ? { cliSessionId: update.cliSessionId } : {}),
      ...(update.gitBranch !== undefined ? { gitBranch: update.gitBranch } : {}),
      ...(update.metrics !== undefined ? { metrics: update.metrics } : {}),
      ...(update.latestMessage !== undefined ? { latestMessage: update.latestMessage } : {}),
      ...(update.currentTool !== undefined ? { currentTool: update.currentTool } : {}),
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

function autoName(cwd: string, at: Date): string {
  const base = basename(cwd) || cwd;
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${base} · ${hh}:${mm}`;
}

// Silence unused-type warnings if these are imported solely for narrowing
void (null as unknown as LatestMessage | CurrentTool | SessionStatus);
