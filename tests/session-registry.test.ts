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
