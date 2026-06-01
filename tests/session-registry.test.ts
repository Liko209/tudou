import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { SessionRegistry, type PtyHandle } from '../electron/session-registry';
import type { CliAdapter, SpawnArgsInput } from '../electron/adapters/types';
import type {
  PtyDataEvent,
  PtyExitEvent,
  CliKind,
} from '../shared/ipc-contracts';
import type { ResumableSession, SessionUpdate } from '../shared/session-types';

// --- fakes ---

interface PtyEvents {
  data: [PtyDataEvent];
  exit: [PtyExitEvent];
}

class FakePtyManager extends EventEmitter<PtyEvents> implements PtyHandle {
  spawned: Array<{ id: string; opts: unknown }> = [];
  writes: Array<{ id: string; data: string }> = [];
  resizes: Array<{ id: string; cols: number; rows: number }> = [];
  killed: string[] = [];
  disposed = false;
  private counter = 0;

  spawn(opts: PtyHandle extends { spawn(o: infer O): string } ? O : never): string {
    const id = `pty-${++this.counter}`;
    this.spawned.push({ id, opts });
    return id;
  }
  write(id: string, data: string): void {
    this.writes.push({ id, data });
  }
  resize(id: string, cols: number, rows: number): void {
    this.resizes.push({ id, cols, rows });
  }
  kill(id: string): void {
    this.killed.push(id);
  }
  getBuffer(_id: string): string {
    return '';
  }
  disposeAll(): void {
    this.disposed = true;
  }
  emitData(id: string, data: string): void {
    this.emit('data', { id, data });
  }
  emitExit(id: string, exitCode = 0): void {
    this.emit('exit', { id, exitCode, signal: null });
  }
}

class FakeAdapter implements CliAdapter {
  readonly cli: CliKind;
  locatedFile: string | null = '/fake/path.jsonl';
  buildArgsCalls: SpawnArgsInput[] = [];
  watchCalls: Array<{ file: string; signal?: AbortSignal }> = [];
  /** Append to this to push updates to any active watch. */
  pending: SessionUpdate[] = [];
  /** Hook to fire when watcher starts. */
  onWatchStart?: () => void;

  constructor(cli: CliKind) {
    this.cli = cli;
  }

  buildSpawnArgs(input: SpawnArgsInput): string[] {
    this.buildArgsCalls.push(input);
    return input.resume ? ['--resume', input.resume] : [];
  }
  async locateSessionFile(): Promise<string | null> {
    return this.locatedFile;
  }
  async findFileBySessionId(): Promise<string | null> {
    return this.locatedFile;
  }
  async *watch(file: string, signal?: AbortSignal): AsyncIterable<SessionUpdate> {
    this.watchCalls.push({ file, signal });
    this.onWatchStart?.();
    while (!signal?.aborted) {
      while (this.pending.length > 0) {
        if (signal?.aborted) return;
        yield this.pending.shift()!;
      }
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        const onAbort = (): void => resolve();
        signal?.addEventListener('abort', onAbort, { once: true });
        setTimeout(resolve, 10);
      });
    }
  }
  async listResumable(): Promise<ResumableSession[]> {
    return [];
  }
}

function makeRegistry() {
  const pty = new FakePtyManager();
  const claude = new FakeAdapter('claude');
  const codex = new FakeAdapter('codex');
  const reg = new SessionRegistry(pty, { claude, codex });
  return { pty, claude, codex, reg };
}

const baseSpawn = {
  cwd: '/Users/fixture/workspace/demo',
  cols: 80,
  rows: 24,
  shellPath: '/usr/local/bin/claude',
};

// --- tests ---

