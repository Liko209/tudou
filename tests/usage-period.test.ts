import { describe, expect, it } from 'vitest';
import { rollupPeriod, cacheHitPct, burnRate } from '../renderer/lib/usage-period';
import type { UsageHistory } from '../shared/usage-types';

function t(input: number, output: number, cached = 0, cost = 0, messages = 1) {
  return { tokensInput: input, tokensOutput: output, tokensCached: cached, costUSD: cost, messages };
}

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0); // 2026-06-30T12:00:00Z

const HISTORY: UsageHistory = {
  generatedAt: '',
  sessionCount: 0,
  totals: t(0, 0),
  byDay: [
    { date: '2026-05-01', ...t(100, 10, 0, 1) },
    { date: '2026-06-25', ...t(200, 20, 0, 2) },
    { date: '2026-06-30', ...t(300, 30, 0, 3) },
  ],
  byModel: [],
  byProject: [],
  modelByDay: [
    { date: '2026-05-01', model: 'opus', ...t(100, 10, 0, 1) },
    { date: '2026-06-25', model: 'opus', ...t(200, 20, 0, 2) },
    { date: '2026-06-30', model: 'sonnet', ...t(300, 30, 0, 3) },
  ],
  projectByDay: [
    { date: '2026-06-25', project: '/a', ...t(200, 20, 0, 2) },
    { date: '2026-06-30', project: '/b', ...t(300, 30, 0, 3) },
  ],
  sessions: [],
  byTool: [],
  toolByDay: [
    { date: '2026-06-25', tool: 'Edit', ...t(200, 20, 0, 2) },
    { date: '2026-06-30', tool: 'Bash', ...t(300, 30, 0, 3) },
  ],
  byCategory: [],
  categoryByDay: [
    { date: '2026-06-25', category: 'Coding', ...t(200, 20, 0, 2) },
    { date: '2026-06-30', category: 'Testing', ...t(300, 30, 0, 3) },
  ],
};

describe('rollupPeriod', () => {
  it('today = the current UTC day only', () => {
    const r = rollupPeriod(HISTORY, 'today', NOW);
    expect(r.days.map((d) => d.date)).toEqual(['2026-06-30']);
    expect(r.totals.costUSD).toBe(3);
    expect(r.byModel.map((m) => m.model)).toEqual(['sonnet']);
  });

  it('7d window includes the last 7 calendar days', () => {
    const r = rollupPeriod(HISTORY, '7d', NOW); // 06-24..06-30
    expect(r.days.map((d) => d.date)).toEqual(['2026-06-25', '2026-06-30']);
    expect(r.totals.costUSD).toBe(5);
    expect(r.byModel.map((m) => m.model)).toEqual(['sonnet', 'opus']); // cost desc
    expect(r.byProject.map((p) => p.project)).toEqual(['/b', '/a']);
  });

  it('all = everything, models summed across days', () => {
    const r = rollupPeriod(HISTORY, 'all', NOW);
    expect(r.totals.costUSD).toBe(6);
    const opus = r.byModel.find((m) => m.model === 'opus')!;
    expect(opus.tokensInput).toBe(300); // 100 + 200 across two days
  });

  it('rolls up tools and task categories by period', () => {
    const today = rollupPeriod(HISTORY, 'today', NOW);
    expect(today.byTool.map((x) => x.tool)).toEqual(['Bash']);
    expect(today.byCategory.map((x) => x.category)).toEqual(['Testing']);
    const week = rollupPeriod(HISTORY, '7d', NOW);
    expect(week.byCategory.map((c) => c.category)).toEqual(['Testing', 'Coding']); // cost desc
  });
});

describe('derived metrics', () => {
  it('cacheHitPct = cached / (input + cached)', () => {
    expect(cacheHitPct(t(250, 0, 750))).toBe(75);
    expect(cacheHitPct(t(0, 0, 0))).toBe(0);
  });

  it('burnRate averages over spanned days and projects 30-day', () => {
    const r = burnRate([
      { date: '2026-06-29', ...t(0, 0, 0, 4) },
      { date: '2026-06-30', ...t(0, 0, 0, 6) },
    ]);
    expect(r.perDay).toBe(5);
    expect(r.projectedMonth).toBe(150);
  });
});
