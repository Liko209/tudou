import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAdapter } from '../electron/adapters/codex-adapter';
import type { SessionUpdate } from '../shared/session-types';

const ROOT = join(tmpdir(), `codex-adapter-tests-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
const CODEX_HOME = join(ROOT, '.codex');
const FIXTURE_JSONL = join(__dirname, 'fixtures', 'codex-sample.jsonl');
const FIXTURE_INDEX = join(__dirname, 'fixtures', 'codex-session-index.jsonl');

beforeAll(async () => {
  await mkdir(CODEX_HOME, { recursive: true });
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe('CodexAdapter.buildSpawnArgs', () => {
  const adapter = new CodexAdapter();

  it('empty argv for fresh launch', () => {
    expect(adapter.buildSpawnArgs({})).toEqual([]);
  });

  it('emits resume <id>', () => {
    expect(adapter.buildSpawnArgs({ resume: 'abc-123' })).toEqual(['resume', 'abc-123']);
  });

  it('emits resume --last for continueLast', () => {
    expect(adapter.buildSpawnArgs({ continueLast: true })).toEqual(['resume', '--last']);
  });

  it('rejects continueLast + resume together', () => {
    expect(() => adapter.buildSpawnArgs({ continueLast: true, resume: 'x' })).toThrow(
      /mutually exclusive/,
    );
  });

  it('silently ignores Claude-only flags (name, model, effort)', () => {
    expect(
      adapter.buildSpawnArgs({ name: 'demo', model: 'sonnet', effort: 'high' }),
    ).toEqual([]);
  });
});

describe('CodexAdapter.watch (JSONL → SessionUpdate)', () => {
  const adapter = new CodexAdapter();

  async function collectUpdates(file: string): Promise<SessionUpdate[]> {
    const ctrl = new AbortController();
    const updates: SessionUpdate[] = [];
    const consumer = (async () => {
      for await (const u of adapter.watch(file, ctrl.signal)) {
        updates.push(u);
      }
    })();
    await new Promise((r) => setTimeout(r, 350));
    ctrl.abort();
    await consumer;
    return updates;
  }

  it('captures cliSessionId from session_meta', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const idUpdate = updates.find((u) => u.cliSessionId !== undefined);
    expect(idUpdate?.cliSessionId).toBe('019dfbae-0000-7000-8000-aaaaaaaaaaaa');
  });

  it('reads token usage from event_msg.token_count', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const last = [...updates].reverse().find((u) => u.metrics !== undefined);
    expect(last?.metrics).toBeDefined();
    // fixture has: input=1200, cached=200, output=150, reasoning=80
    expect(last!.metrics!.tokensInput).toBe(1200);
    expect(last!.metrics!.tokensCached).toBe(200);
    expect(last!.metrics!.tokensOutput).toBe(150 + 80);
  });

  it('latestMessage tracks user → assistant via event_msg', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const messages = updates
      .map((u) => u.latestMessage)
      .filter((m): m is NonNullable<typeof m> => m != null);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.preview).toMatch(/Read the README/);
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.preview).toMatch(/tiny demo project/);
  });

  it('opens currentTool on function_call and closes on function_call_output', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const openedTool = updates.find(
      (u) => u.currentTool !== undefined && u.currentTool !== null,
    );
    expect(openedTool?.currentTool?.name).toBe('shell');
    expect(openedTool?.currentTool?.description).toBe('cat README.md');

    const closedTool = updates.find((u) => u.currentTool === null);
    expect(closedTool).toBeDefined();

    const openIdx = updates.findIndex(
      (u) => u.currentTool && u.currentTool.name === 'shell',
    );
    const closeIdx = updates.findIndex((u) => u.currentTool === null);
    expect(openIdx).toBeLessThan(closeIdx);
  });

  it('transitions status: working → waiting around task_started/task_complete', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const statuses = updates
      .map((u) => u.status)
      .filter((s): s is NonNullable<typeof s> => s != null);
    expect(statuses).toContain('working');
    expect(statuses.at(-1)).toBe('waiting');
  });

  it('fills estimatedCostUSD using gpt-5 pricing (Codex default)', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const last = [...updates].reverse().find((u) => u.metrics !== undefined);
    expect(last?.metrics?.estimatedCostUSD).not.toBeNull();
    // gpt-5 pricing on fixture: input=1200, cached=200, output=230
    // = (1200*1.25 + 200*0.125 + 230*10) / 1M = (1500 + 25 + 2300) / 1M = 0.003825
    expect(last!.metrics!.estimatedCostUSD!).toBeCloseTo(0.003825, 6);
  });
});

describe('CodexAdapter.listResumable', () => {
  it('filters index entries by cwd via the rollout session_meta', async () => {
    const sessionsDir = join(CODEX_HOME, 'archived_sessions');
    await mkdir(sessionsDir, { recursive: true });

    const cwdMatching = '/Users/fixture/workspace/demo';
    const cwdOther = '/Users/fixture/workspace/elsewhere';

    // Place 3 rollout files with synthetic session_meta lines
    const rollouts: Array<[string, string]> = [
      ['019dfbae-0000-7000-8000-aaaaaaaaaaaa', cwdMatching],
      ['019dfbae-0000-7000-8000-bbbbbbbbbbbb', cwdMatching],
      ['019dfbae-0000-7000-8000-cccccccccccc', cwdOther],
    ];

    for (const [id, cwd] of rollouts) {
      const meta = {
        timestamp: '2026-05-22T08:00:00.000Z',
        type: 'session_meta',
        payload: { id, cwd, originator: 'Codex Desktop' },
      };
      await writeFile(
        join(sessionsDir, `rollout-2026-05-22T08-00-00-${id}.jsonl`),
        JSON.stringify(meta) + '\n',
      );
    }

    await copyFile(FIXTURE_INDEX, join(CODEX_HOME, 'session_index.jsonl'));

    const adapter = new CodexAdapter({ codexHome: CODEX_HOME });
    const list = await adapter.listResumable(cwdMatching);

    const ids = list.map((s) => s.cliSessionId);
    expect(ids).toContain('019dfbae-0000-7000-8000-aaaaaaaaaaaa');
    expect(ids).toContain('019dfbae-0000-7000-8000-bbbbbbbbbbbb');
    expect(ids).not.toContain('019dfbae-0000-7000-8000-cccccccccccc');
    expect(list[0]?.cli).toBe('codex');
    expect(list[0]?.summary).toBeTruthy();
  });

  it('returns empty list when session_index.jsonl does not exist', async () => {
    const adapter = new CodexAdapter({ codexHome: join(ROOT, 'empty-codex') });
    const list = await adapter.listResumable('/anywhere');
    expect(list).toEqual([]);
  });
});

describe('CodexAdapter.locateSessionFile', () => {
  it('returns null when the abort signal fires before any rollout appears', async () => {
    const adapter = new CodexAdapter({ codexHome: join(ROOT, 'empty-codex-2') });
    const ctrl = new AbortController();
    const locator = adapter.locateSessionFile(
      '/Users/fixture/nothing',
      new Date(),
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 150);
    const result = await locator;
    expect(result).toBeNull();
  });

  it('finds a freshly-created rollout file matching cwd via chokidar', async () => {
    const homeForTest = join(ROOT, 'locate-codex');
    const adapter = new CodexAdapter({ codexHome: homeForTest });
    const ctrl = new AbortController();

    const cwd = '/Users/fixture/workspace/locate-codex';
    const before = new Date();
    const locator = adapter.locateSessionFile(cwd, before, ctrl.signal);

    // chokidar attach delay
    await new Promise((r) => setTimeout(r, 200));
    const sessionsDir = join(homeForTest, 'sessions', '2026', '05', '28');
    await mkdir(sessionsDir, { recursive: true });
    const id = '019eeeee-0000-7000-8000-fffffffffff0';
    const meta = {
      timestamp: '2026-05-28T00:00:00.000Z',
      type: 'session_meta',
      payload: { id, cwd, originator: 'Codex Desktop' },
    };
    const rolloutPath = join(sessionsDir, `rollout-2026-05-28T00-00-00-${id}.jsonl`);
    await writeFile(rolloutPath, JSON.stringify(meta) + '\n');

    const found = await locator;
    ctrl.abort();
    expect(found).toBe(rolloutPath);
  });
});
