import type { DailyUsage } from '../../shared/usage-types';

/**
 * Build a GitHub-style contribution grid from per-day usage. Pure + unit-tested;
 * the <ActivityHeatmap> component renders the returned weeks.
 *
 * Columns = weeks (oldest → newest), each week is 7 cells Sun→Sat. Cells before
 * the range start or after `today` are null (rendered as blank spacers so the
 * calendar aligns). Intensity is bucketed into 0–4 levels via quantiles of the
 * NON-ZERO days, so a few huge days don't wash everything else out.
 */

export type HeatMetric = 'tokens' | 'cost' | 'messages';

export interface HeatCell {
  date: string; // YYYY-MM-DD
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Heatmap {
  weeks: (HeatCell | null)[][];
  /** Upper bound of each non-zero level (thresholds[0] = top of level 1, …). */
  thresholds: number[];
  max: number;
  /** Month label per week column (empty unless the month changed that column). */
  monthLabels: string[];
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function metricOf(d: DailyUsage, metric: HeatMetric): number {
  if (metric === 'cost') return d.costUSD;
  if (metric === 'messages') return d.messages;
  return d.tokensInput + d.tokensOutput + d.tokensCached;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param byDay   per-day usage, any order (ascending preferred)
 * @param weeks   number of week columns to show (e.g. 52)
 * @param metric  which field drives intensity
 * @param today   ms timestamp for "now" (injected so it's testable)
 */
export function buildHeatmap(
  byDay: DailyUsage[],
  { weeks = 52, metric = 'tokens', today }: { weeks?: number; metric?: HeatMetric; today: number },
): Heatmap {
  const values = new Map<string, number>();
  for (const d of byDay) values.set(d.date, metricOf(d, metric));

  // Quantile thresholds from non-zero days → 4 buckets (levels 1–4).
  const nonZero = [...values.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const max = nonZero[nonZero.length - 1] ?? 0;
  const q = (p: number): number =>
    nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))] ?? 0;
  const t1 = q(0.25);
  const t2 = q(0.5);
  const t3 = q(0.75);
  const thresholds = [t1, t2, t3, max];
  const levelOf = (v: number): HeatCell['level'] => {
    if (v <= 0) return 0;
    if (v <= t1) return 1;
    if (v <= t2) return 2;
    if (v <= t3) return 3;
    return 4;
  };

  // The grid ends on the column containing today and spans `weeks` columns. Find
  // the Saturday on/after today (end of the last column), then walk back.
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + (6 - end.getDay())); // Sat of this week
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1)); // Sunday of the first column

  const todayYmd = ymd(new Date(today));
  const cols: (HeatCell | null)[][] = [];
  const monthLabels: string[] = [];
  let lastMonth = -1;

  const cursor = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const col: (HeatCell | null)[] = [];
    let labelled = false;
    for (let day = 0; day < 7; day++) {
      const date = ymd(cursor);
      // First row of the column drives the month label (when the month flips).
      if (day === 0) {
        const m = cursor.getMonth();
        if (m !== lastMonth) {
          monthLabels.push(MONTHS[m] ?? '');
          lastMonth = m;
          labelled = true;
        }
      }
      if (date > todayYmd) {
        col.push(null); // future
      } else {
        const value = values.get(date) ?? 0;
        col.push({ date, value, level: levelOf(value) });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!labelled) monthLabels.push('');
    cols.push(col);
  }

  return { weeks: cols, thresholds, max, monthLabels };
}
