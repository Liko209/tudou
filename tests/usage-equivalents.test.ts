import { describe, it, expect } from 'vitest';
import { buildEquivalents } from '../renderer/lib/usage-equivalents';
import type { UsageTotals } from '../shared/usage-types';

function totals(over: Partial<UsageTotals>): UsageTotals {
  return { tokensInput: 0, tokensOutput: 0, tokensCached: 0, costUSD: 0, messages: 0, ...over };
}

const find = (eqs: ReturnType<typeof buildEquivalents>, key: string) => eqs.find((e) => e.key === key);

describe('buildEquivalents', () => {
  it('returns nothing for empty usage', () => {
    expect(buildEquivalents(totals({}))).toEqual([]);
  });

  it('measures output in copies of Hamlet (more output → bigger count)', () => {
    // ~40k output tokens → ~30k words → ≈ 1× Hamlet
    const small = find(buildEquivalents(totals({ tokensOutput: 40_000 })), 'books');
    expect(small?.value).toContain('Hamlet');
    expect(small?.value).toMatch(/^1 ×/);

    // ~3M output tokens → ~2.25M words → ~75× Hamlet
    const huge = find(buildEquivalents(totals({ tokensOutput: 3_000_000 })), 'books');
    expect(huge?.value).toContain('Hamlet');
    expect(Number(huge!.value.replace(/[^0-9]/g, ''))).toBeGreaterThan(50);
  });

  it('omits the books card when output is negligible', () => {
    // < 500 words of output → below the smallest (page) tier
    expect(find(buildEquivalents(totals({ tokensOutput: 100 })), 'books')).toBeUndefined();
  });

  it('picks a concrete good matching spend size', () => {
    expect(find(buildEquivalents(totals({ costUSD: 9 })), 'spend')?.value).toContain('coffees');
    expect(find(buildEquivalents(totals({ costUSD: 9000 })), 'spend')?.value).toContain('MacBook');
  });

  it('reports reading hours from total throughput', () => {
    const r = find(buildEquivalents(totals({ tokensInput: 2_000_000, tokensOutput: 0 })), 'reading');
    expect(r).toBeDefined();
    expect(r?.value).toMatch(/hours$/);
  });

  it('estimates cache savings when there are cached tokens', () => {
    const c = find(buildEquivalents(totals({ tokensCached: 5_000_000 })), 'cache');
    expect(c).toBeDefined();
    expect(c?.value).toMatch(/^≈ \$/);
  });

  it('hides cache savings when nothing was cached', () => {
    expect(find(buildEquivalents(totals({ tokensOutput: 100_000 })), 'cache')).toBeUndefined();
  });
});
