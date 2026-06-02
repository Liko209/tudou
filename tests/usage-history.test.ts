import { describe, expect, it } from 'vitest';
import {
  finalizeHistory,
  foldClaudeLine,
  mergeAccumulator,
  newAccumulator,
} from '../electron/usage-history';

function assistantLine(opts: {
  ts: string;
  model: string | null;
  input?: number;
  cacheCreate?: number;
  cacheRead?: number;
  output?: number;
}) {
  return {
    type: 'assistant',
    timestamp: opts.ts,
    message: {
      model: opts.model,
      usage: {
        input_tokens: opts.input ?? 0,
        cache_creation_input_tokens: opts.cacheCreate ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        output_tokens: opts.output ?? 0,
      },
    },
  };
}

describe('foldClaudeLine', () => {
  it('accumulates assistant usage by day, model, and project', () => {
    const acc = newAccumulator();
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: 'claude-opus-4-7', input: 100, cacheCreate: 0, cacheRead: 1000, output: 50 }), '/p/a');
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T12:00:00Z', model: 'claude-opus-4-7', input: 200, output: 10 }), '/p/a');
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-02T09:00:00Z', model: 'claude-sonnet-4-6', input: 50, output: 5 }), '/p/b');

    expect(acc.totals.messages).toBe(3);
    expect(acc.totals.tokensInput).toBe(350); // 100 + 200 + 50
    expect(acc.totals.tokensCached).toBe(1000);
    expect(acc.totals.tokensOutput).toBe(65);
    expect(acc.totals.costUSD).toBeGreaterThan(0);
    expect(acc.byDay.get('2026-06-01')!.messages).toBe(2);
    expect(acc.byDay.get('2026-06-02')!.messages).toBe(1);
    expect(acc.byModel.get('claude-opus-4-7')!.tokensInput).toBe(300);
    expect(acc.byProject.get('/p/a')!.messages).toBe(2);
  });

  it('counts cache creation as full-price input', () => {
    const acc = newAccumulator();
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: 'claude-opus-4-7', input: 6, cacheCreate: 12000, cacheRead: 18000, output: 100 }), '/p');
    const t = acc.totals;
    expect(t.tokensInput).toBe(12006); // input + cacheCreate
    expect(t.tokensCached).toBe(18000); // cacheRead
    expect(t.tokensOutput).toBe(100);
  });

  it('ignores non-assistant, synthetic, and usage-less lines', () => {
    const acc = newAccumulator();
    foldClaudeLine(acc, { type: 'user', message: { content: 'hi' } }, '/p');
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: '<synthetic>', input: 9 }), '/p');
    foldClaudeLine(acc, { type: 'assistant', message: { model: 'claude-opus-4-7' } }, '/p'); // no usage
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: 'claude-opus-4-7' }), '/p'); // all zero
    foldClaudeLine(acc, 'not an object', '/p');
    expect(acc.totals.messages).toBe(0);
  });

  it('attributes usage to tools and a task category', () => {
    const acc = newAccumulator();
    const line = {
      type: 'assistant',
      timestamp: '2026-06-01T10:00:00Z',
      message: {
        model: 'claude-opus-4-7',
        usage: { input_tokens: 100, output_tokens: 20 },
        content: [
          { type: 'text', text: 'editing' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/x' } },
          { type: 'tool_use', name: 'mcp__github__search', input: {} },
        ],
      },
    };
    foldClaudeLine(acc, line, '/p', 'add a new feature');
    // Two distinct tools → usage split in half each; MCP collapsed to mcp:github.
    expect(acc.byTool.get('Edit')!.tokensInput).toBe(50);
    expect(acc.byTool.get('mcp:github')!.tokensInput).toBe(50);
    // Edit + "add a new feature" prompt → Feature Dev, full usage (not split).
    expect(acc.byCategory.get('Feature Dev')!.tokensInput).toBe(100);
  });

  it('falls back to "unknown" model and bucket when fields are missing', () => {
    const acc = newAccumulator();
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: null, input: 10, output: 1 }), '/p');
    expect(acc.byModel.has('unknown')).toBe(true);
    // unknown model → no price → cost 0, but tokens still counted.
    expect(acc.totals.costUSD).toBe(0);
    expect(acc.totals.tokensInput).toBe(10);
  });
});

describe('mergeAccumulator + finalizeHistory', () => {
  it('merges per-file accumulators and sorts the rollups', () => {
    const a = newAccumulator();
    foldClaudeLine(a, assistantLine({ ts: '2026-06-02T10:00:00Z', model: 'claude-sonnet-4-6', input: 100, output: 10 }), '/p/cheap');
    const b = newAccumulator();
    foldClaudeLine(b, assistantLine({ ts: '2026-06-01T10:00:00Z', model: 'claude-opus-4-7', input: 1000, output: 500 }), '/p/spendy');

    mergeAccumulator(a, b);
    const h = finalizeHistory(a, '2026-06-02T12:00:00Z');

    expect(h.totals.messages).toBe(2);
    expect(h.byDay.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02']); // ascending
    expect(h.byModel[0]!.model).toBe('claude-opus-4-7'); // pricier first
    expect(h.byProject[0]!.project).toBe('/p/spendy');
    expect(h.generatedAt).toBe('2026-06-02T12:00:00Z');
  });

  it('emits day-granular model/project rollups', () => {
    const acc = newAccumulator();
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: 'claude-opus-4-7', input: 100, output: 10 }), '/p/a');
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-02T10:00:00Z', model: 'claude-opus-4-7', input: 200, output: 20 }), '/p/a');
    const h = finalizeHistory(acc, '2026-06-02T12:00:00Z');
    const md = h.modelByDay.find((m) => m.date === '2026-06-02' && m.model === 'claude-opus-4-7');
    expect(md!.tokensInput).toBe(200);
    expect(h.modelByDay).toHaveLength(2); // one per (day, model)
    const pd = h.projectByDay.find((p) => p.date === '2026-06-01' && p.project === '/p/a');
    expect(pd!.tokensInput).toBe(100);
  });

  it('handles projects containing spaces in the day-granular key', () => {
    const acc = newAccumulator();
    foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: 'claude-opus-4-7', input: 5, output: 1 }), '/Users/x/My Project');
    const h = finalizeHistory(acc, '2026-06-01T12:00:00Z');
    expect(h.projectByDay[0]).toMatchObject({ date: '2026-06-01', project: '/Users/x/My Project' });
  });

  it('caps byProject to topProjects', () => {
    const acc = newAccumulator();
    for (let i = 0; i < 20; i++) {
      foldClaudeLine(acc, assistantLine({ ts: '2026-06-01T10:00:00Z', model: 'claude-opus-4-7', input: i + 1, output: 1 }), `/p/${i}`);
    }
    const h = finalizeHistory(acc, '2026-06-01T12:00:00Z', 5);
    expect(h.byProject).toHaveLength(5);
  });
});
