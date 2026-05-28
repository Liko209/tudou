import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeAdapter, encodeProjectPath } from '../electron/adapters/claude-adapter';
import type { SessionUpdate } from '../shared/session-types';

const ROOT = join(tmpdir(), `claude-adapter-tests-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
const CLAUDE_HOME = join(ROOT, '.claude');
const FIXTURE_JSONL = join(__dirname, 'fixtures', 'claude-sample.jsonl');
const FIXTURE_INDEX = join(__dirname, 'fixtures', 'claude-sessions-index.json');

beforeAll(async () => {
  await mkdir(CLAUDE_HOME, { recursive: true });
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe('ClaudeAdapter.buildSpawnArgs', () => {
  const adapter = new ClaudeAdapter();

  it('returns empty argv for a fresh launch', () => {
    expect(adapter.buildSpawnArgs({})).toEqual([]);
  });

  it('emits --resume <id>', () => {
    expect(adapter.buildSpawnArgs({ resume: 'abc-123' })).toEqual(['--resume', 'abc-123']);
  });

  it('emits -c for continueLast', () => {
    expect(adapter.buildSpawnArgs({ continueLast: true })).toEqual(['-c']);
  });

  it('rejects continueLast + resume together', () => {
    expect(() =>
      adapter.buildSpawnArgs({ continueLast: true, resume: 'x' }),
    ).toThrow(/mutually exclusive/);
  });

  it('passes --name --model --effort through', () => {
    const args = adapter.buildSpawnArgs({
      name: 'demo · 14:32',
      model: 'sonnet',
      effort: 'high',
    });
    expect(args).toEqual(['--name', 'demo · 14:32', '--model', 'sonnet', '--effort', 'high']);
  });
});

describe('ClaudeAdapter.watch (JSONL → SessionUpdate)', () => {
  const adapter = new ClaudeAdapter();

  async function collectUpdates(file: string): Promise<SessionUpdate[]> {
    const ctrl = new AbortController();
    const updates: SessionUpdate[] = [];
    const consumer = (async () => {
      for await (const u of adapter.watch(file, ctrl.signal)) {
        updates.push(u);
      }
    })();
    // give the tail enough wall time to drain the static fixture
    await new Promise((r) => setTimeout(r, 350));
    ctrl.abort();
    await consumer;
    return updates;
  }

  it('captures cliSessionId on first sighting', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const sessionIdUpdate = updates.find((u) => u.cliSessionId !== undefined);
    expect(sessionIdUpdate?.cliSessionId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('captures gitBranch', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const branch = updates.find((u) => u.gitBranch !== undefined);
    expect(branch?.gitBranch).toBe('main');
  });

  it('accumulates token usage across assistant turns', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const last = [...updates].reverse().find((u) => u.metrics !== undefined);
    expect(last?.metrics).toBeDefined();
    // Three assistant turns. Sum of usage in fixture:
    // turn 1: input 12 + cache_create 1500 + output 80 + cache_read 0
    // turn 2: input 4  + cache_create 0    + output 40 + cache_read 1500
    // turn 3: input 3  + cache_create 0    + output 60 + cache_read 1500
    // tokensInput = 12+1500 + 4+0 + 3+0 = 1519
    // tokensCached = 0 + 1500 + 1500 = 3000
    // tokensOutput = 80 + 40 + 60 = 180
    expect(last!.metrics!.tokensInput).toBe(1519);
    expect(last!.metrics!.tokensCached).toBe(3000);
    expect(last!.metrics!.tokensOutput).toBe(180);
  });

  it('opens and closes currentTool around a tool_use → tool_result pair', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const openedTool = updates.find(
      (u) => u.currentTool !== undefined && u.currentTool !== null,
    );
    expect(openedTool?.currentTool?.name).toBe('Bash');
    // We prefer the tool's `description` field (semantic intent) over `command`
    // (literal command line), per design §3.2.
    expect(openedTool?.currentTool?.description).toBe('List files');

    const closedTool = updates.find((u) => u.currentTool === null);
    expect(closedTool).toBeDefined();

    // Tool should open BEFORE it closes in event order
    const openIdx = updates.findIndex((u) => u.currentTool && u.currentTool.name === 'Bash');
    const closeIdx = updates.findIndex((u) => u.currentTool === null);
    expect(openIdx).toBeLessThan(closeIdx);
  });

  it('latestMessage tracks user → assistant → tool → assistant progression', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const messages = updates
      .map((u) => u.latestMessage)
      .filter((m): m is NonNullable<typeof m> => m != null);
    const roles = messages.map((m) => m.role);
    expect(roles[0]).toBe('user');
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');
    // Last latestMessage in the fixture should be the final assistant text
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.preview).toMatch(/README\.md and a main\.ts/);
  });

  it('transitions status: working → waiting at end of last assistant turn', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const statuses = updates
      .map((u) => u.status)
      .filter((s): s is NonNullable<typeof s> => s != null);
    expect(statuses).toContain('working');
    expect(statuses.at(-1)).toBe('waiting');
  });

  it('fills estimatedCostUSD using the assistant message.model', async () => {
    const updates = await collectUpdates(FIXTURE_JSONL);
    const last = [...updates].reverse().find((u) => u.metrics !== undefined);
    expect(last?.metrics?.estimatedCostUSD).not.toBeNull();
    // Opus pricing applied: tokensInput=1519, tokensCached=3000, tokensOutput=180
    // = (1519*15 + 3000*1.5 + 180*75) / 1M = (22785 + 4500 + 13500) / 1M = 0.040785
    expect(last!.metrics!.estimatedCostUSD!).toBeCloseTo(0.040785, 5);
  });
});

describe('ClaudeAdapter.listResumable', () => {
  it('returns entries from sessions-index.json filtered by cwd', async () => {
    const cwd = '/Users/fixture/workspace/demo';
    const dir = join(CLAUDE_HOME, 'projects', encodeProjectPath(cwd));
    await mkdir(dir, { recursive: true });
    await copyFile(FIXTURE_INDEX, join(dir, 'sessions-index.json'));

    const adapter = new ClaudeAdapter({ claudeHome: CLAUDE_HOME });
    const list = await adapter.listResumable(cwd);

    expect(list.map((s) => s.cliSessionId)).toEqual([
      '22222222-3333-4444-5555-666666666666',
      '11111111-2222-3333-4444-555555555555',
    ]);
    expect(list[0]?.cli).toBe('claude');
    expect(list[0]?.firstPrompt).toBe('Refactor the parser to be async.');
    expect(list[0]?.gitBranch).toBe('feat/async-parser');
  });

  it('returns empty list when no sessions-index.json exists', async () => {
    const adapter = new ClaudeAdapter({ claudeHome: CLAUDE_HOME });
    const list = await adapter.listResumable('/Users/fixture/never/touched');
    expect(list).toEqual([]);
  });
});

describe('ClaudeAdapter.locateSessionFile', () => {
  it('returns null when the abort signal fires before any file appears', async () => {
    const adapter = new ClaudeAdapter({ claudeHome: CLAUDE_HOME });
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

  it('finds a freshly created session JSONL via chokidar', async () => {
    const cwd = '/Users/fixture/workspace/locate';
    const adapter = new ClaudeAdapter({ claudeHome: CLAUDE_HOME });
    const ctrl = new AbortController();

    const before = new Date();
    const locator = adapter.locateSessionFile(cwd, before, ctrl.signal);

    // chokidar needs a moment to attach; then write the file
    await new Promise((r) => setTimeout(r, 200));
    const dir = join(CLAUDE_HOME, 'projects', encodeProjectPath(cwd));
    await mkdir(dir, { recursive: true });
    const sessionId = '12345678-1234-1234-1234-123456789012';
    const fullPath = join(dir, `${sessionId}.jsonl`);
    await writeFile(fullPath, '');

    const found = await locator;
    ctrl.abort();
    expect(found).toBe(fullPath);
  });

  it('finds a pre-existing JSONL on the fast path (resume scenario)', async () => {
    const cwd = '/Users/fixture/workspace/already-there';
    const dir = join(CLAUDE_HOME, 'projects', encodeProjectPath(cwd));
    await mkdir(dir, { recursive: true });
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const fullPath = join(dir, `${sessionId}.jsonl`);
    await writeFile(fullPath, '');

    const adapter = new ClaudeAdapter({ claudeHome: CLAUDE_HOME });
    // `after` in the past so the existing file qualifies
    const found = await adapter.locateSessionFile(cwd, new Date(Date.now() - 60_000));
    expect(found).toBe(fullPath);
  });
});

describe('encodeProjectPath', () => {
  it('replaces / with -', () => {
    expect(encodeProjectPath('/Users/foo/bar')).toBe('-Users-foo-bar');
  });
  it('handles root cwd', () => {
    expect(encodeProjectPath('/')).toBe('-');
  });
});

// Silence "unused" suspicion for dirname (imported for symmetry with future cases).
void dirname;