describe('SessionRegistry.spawn', () => {
  it('creates a Session in starting state and emits add', () => {
    const { reg, pty } = makeRegistry();
    const onAdd = vi.fn();
    reg.on('add', onAdd);

    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });

    expect(session.id).toBeTypeOf('string');
    expect(session.cli).toBe('claude');
    expect(session.status).toBe('starting');
    expect(session.cwd).toBe(baseSpawn.cwd);
    expect(ptyId).toBe('pty-1');
    expect(pty.spawned).toHaveLength(1);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(reg.list()).toHaveLength(1);
  });

  it('passes spawnArgs through adapter.buildSpawnArgs', () => {
    const { reg, claude } = makeRegistry();
    reg.spawn({ cli: 'claude', ...baseSpawn, spawnArgs: { resume: 'sess-99' } });
    expect(claude.buildArgsCalls).toEqual([{ resume: 'sess-99' }]);
  });

  it('records the PTY↔session mapping for lookups', () => {
    const { reg } = makeRegistry();
    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });
    expect(reg.ptyIdFor(session.id)).toBe(ptyId);
    expect(reg.sessionIdForPty(ptyId)).toBe(session.id);
  });

  it('autoName uses basename(cwd) + HH:MM', () => {
    const { reg } = makeRegistry();
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });
    expect(session.displayName).toMatch(/^demo · \d{2}:\d{2}$/);
  });
});

describe('SessionRegistry adapter watch integration', () => {
  it('merges adapter updates into the Session and emits update', async () => {
    const { reg, claude } = makeRegistry();
    const updates: Array<{ status?: string; tokens?: number }> = [];
    reg.on('update', (s) => {
      updates.push({ status: s.status, tokens: s.metrics.tokensInput });
    });

    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });

    claude.pending.push(
      { status: 'working' },
      {
        metrics: {
          tokensInput: 1234,
          tokensCached: 0,
          tokensOutput: 56,
          estimatedCostUSD: 0.01,
          messageCount: 1,
        },
      },
    );

    // Let the async watch loop run a few times
    await new Promise((r) => setTimeout(r, 60));

    const stored = reg.get(session.id)!;
    expect(stored.status).toBe('working');
    expect(stored.metrics.tokensInput).toBe(1234);
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it('coalesces a rapid status-flip burst into one final status (no dot flicker)', async () => {
    const { reg, claude } = makeRegistry();
    const emittedStatuses: string[] = [];
    reg.on('update', (s) => emittedStatuses.push(s.status));
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });

    // Mimics a transcript replay: many status flips arriving back-to-back.
    claude.pending.push(
      { status: 'working' },
      { status: 'waiting' },
      { status: 'working' },
      { status: 'waiting' },
    );
    await new Promise((r) => setTimeout(r, 90));

    // Only the final status is applied — not every intermediate flip.
    expect(reg.get(session.id)?.status).toBe('waiting');
    expect(emittedStatuses.filter((s) => s === 'working' || s === 'waiting')).toEqual(['waiting']);
  });

  it('resume: a stale trailing "working" status settles to waiting (no fake green dot)', async () => {
    const { reg, claude } = makeRegistry();
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn, spawnArgs: { resume: 'sess-1' } });
    // Transcript replay ends mid-task (open tool / tool_result) → 'working'.
    claude.pending.push({ status: 'working' });
    await new Promise((r) => setTimeout(r, 90));
    // A just-resumed CLI is idle, so the historical 'working' is clamped.
    expect(reg.get(session.id)?.status).toBe('waiting');
  });

  it('fresh spawn: an initial "working" status is preserved (not clamped)', async () => {
    const { reg, claude } = makeRegistry();
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn }); // no resume
    claude.pending.push({ status: 'working' });
    await new Promise((r) => setTimeout(r, 90));
    expect(reg.get(session.id)?.status).toBe('working');
  });

  it('resume: a live "working" AFTER the initial replay is shown', async () => {
    const { reg, claude } = makeRegistry();
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn, spawnArgs: { resume: 'sess-1' } });
    claude.pending.push({ status: 'working' }); // initial replay → clamped to waiting
    await new Promise((r) => setTimeout(r, 90));
    expect(reg.get(session.id)?.status).toBe('waiting');
    claude.pending.push({ status: 'working' }); // genuine live activity → working
    await new Promise((r) => setTimeout(r, 90));
    expect(reg.get(session.id)?.status).toBe('working');
  });

  it('marks session exited on PTY exit code 0', async () => {
    const { reg, pty } = makeRegistry();
    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });

    pty.emitExit(ptyId, 0);

    const stored = reg.get(session.id)!;
    expect(stored.status).toBe('exited');
    expect(stored.ptyExitCode).toBe(0);
    expect(reg.ptyIdFor(session.id)).toBeNull();
  });

  it('marks session errored on PTY non-zero exit', async () => {
    const { reg, pty } = makeRegistry();
    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });
    pty.emitExit(ptyId, 137);
    expect(reg.get(session.id)?.status).toBe('errored');
    expect(reg.get(session.id)?.ptyExitCode).toBe(137);
  });

  it('marks session errored if adapter.locateSessionFile throws', async () => {
    const { reg, claude } = makeRegistry();
    claude.locateSessionFile = async (): Promise<string | null> => {
      throw new Error('disk full');
    };

    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });
    await new Promise((r) => setTimeout(r, 30));

    expect(reg.get(session.id)?.status).toBe('errored');
  });
});

