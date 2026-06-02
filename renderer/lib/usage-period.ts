import type {
  DailyUsage,
  ModelUsage,
  ProjectUsage,
  UsageHistory,
  UsageTotals,
} from '../../shared/usage-types';

export type UsagePeriod = 'today' | '7d' | '30d' | 'all';

export const PERIOD_LABELS: Record<UsagePeriod, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  all: 'All time',
};

const WINDOW_DAYS: Record<Exclude<UsagePeriod, 'all'>, number> = { today: 1, '7d': 7, '30d': 30 };

export interface PeriodUsage {
  period: UsagePeriod;
  totals: UsageTotals;
  /** Days within the window, ascending. */
  days: DailyUsage[];
  byModel: ModelUsage[];
  byProject: ProjectUsage[];
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function emptyTotals(): UsageTotals {
  return { tokensInput: 0, tokensOutput: 0, tokensCached: 0, costUSD: 0, messages: 0 };
}

function add(into: UsageTotals, t: UsageTotals): void {
  into.tokensInput += t.tokensInput;
  into.tokensOutput += t.tokensOutput;
  into.tokensCached += t.tokensCached;
  into.costUSD += t.costUSD;
  into.messages += t.messages;
}

/**
 * Roll the day-granular history up to a single period window. Dates are UTC
 * calendar days (matching the transcript timestamps), compared as strings.
 * `nowMs` is passed in so this stays pure/testable.
 */
export function rollupPeriod(h: UsageHistory, period: UsagePeriod, nowMs: number): PeriodUsage {
  const start = period === 'all' ? '' : utcDay(nowMs - (WINDOW_DAYS[period] - 1) * 86_400_000);
  const inWindow = (date: string): boolean => date >= start;

  const totals = emptyTotals();
  const days = h.byDay.filter((d) => inWindow(d.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const d of days) add(totals, d);

  const byModelMap = new Map<string, UsageTotals>();
  for (const m of h.modelByDay) {
    if (!inWindow(m.date)) continue;
    const cur = byModelMap.get(m.model) ?? emptyTotals();
    add(cur, m);
    byModelMap.set(m.model, cur);
  }
  const byProjectMap = new Map<string, UsageTotals>();
  for (const p of h.projectByDay) {
    if (!inWindow(p.date)) continue;
    const cur = byProjectMap.get(p.project) ?? emptyTotals();
    add(cur, p);
    byProjectMap.set(p.project, cur);
  }

  const byModel: ModelUsage[] = [...byModelMap.entries()]
    .map(([model, t]) => ({ model, ...t }))
    .sort((a, b) => b.costUSD - a.costUSD);
  const byProject: ProjectUsage[] = [...byProjectMap.entries()]
    .map(([project, t]) => ({ project, ...t }))
    .sort((a, b) => b.costUSD - a.costUSD)
    .slice(0, 12);

  return { period, totals, days, byModel, byProject };
}

/** Cache-hit ratio (0–100): cached input as a share of all input. */
export function cacheHitPct(t: UsageTotals): number {
  const input = t.tokensInput + t.tokensCached;
  return input > 0 ? Math.round((t.tokensCached / input) * 100) : 0;
}

/** Average $/day over the window's spanned days, and a 30-day projection. */
export function burnRate(days: DailyUsage[]): { perDay: number; projectedMonth: number } {
  if (days.length === 0) return { perDay: 0, projectedMonth: 0 };
  const cost = days.reduce((a, d) => a + d.costUSD, 0);
  const perDay = cost / days.length;
  return { perDay, projectedMonth: perDay * 30 };
}
