import { describe, expect, it } from 'vitest';
import { estimateCost, lookupPrice, MODEL_PRICES } from '../electron/adapters/cost-calculator';

describe('lookupPrice', () => {
  it('exact match for known models', () => {
    expect(lookupPrice('claude-opus-4-7')).toEqual(MODEL_PRICES['claude-opus-4-7']);
    expect(lookupPrice('claude-sonnet-4-6')).toEqual(MODEL_PRICES['claude-sonnet-4-6']);
    expect(lookupPrice('gpt-5')).toEqual(MODEL_PRICES['gpt-5']);
  });

  it('prefix match for versioned suffixes', () => {
    expect(lookupPrice('claude-opus-4-7-20260118')).toEqual(MODEL_PRICES['claude-opus-4-7']);
  });

  it('family fallback for unrecognised opus/sonnet/haiku', () => {
    expect(lookupPrice('claude-opus-future')).toEqual(MODEL_PRICES['claude-opus-4-7']);
    expect(lookupPrice('claude-sonnet-future')).toEqual(MODEL_PRICES['claude-sonnet-4-6']);
    expect(lookupPrice('claude-haiku-future')).toEqual(MODEL_PRICES['claude-haiku-4-5']);
  });

  it('GPT-5 family fallback', () => {
    expect(lookupPrice('gpt-5-mini-2026-01-01')).toEqual(MODEL_PRICES['gpt-5-mini']);
    expect(lookupPrice('gpt-5-nano')).toEqual(MODEL_PRICES['gpt-5']); // falls through to gpt-5
  });

  it('returns null for completely unknown model', () => {
    expect(lookupPrice('gemini-3-pro')).toBeNull();
    expect(lookupPrice('llama-4')).toBeNull();
  });
});

describe('estimateCost', () => {
  it('returns null when model is missing', () => {
    expect(estimateCost(null, 1000, 0, 100)).toBeNull();
    expect(estimateCost(undefined, 1000, 0, 100)).toBeNull();
  });

  it('returns null for unknown model', () => {
    expect(estimateCost('mystery-model', 1000, 0, 100)).toBeNull();
  });

  it('computes Opus cost for 1M input / 0 cached / 1M output', () => {
    // 1M input @ $15 + 1M output @ $75 = $90
    expect(estimateCost('claude-opus-4-7', 1_000_000, 0, 1_000_000)).toBe(90);
  });

  it('applies cached pricing for cache_read tokens', () => {
    // 1M cached @ $1.50 = $1.50
    expect(estimateCost('claude-opus-4-7', 0, 1_000_000, 0)).toBe(1.5);
  });

  it('combines all three buckets for Sonnet', () => {
    // 100k input @ $3/M = $0.3
    // 50k cached @ $0.30/M = $0.015
    // 20k output @ $15/M = $0.30
    // total = $0.615
    expect(estimateCost('claude-sonnet-4-6', 100_000, 50_000, 20_000)).toBeCloseTo(0.615, 6);
  });

  it('handles gpt-5 pricing', () => {
    // 1M input @ $1.25 + 1M output @ $10 = $11.25
    expect(estimateCost('gpt-5', 1_000_000, 0, 1_000_000)).toBeCloseTo(11.25, 6);
  });
});