describe('SessionRegistry session titles', () => {
  it('seeds title from the first user prompt (first line, capped)', async () => {
    const { reg, claude } = makeRegistry();
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });
    expect(session.title).toBeNull();

    claude.pending.push({
      latestMessage: {
        role: 'user',
        preview: 'Fix the file tree icon alignment\nand also the titles',
        timestamp: new Date().toISOString(),
      },
    });
    await new Promise((r) => setTimeout(r, 40));

    expect(reg.get(session.id)?.title).toBe('Fix the file tree icon alignment');
  });

  it('does not overwrite an existing title with later prompts', async () => {
    const { reg, claude } = makeRegistry();
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });

    claude.pending.push(
      { latestMessage: { role: 'user', preview: 'first', timestamp: 'a' } },
      { latestMessage: { role: 'user', preview: 'second', timestamp: 'b' } },
    );
    await new Promise((r) => setTimeout(r, 60));

    expect(reg.get(session.id)?.title).toBe('first');
  });

  it('rename sets a custom title and emits update; empty clears it', () => {
    const { reg } = makeRegistry();
    const updates: Array<string | null> = [];
    reg.on('update', (s) => updates.push(s.title));
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });

    reg.rename(session.id, '  My deploy task  ');
    expect(reg.get(session.id)?.title).toBe('My deploy task');

    reg.rename(session.id, '   ');
    expect(reg.get(session.id)?.title).toBeNull();
    expect(updates).toEqual(['My deploy task', null]);
  });
});

describe('SessionRegistry hook-driven attention', () => {
  // Discover a cliSessionId via the adapter so applyHookEvent can match it.
  async function spawnWithCliId(reg: SessionRegistry, claude: FakeAdapter, cliId: string) {
    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });
    claude.pending.push({ cliSessionId: cliId });
    await new Promise((r) => setTimeout(r, 40));
    return session;
  }

  it('emits attention on Stop / Notification but not on adapter status flicker', async () => {
    const { reg, claude } = makeRegistry();
    const attention: string[] = [];
    reg.on('attention', (s) => attention.push(s.id));
    const session = await spawnWithCliId(reg, claude, 'claude-xyz');

    // Adapter flicker to 'waiting' mid-turn — must NOT raise attention.
    claude.pending.push({ status: 'waiting' });
    claude.pending.push({ status: 'working' });
    await new Promise((r) => setTimeout(r, 40));
    expect(attention).toEqual([]);

    reg.applyHookEvent({ session_id: 'claude-xyz', hook_event_name: 'Stop' });
    expect(attention).toEqual([session.id]);
    expect(reg.get(session.id)?.status).toBe('waiting'); // turn done → free

    reg.applyHookEvent({ session_id: 'claude-xyz', hook_event_name: 'Notification' });
    expect(attention).toEqual([session.id, session.id]);
    expect(reg.get(session.id)?.status).toBe('blocked'); // needs permission → stuck
  });

  it('UserPromptSubmit does not raise attention; isHookActive flips on first hook', async () => {
    const { reg, claude } = makeRegistry();
    const attention: string[] = [];
    reg.on('attention', (s) => attention.push(s.id));
    const session = await spawnWithCliId(reg, claude, 'claude-abc');

    expect(reg.isHookActive(session.id)).toBe(false);
    reg.applyHookEvent({ session_id: 'claude-abc', hook_event_name: 'UserPromptSubmit' });
    expect(attention).toEqual([]);
    expect(reg.isHookActive(session.id)).toBe(true);
  });
});

