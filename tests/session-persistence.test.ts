import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionPersistence, type PersistedSession } from '../electron/session-persistence';

const ROOT = join(tmpdir(), `persistence-tests-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

function sample(over: Partial<PersistedSession> = {}): PersistedSession {
  return {
    id: 'session-1',
    cli: 'claude',
    cliSessionId: 'claude-abc-123',
    cwd: '/Users/fixture/workspace/demo',
    displayName: 'demo · 14:32',
    title: null,
    startedAt: '2026-05-28T10:00:00.000Z',
    lastSeenAt: '2026-05-28T10:30:00.000Z',
    ...over,
  };
}

describe('SessionPersistence load + write', () => {
  it('load returns [] when file does not exist', async () => {
    const file = join(ROOT, 'missing.json');
    const store = new SessionPersistence(file);
    expect(await store.load()).toEqual([]);
  });

  it('upsert + flush round-trip', async () => {
    const file = join(ROOT, 'rt.json');
    const store = new SessionPersistence(file);
    await store.load();
    store.upsert(sample({ id: 'a' }));
    store.upsert(sample({ id: 'b', cliSessionId: 'xyz' }));

    const raw = JSON.parse(await readFile(file, 'utf8'));
    expect(raw.version).toBe(1);
    expect(raw.sessions.map((s: PersistedSession) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('subsequent load picks up the written sessions', async () => {
    const file = join(ROOT, 'roundtrip.json');
    const writer = new SessionPersistence(file);
    await writer.load();
    writer.upsert(sample({ id: 'first' }));

    const reader = new SessionPersistence(file);
    const loaded = await reader.load();
    expect(loaded.map((s) => s.id)).toEqual(['first']);
  });
});

describe('SessionPersistence patch + remove', () => {
  it('patch updates fields and refreshes lastSeenAt', async () => {
    const file = join(ROOT, 'patch.json');
    const store = new SessionPersistence(file, () => new Date('2026-05-28T11:00:00.000Z'));
    await store.load();
    store.upsert(sample({ id: 'p', cliSessionId: null }));

    store.patch('p', { cliSessionId: 'newly-discovered' });
    const list = store.list();
    expect(list[0]?.cliSessionId).toBe('newly-discovered');
    expect(list[0]?.lastSeenAt).toBe('2026-05-28T11:00:00.000Z');
  });

  it('patch is a no-op for unknown ids', () => {
    const store = new SessionPersistence(join(ROOT, 'noop.json'));
    expect(() => store.patch('does-not-exist', { displayName: 'x' })).not.toThrow();
    expect(store.list()).toEqual([]);
  });

  it('remove drops the record', async () => {
    const file = join(ROOT, 'remove.json');
    const store = new SessionPersistence(file);
    await store.load();
    store.upsert(sample({ id: 'r' }));
    store.remove('r');
    expect(store.list()).toEqual([]);
  });

  it('removeByCliSessionId removes matching records', async () => {
    const store = new SessionPersistence(join(ROOT, 'by-cli.json'));
    await store.load();
    store.upsert(sample({ id: 'a', cliSessionId: 'X' }));
    store.upsert(sample({ id: 'b', cli: 'codex', cliSessionId: 'X' })); // different cli
    store.upsert(sample({ id: 'c', cliSessionId: 'Y' }));
    store.removeByCliSessionId('claude', 'X');
    expect(store.list().map((s) => s.id).sort()).toEqual(['b', 'c']);
  });
});

describe('SessionPersistence 30-day GC at load', () => {
  it('drops records whose lastSeenAt is older than 30 days', async () => {
    const file = join(ROOT, 'gc.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sessions: [
          sample({ id: 'fresh', lastSeenAt: '2026-05-28T10:00:00.000Z' }),
          sample({ id: 'stale', lastSeenAt: '2026-03-01T10:00:00.000Z' }),
        ],
      }),
    );
    const store = new SessionPersistence(file, () => new Date('2026-05-28T11:00:00.000Z'));
    const loaded = await store.load();
    expect(loaded.map((s) => s.id)).toEqual(['fresh']);
  });

  it('GC scheduled flush rewrites the file without stale records', async () => {
    const file = join(ROOT, 'gc-flush.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sessions: [
          sample({ id: 'fresh' }),
          sample({ id: 'stale', lastSeenAt: '2026-01-01T00:00:00.000Z' }),
        ],
      }),
    );
    const store = new SessionPersistence(file, () => new Date('2026-05-28T11:00:00.000Z'));
    await store.load();
    const raw = JSON.parse(await readFile(file, 'utf8'));
    expect(raw.sessions.map((s: PersistedSession) => s.id)).toEqual(['fresh']);
  });
});

describe('SessionPersistence malformed input', () => {
  it('returns [] for unparseable JSON', async () => {
    const file = join(ROOT, 'bad.json');
    await writeFile(file, 'not json at all');
    expect(await new SessionPersistence(file).load()).toEqual([]);
  });

  it('returns [] for wrong schema version', async () => {
    const file = join(ROOT, 'wrong-version.json');
    await writeFile(file, JSON.stringify({ version: 99, sessions: [] }));
    expect(await new SessionPersistence(file).load()).toEqual([]);
  });

  it('skips individual records with missing fields', async () => {
    const file = join(ROOT, 'partial.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sessions: [
          sample({ id: 'good' }),
          { id: 'no-cli', cwd: '/x' }, // missing required fields
        ],
      }),
    );
    const loaded = await new SessionPersistence(file).load();
    expect(loaded.map((s) => s.id)).toEqual(['good']);
  });
});
