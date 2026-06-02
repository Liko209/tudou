import { describe, expect, it } from 'vitest';
import { parseRateLimits } from '../electron/rate-limits';

describe('parseRateLimits', () => {
  it('parses both windows (snake_case from the statusLine payload)', () => {
    const r = parseRateLimits({
      source: 'claude',
      updated_at: 1000,
      five_hour: { used_percentage: 42, resets_at: 2000 },
      seven_day: { used_percentage: 80, resets_at: 3000 },
    });
    expect(r).not.toBeNull();
    expect(r!.source).toBe('claude');
    expect(r!.updatedAt).toBe(1000);
    expect(r!.fiveHour).toEqual({ usedPercentage: 42, resetsAt: 2000 });
    expect(r!.sevenDay).toEqual({ usedPercentage: 80, resetsAt: 3000 });
  });

  it('parses camelCase too', () => {
    const r = parseRateLimits({ updatedAt: 5, fiveHour: { usedPercentage: 10, resetsAt: 9 } });
    expect(r!.fiveHour).toEqual({ usedPercentage: 10, resetsAt: 9 });
    expect(r!.sevenDay).toBeUndefined();
  });

  it('clamps percentage to 0–100 and defaults missing reset to 0', () => {
    const r = parseRateLimits({ five_hour: { used_percentage: 130 }, seven_day: { used_percentage: -5, resets_at: 7 } });
    expect(r!.fiveHour).toEqual({ usedPercentage: 100, resetsAt: 0 });
    expect(r!.sevenDay).toEqual({ usedPercentage: 0, resetsAt: 7 });
  });

  it('returns null for empty / invalid / window-less input', () => {
    expect(parseRateLimits(null)).toBeNull();
    expect(parseRateLimits('nope')).toBeNull();
    expect(parseRateLimits({})).toBeNull();
    expect(parseRateLimits({ source: 'claude', updated_at: 1 })).toBeNull(); // no windows
  });
});
