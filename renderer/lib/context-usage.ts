import type { SessionMetrics } from '../../shared/session-types';

export interface ContextUsage {
  /** Tokens currently occupying the context window. */
  used: number;
  /** Model context window size. */
  limit: number;
  /** Percent of the window used, 0–100 (rounded, clamped). */
  pct: number;
  /** Tokens still free. */
  remaining: number;
}

/**
 * Derive context-window usage from a session's metrics, or null when the
 * CLI hasn't reported enough to compute it yet.
 */
export function contextUsage(m: SessionMetrics | null | undefined): ContextUsage | null {
  if (!m || !m.contextTokens || !m.contextLimit || m.contextLimit <= 0) return null;
  const used = m.contextTokens;
  const limit = m.contextLimit;
  const pct = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
  return { used, limit, pct, remaining: Math.max(0, limit - used) };
}

/**
 * Compact token count with K/M/B/T scaling:
 *   850 → "850", 1234 → "1.2K", 200000 → "200K", 1_500_000 → "1.5M".
 * Keeps one decimal below 100 of a unit, drops it above (so it stays ≤4
 * glyphs). Negatives are clamped to 0.
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const units: Array<[string, number]> = [
    ['T', 1e12],
    ['B', 1e9],
    ['M', 1e6],
    ['K', 1e3],
  ];
  for (const [suffix, value] of units) {
    if (n >= value) {
      const scaled = n / value;
      const text =
        scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '');
      return `${text}${suffix}`;
    }
  }
  return String(Math.round(n));
}
