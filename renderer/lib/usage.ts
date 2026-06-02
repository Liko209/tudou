import type { Session, SessionStatus } from '../../shared/session-types';

/** Compact USD formatter: `$0.00` under 100, whole dollars at/above. */
export function formatUSD(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  return n >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
}

const ALL_STATUSES: SessionStatus[] = [
  'starting',
  'working',
  'waiting',
  'blocked',
  'errored',
  'exited',
];

export interface ModelUsage {
  model: string;
  sessions: number;
  /** input + output + cached tokens, summed. */
  tokens: number;
  costUSD: number;
}

export interface UsageSummary {
  sessionCount: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  totalTokens: number;
  /** Sum of estimatedCostUSD, treating null as 0. */
  totalCostUSD: number;
  /** True if at least one session reported a (non-null) cost. */
  hasCostData: boolean;
  statusCounts: Record<SessionStatus, number>;
  /** Per-model rollup, sorted by tokens descending. `unknown` for null model. */
  byModel: ModelUsage[];
}

/**
 * Aggregate live per-session metrics into a single usage snapshot for the
 * Usage view. Pure — derived entirely from the passed sessions.
 */
export function summarizeUsage(sessions: Session[]): UsageSummary {
  const statusCounts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
    SessionStatus,
    number
  >;
  const models = new Map<string, ModelUsage>();

  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCached = 0;
  let totalCostUSD = 0;
  let hasCostData = false;

  for (const s of sessions) {
    const m = s.metrics;
    tokensInput += m.tokensInput;
    tokensOutput += m.tokensOutput;
    tokensCached += m.tokensCached;
    if (m.estimatedCostUSD != null) {
      hasCostData = true;
      totalCostUSD += m.estimatedCostUSD;
    }
    statusCounts[s.status] += 1;

    const key = s.model ?? 'unknown';
    const entry = models.get(key) ?? { model: key, sessions: 0, tokens: 0, costUSD: 0 };
    entry.sessions += 1;
    entry.tokens += m.tokensInput + m.tokensOutput + m.tokensCached;
    entry.costUSD += m.estimatedCostUSD ?? 0;
    models.set(key, entry);
  }

  const byModel = [...models.values()].sort((a, b) => b.tokens - a.tokens);

  return {
    sessionCount: sessions.length,
    tokensInput,
    tokensOutput,
    tokensCached,
    totalTokens: tokensInput + tokensOutput + tokensCached,
    totalCostUSD,
    hasCostData,
    statusCounts,
    byModel,
  };
}
