/**
 * Token → USD cost estimation.
 *
 * Prices below are approximate as of 2026-Q2 and are intended for in-app
 * "this session has spent ~$X" displays — not for billing reconciliation.
 * Update from the model provider's pricing page when models change.
 */

export interface ModelPrice {
  /** USD per 1M uncached input tokens. */
  inputPerM: number;
  /** USD per 1M cache-read input tokens. */
  cachedInputPerM: number;
  /** USD per 1M output tokens (assistant text + reasoning combined). */
  outputPerM: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // Anthropic Claude 4.x family
  'claude-opus-4-7': { inputPerM: 15, cachedInputPerM: 1.5, outputPerM: 75 },
  'claude-opus-4-6': { inputPerM: 15, cachedInputPerM: 1.5, outputPerM: 75 },
  'claude-sonnet-4-6': { inputPerM: 3, cachedInputPerM: 0.3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 5 },
  // OpenAI GPT-5 family (used by Codex)
  'gpt-5': { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 },
  'gpt-5-mini': { inputPerM: 0.25, cachedInputPerM: 0.025, outputPerM: 2 },
};

/**
 * Returns USD cost for the given token mix, or null if the model isn't in
 * our table and no family fallback applies.
 */
export function estimateCost(
  model: string | null | undefined,
  tokensInput: number,
  tokensCached: number,
  tokensOutput: number,
): number | null {
  if (!model) return null;
  const price = lookupPrice(model);
  if (!price) return null;
  return (
    (tokensInput * price.inputPerM +
      tokensCached * price.cachedInputPerM +
      tokensOutput * price.outputPerM) /
    1_000_000
  );
}

export function lookupPrice(model: string): ModelPrice | null {
  // Exact key match.
  const exact = MODEL_PRICES[model];
  if (exact) return exact;

  // Prefix match — handles version suffixes Anthropic sometimes adds.
  // Try longest keys first so `gpt-5-mini-*` matches `gpt-5-mini`, not `gpt-5`.
  const keys = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return MODEL_PRICES[key] ?? null;
  }

  // Family fallback — keeps the dashboard useful for new minor revs.
  if (model.includes('opus')) return MODEL_PRICES['claude-opus-4-7'] ?? null;
  if (model.includes('sonnet')) return MODEL_PRICES['claude-sonnet-4-6'] ?? null;
  if (model.includes('haiku')) return MODEL_PRICES['claude-haiku-4-5'] ?? null;
  if (model.startsWith('gpt-5-mini')) return MODEL_PRICES['gpt-5-mini'] ?? null;
  if (model.startsWith('gpt-5')) return MODEL_PRICES['gpt-5'] ?? null;

  return null;
}
