import type { RateLimits, RateLimitWindow } from '../shared/usage-types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseWindow(v: unknown): RateLimitWindow | undefined {
  if (!isRecord(v)) return undefined;
  const pctRaw = v.usedPercentage ?? v.used_percentage;
  const resetRaw = v.resetsAt ?? v.resets_at;
  if (pctRaw === undefined && resetRaw === undefined) return undefined;
  return {
    usedPercentage: Math.min(100, Math.max(0, num(pctRaw))),
    resetsAt: num(resetRaw),
  };
}

/**
 * Parse the rate-limit snapshot file (or a raw statusLine `rate_limits`
 * object). Tolerant of camelCase and the statusLine payload's snake_case.
 * Returns null when there's no usable window.
 */
export function parseRateLimits(raw: unknown): RateLimits | null {
  if (!isRecord(raw)) return null;
  const fiveHour = parseWindow(raw.fiveHour ?? raw.five_hour);
  const sevenDay = parseWindow(raw.sevenDay ?? raw.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return {
    source: typeof raw.source === 'string' ? raw.source : 'claude',
    updatedAt: num(raw.updatedAt ?? raw.updated_at),
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
  };
}
