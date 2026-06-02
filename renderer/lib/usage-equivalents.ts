import type { UsageTotals } from '../../shared/usage-types';

/**
 * Re-express cumulative usage as concrete, familiar things — the "calories ≈ N
 * bowls of rice" trick. Pure + unit-tested; the <Equivalents> card row just
 * renders what this returns. All approximate and labelled as such; the point is
 * a tangible feel, not accounting.
 */

export interface Equivalent {
  key: string;
  /** Small lead-in, e.g. "相当于写了". */
  lead: string;
  /** The punchy concrete value, e.g. "3 本《哈姆雷特》". */
  value: string;
  /** One-line basis, e.g. "≈ 90,000 字 · 按输出 token 估算". */
  detail: string;
}

const WORDS_PER_TOKEN = 0.75; // rough English-ish ratio; fine for a playful estimate
const READING_WPM = 238;
// Anthropic cache reads bill at ~10% of input, so a hit saves ~90% of a
// representative input price (~$3 / 1M tok, Sonnet-ish blended).
const REP_INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const CACHE_SAVING_FRACTION = 0.9;

interface Tier {
  /** Size of one unit, in the metric's base (words or USD). */
  size: number;
  /** Render the chosen count, e.g. n => `${n} 本《哈姆雷特》`. */
  unit: (n: number) => string;
}

/** Pick the largest tier you can afford at least one whole unit of (value ≥ its
 *  size), then show the rounded count. null if below the smallest tier. */
function pickTier(value: number, tiers: Tier[]): { count: number; text: string } | null {
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i];
    if (tier && value >= tier.size) {
      const count = Math.round(value / tier.size);
      return { count, text: tier.unit(count) };
    }
  }
  return null;
}

// Concrete, broadly-known references — chosen so the count lands in a feelable
// range as usage grows (a page → Hamlet → the Three-Body trilogy → the Four
// Classics; a coffee → … → an iPhone → a MacBook).
const BOOK_TIERS: Tier[] = [
  { size: 500, unit: (n) => `${fmt(n)} 页书` },
  { size: 30_000, unit: (n) => `${fmt(n)} 本《哈姆雷特》` },
  { size: 430_000, unit: (n) => `${fmt(n)} 遍《三体》三部曲` },
  { size: 2_000_000, unit: (n) => `${fmt(n)} 套《四大名著》` },
];

const MONEY_TIERS: Tier[] = [
  { size: 4.5, unit: (n) => `${fmt(n)} 杯咖啡` },
  { size: 15, unit: (n) => `${fmt(n)} 张电影票` },
  { size: 179, unit: (n) => `${fmt(n)} 副 AirPods` },
  { size: 999, unit: (n) => `${fmt(n)} 部 iPhone 16 Pro` },
  { size: 1999, unit: (n) => `${fmt(n)} 台 MacBook Pro` },
];

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function usd(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

/**
 * Build the equivalence cards from cumulative totals. Cards whose value is too
 * small to be meaningful (rounds below one of anything) are omitted.
 */
export function buildEquivalents(totals: UsageTotals): Equivalent[] {
  const out: Equivalent[] = [];

  // 1. Output → words → books written.
  const outWords = Math.round(totals.tokensOutput * WORDS_PER_TOKEN);
  const books = pickTier(outWords, BOOK_TIERS);
  if (books) {
    out.push({
      key: 'books',
      lead: '相当于写了',
      value: books.text,
      detail: `≈ ${fmt(outWords)} 字 · 按输出 token 估算`,
    });
  }

  // 2. Spend → concrete goods.
  const money = pickTier(totals.costUSD, MONEY_TIERS);
  if (money) {
    out.push({
      key: 'spend',
      lead: '这些花费够买',
      value: money.text,
      detail: `累计 ${usd(totals.costUSD)}`,
    });
  }

  // 3. Total throughput → reading time.
  const totalWords = Math.round((totals.tokensInput + totals.tokensOutput) * WORDS_PER_TOKEN);
  const hours = totalWords / READING_WPM / 60;
  if (hours >= 1) {
    out.push({
      key: 'reading',
      lead: '相当于读了',
      value: `${fmt(Math.round(hours))} 小时`,
      detail: `按 ${READING_WPM} 词/分钟连续阅读`,
    });
  }

  // 4. Cache savings.
  const saved = totals.tokensCached * REP_INPUT_USD_PER_TOKEN * CACHE_SAVING_FRACTION;
  if (saved >= 1) {
    const coffees = Math.round(saved / 4.5);
    out.push({
      key: 'cache',
      lead: '缓存帮你省了',
      value: `≈ ${usd(saved)}`,
      detail: coffees >= 1 ? `≈ ${fmt(coffees)} 杯咖啡 · 估算` : '命中缓存省下的钱 · 估算',
    });
  }

  return out;
}
