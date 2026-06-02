import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanClaudeUsage, _clearUsageCache } from '../electron/usage-scanner';

function line(model: string, input: number, output: number, ts: string, cwd: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd,
    message: { model, usage: { input_tokens: input, output_tokens: output } },
  });
}

async function makeClaudeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'tudou-usage-'));
  const projA = join(home, 'projects', '-Users-x-proj-a');
  const projB = join(home, 'projects', '-Users-x-proj-b');
  await mkdir(projA, { recursive: true });
  await mkdir(projB, { recursive: true });
  await writeFile(
    join(projA, 's1.jsonl'),
    [
      line('claude-opus-4-7', 1000, 100, '2026-06-01T10:00:00Z', '/Users/x/proj-a'),
      '{ broken json',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      line('claude-opus-4-7', 500, 50, '2026-06-02T10:00:00Z', '/Users/x/proj-a'),
    ].join('\n'),
  );
  await writeFile(
    join(projB, 's2.jsonl'),
    line('claude-sonnet-4-6', 200, 20, '2026-06-02T11:00:00Z', '/Users/x/proj-b') + '\n',
  );
  return home;
}

describe('scanClaudeUsage', () => {
  beforeEach(() => _clearUsageCache());

  it('aggregates usage across project transcripts, skipping bad/non-usage lines', async () => {
    const home = await makeClaudeHome();
    const h = await scanClaudeUsage(home);

    expect(h.totals.messages).toBe(3); // 2 in proj-a + 1 in proj-b (user + broken skipped)
    expect(h.totals.tokensInput).toBe(1700);
    expect(h.totals.tokensOutput).toBe(170);
    expect(h.byDay.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02']);
    expect(h.byProject.map((p) => p.project).sort()).toEqual(['/Users/x/proj-a', '/Users/x/proj-b']);
    expect(h.byModel[0]!.model).toBe('claude-opus-4-7'); // pricier
    expect(h.totals.costUSD).toBeGreaterThan(0);
  });

  it('returns empty history when there is no projects dir', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tudou-usage-empty-'));
    const h = await scanClaudeUsage(home);
    expect(h.totals.messages).toBe(0);
    expect(h.byDay).toEqual([]);
  });
});