describe('SessionRegistry.write / resize / data', () => {
  it('write routes to the correct PTY', () => {
    const { reg, pty } = makeRegistry();
    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });
    reg.write(session.id, 'hello\n');
    expect(pty.writes).toEqual([{ id: ptyId, data: 'hello\n' }]);
  });

  it('resize routes to the correct PTY', () => {
    const { reg, pty } = makeRegistry();
    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });
    reg.resize(session.id, 100, 40);
    expect(pty.resizes).toEqual([{ id: ptyId, cols: 100, rows: 40 }]);
  });

  it('write/resize for unknown session id is a no-op', () => {
    const { reg, pty } = makeRegistry();
    reg.write('does-not-exist', 'hi');
    reg.resize('does-not-exist', 1, 1);
    expect(pty.writes).toEqual([]);
    expect(pty.resizes).toEqual([]);
  });

  it('emits data with sessionId when underlying PTY emits data', () => {
    const { reg, pty } = makeRegistry();
    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });
    const received: Array<{ sessionId: string; data: string }> = [];
    reg.on('data', (e) => received.push(e));
    pty.emitData(ptyId, 'hello from PTY');
    expect(received).toEqual([{ sessionId: session.id, data: 'hello from PTY' }]);
  });

  it('drops data events for PTYs not mapped to any session', () => {
    const { reg, pty } = makeRegistry();
    const received: Array<{ sessionId: string; data: string }> = [];
    reg.on('data', (e) => received.push(e));
    pty.emitData('pty-orphan', 'noise');
    expect(received).toEqual([]);
  });
});

describe('SessionRegistry.kill / forget / disposeAll', () => {
  it('kill forwards to PtyManager (which will fire exit)', () => {
    const { reg, pty } = makeRegistry();
    const { session, ptyId } = reg.spawn({ cli: 'claude', ...baseSpawn });
    reg.kill(session.id);
    expect(pty.killed).toEqual([ptyId]);
  });

  it('forget removes the session, emits remove, leaves PTY alone', () => {
    const { reg, pty } = makeRegistry();
    const onRemove = vi.fn();
    reg.on('remove', onRemove);

    const { session } = reg.spawn({ cli: 'claude', ...baseSpawn });
    reg.forget(session.id);

    expect(reg.get(session.id)).toBeNull();
    expect(reg.list()).toEqual([]);
    expect(onRemove).toHaveBeenCalledWith({ id: session.id });
    expect(pty.killed).toEqual([]); // forget != kill
  });

  it('disposeAll aborts watches and tears down PtyManager', async () => {
    const { reg, pty } = makeRegistry();
    reg.spawn({ cli: 'claude', ...baseSpawn });
    reg.spawn({ cli: 'codex', ...baseSpawn });

    expect(reg.list()).toHaveLength(2);
    reg.disposeAll();
    expect(reg.list()).toEqual([]);
    expect(pty.disposed).toBe(true);
  });
});
