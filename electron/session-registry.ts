import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { CliKind, PtyDataEvent, PtyExitEvent } from '../shared/ipc-contracts';
import type {
  CurrentTool,
  LatestMessage,
  Session,
  SessionMetrics,
  SessionStatus,
  SessionUpdate,
} from '../shared/session-types';
import { sanitizeSpawnEnv } from './env-sanitizer';
import type { CliAdapter, SpawnArgsInput } from './adapters/types';

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
  private readonly onPtyExit: (e: PtyExitEvent) => void;
  private readonly onPtyData: (e: PtyDataEvent) => void;

  constructor(
    private readonly pty: PtyHandle,
    private readonly adapters: Record<CliKind, CliAdapter>,
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
    this.emit('remove', { id: sessionId });
  }

  disposeAll(): void {
    for (const ctl of this.adapterControllers.values()) ctl.abort();
    this.adapterControllers.clear();
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
    const next: Session = {
      ...current,
      ...(update.status !== undefined ? { status: update.status } : {}),
      ...(update.cliSessionId !== undefined ? { cliSessionId: update.cliSessionId } : {}),
      ...(update.gitBranch !== undefined ? { gitBranch: update.gitBranch } : {}),
      ...(update.metrics !== undefined ? { metrics: update.metrics } : {}),
      ...(update.latestMessage !== undefined ? { latestMessage: update.latestMessage } : {}),
      ...(update.currentTool !== undefined ? { currentTool: update.currentTool } : {}),
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, next);
    this.emit('update', next);
  }

  private handlePtyData({ id: ptyId, data }: PtyDataEvent): void {
    const sessionId = this.ptyToSession.get(ptyId);
    if (!sessionId) return;
    this.emit('data', { sessionId, data });
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
