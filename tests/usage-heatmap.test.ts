import { describe, it, expect } from 'vitest';
import { buildHeatmap } from '../renderer/lib/usage-heatmap';
import type { DailyUsage } from '../shared/usage-types';

function day(date: string, over: Partial<DailyUsage> = {}): DailyUsage {
  return { date, tokensInput: 0, tokensOutput: 0, tokensCached: 0, costUSD: 0, messages: 0, ...over };
}

// Fixed "today": Wed 2026-06-03 (local). 0-indexed month 5.
const TODAY = new Date(2026, 5, 3, 12, 0, 0).getTime();

describe('buildHeatmap', () => {
  it('produces `weeks` columns of 7 days each', () => {
    const h = buildHeatmap([], { weeks: 52, today: TODAY });
    expect(h.weeks).toHaveLength(52);
    for (const col of h.weeks) expect(col).toHaveLength(7);
  });

  it('blanks out future days after today', () => {
    const h = buildHeatmap([], { weeks: 4, today: TODAY });
    const lastCol = h.weeks[h.weeks.length - 1];
    // today is Wed (index 3); Thu–Sat are in the future → null
    expect(lastCol[3]?.date).toBe('2026-06-03');
    expect(lastCol[4]).toBeNull();
    expect(lastCol[5]).toBeNull();
    expect(lastCol[6]).toBeNull();
  });

  it('places days on the right weekday', () => {
    const data = [day('2026-06-01', { tokensOutput: 10 }), day('2026-06-02', { tokensOutput: 20 })];
    const lastCol = buildHeatmap(data, { weeks: 4, metric: 'tokens', today: TODAY }).weeks.at(-1)!;
    expect(lastCol[1]?.date).toBe('2026-06-01'); // Monday
    expect(lastCol[2]?.date).toBe('2026-06-02'); // Tuesday
    expect(lastCol[0]?.level).toBe(0); // Sunday, no activity
  });

  it('grades intensity 0→4 across a spread of days', () => {
    // 8 graded days the week of May 24–30 (a full Sun–Sat column).
    const data = Array.from({ length: 7 }, (_, i) =>
      day(`2026-05-${24 + i}`, { tokensOutput: (i + 1) * 1000 }),
    );
    const h = buildHeatmap(data, { weeks: 4, metric: 'tokens', today: TODAY });
    const all = h.weeks.flat().filter(Boolean) as { value: number; level: number }[];
    const top = all.reduce((a, b) => (b.value > a.value ? b : a));
    const smallNonZero = all.filter((c) => c.value > 0).reduce((a, b) => (b.value < a.value ? b : a));
    expect(top.level).toBe(4); // busiest day
    expect(smallNonZero.level).toBeGreaterThanOrEqual(1);
    expect(all.find((c) => c.value === 0)?.level).toBe(0);
  });

  it('honors the chosen metric', () => {
    const data = [day('2026-06-02', { costUSD: 5, tokensOutput: 0 })];
    const byCost = buildHeatmap(data, { weeks: 2, metric: 'cost', today: TODAY });
    const byTok = buildHeatmap(data, { weeks: 2, metric: 'tokens', today: TODAY });
    const cell = (h: ReturnType<typeof buildHeatmap>) =>
      h.weeks[h.weeks.length - 1].find((c) => c?.date === '2026-06-02');
    expect(cell(byCost)?.value).toBe(5);
    expect(cell(byTok)?.value).toBe(0);
  });

  it('emits a month label when the month changes across columns', () => {
    const h = buildHeatmap([], { weeks: 52, today: TODAY });
    expect(h.monthLabels.filter(Boolean).length).toBeGreaterThanOrEqual(10);
  });
});
