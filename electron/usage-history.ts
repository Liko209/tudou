import { estimateCost } from './adapters/cost-calculator';
import type {
  DailyUsage,
  ModelUsage,
  ProjectUsage,
  UsageHistory,
  UsageTotals,
} from '../shared/usage-types';

/**
 * Pure aggregation for historical usage. The scanner streams parsed JSONL
 * objects through `foldClaudeLine`; `finalizeHistory` turns the accumulator
 * into the sorted, rolled-up shape the renderer consumes. Kept FS-free so the
 * accounting is unit-testable on fixtures.
 */
export interface UsageAccumulator {
  byDay: Map<string, UsageTotals>;
  byModel: Map<string, UsageTotals>;
  byProject: Map<string, UsageTotals>;
  totals: UsageTotals;
}

function emptyTotals(): UsageTotals {
  return { tokensInput: 0, tokensOutput: 0, tokensCached: 0, costUSD: 0, messages: 0 };
}

export function newAccumulator(): UsageAccumulator {
  return { byDay: new Map(), byModel: new Map(), byProject: new Map(), totals: emptyTotals() };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function addInto(map: Map<string, UsageTotals>, key: string, t: Omit<UsageTotals, 'messages'>): void {
  const cur = map.get(key) ?? emptyTotals();
  cur.tokensInput += t.tokensInput;
  cur.tokensOutput += t.tokensOutput;
  cur.tokensCached += t.tokensCached;
  cur.costUSD += t.costUSD;
  cur.messages += 1;
  map.set(key, cur);
}

/**
 * Fold one parsed Claude JSONL object into the accumulator. No-op for lines
 * that aren't assistant messages carrying token usage (user turns, meta,
 * synthetic placeholder turns). `project` scopes the per-project rollup —
 * pass the line's cwd (preferred) or a decoded directory label.
 */
export function foldClaudeLine(acc: UsageAccumulator, parsed: unknown, project: string): void {
  if (!isRecord(parsed) || parsed.type !== 'assistant') return;
  const msg = isRecord(parsed.message) ? parsed.message : null;
  if (!msg) return;
  // Synthetic placeholder turns carry all-zero usage and must not count.
  if (msg.model === '<synthetic>') return;
  const usage = isRecord(msg.usage) ? msg.usage : null;
  if (!usage) return;

  // Mirror the live adapter's accounting: full-price input includes cache
  // creation; cache-read is the discounted "cached" bucket.
  const tokensInput = num(usage.input_tokens) + num(usage.cache_creation_input_tokens);
  const tokensCached = num(usage.cache_read_input_tokens);
  const tokensOutput = num(usage.output_tokens);
  if (tokensInput === 0 && tokensCached === 0 && tokensOutput === 0) return;

  const model = typeof msg.model === 'string' ? msg.model : null;
  const costUSD = estimateCost(model, tokensInput, tokensCached, tokensOutput) ?? 0;
  const day =
    typeof parsed.timestamp === 'string' && parsed.timestamp.length >= 10
      ? parsed.timestamp.slice(0, 10)
      : 'unknown';

  const delta = { tokensInput, tokensOutput, tokensCached, costUSD };
  addInto(acc.byDay, day, delta);
  addInto(acc.byModel, model ?? 'unknown', delta);
  addInto(acc.byProject, project, delta);

  acc.totals.tokensInput += tokensInput;
  acc.totals.tokensOutput += tokensOutput;
  acc.totals.tokensCached += tokensCached;
  acc.totals.costUSD += costUSD;
  acc.totals.messages += 1;
}

/** Merge `from` into `into` (used to combine per-file accumulators). */
export function mergeAccumulator(into: UsageAccumulator, from: UsageAccumulator): void {
  const mergeMap = (a: Map<string, UsageTotals>, b: Map<string, UsageTotals>): void => {
    for (const [k, v] of b) {
      const cur = a.get(k) ?? emptyTotals();
      cur.tokensInput += v.tokensInput;
      cur.tokensOutput += v.tokensOutput;
      cur.tokensCached += v.tokensCached;
      cur.costUSD += v.costUSD;
      cur.messages += v.messages;
      a.set(k, cur);
    }
  };
  mergeMap(into.byDay, from.byDay);
  mergeMap(into.byModel, from.byModel);
  mergeMap(into.byProject, from.byProject);
  into.totals.tokensInput += from.totals.tokensInput;
  into.totals.tokensOutput += from.totals.tokensOutput;
  into.totals.tokensCached += from.totals.tokensCached;
  into.totals.costUSD += from.totals.costUSD;
  into.totals.messages += from.totals.messages;
}

export function finalizeHistory(
  acc: UsageAccumulator,
  generatedAt: string,
  topProjects = 12,
): UsageHistory {
  const byDay: DailyUsage[] = [...acc.byDay.entries()]
    .map(([date, t]) => ({ date, ...t }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const byModel: ModelUsage[] = [...acc.byModel.entries()]
    .map(([model, t]) => ({ model, ...t }))
    .sort((a, b) => b.costUSD - a.costUSD || b.tokensInput - a.tokensInput);
  const byProject: ProjectUsage[] = [...acc.byProject.entries()]
    .map(([project, t]) => ({ project, ...t }))
    .sort((a, b) => b.costUSD - a.costUSD || b.tokensInput - a.tokensInput)
    .slice(0, topProjects);

  return { generatedAt, totals: { ...acc.totals }, byDay, byModel, byProject };
}
