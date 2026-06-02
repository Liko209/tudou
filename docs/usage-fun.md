# Usage: "In perspective" + activity heatmap

Two playful, glanceable modules for the Usage page that turn abstract numbers
into something human — inspired by running apps that show "calories ≈ N bowls
of rice".

## Data

Both are **renderer-only**. Everything needed already comes from
`window.agentDashboard.usage.getHistory(): UsageHistory`:

- `totals` (tokensInput/Output/Cached, costUSD, messages) — drives the
  equivalences.
- `byDay: DailyUsage[]` (date, tokens, cost, messages — ascending, all-time) —
  drives the heatmap.

No main-process or scanner changes.

## Module A — "In perspective" (equivalences)

A small card row that re-expresses cumulative usage as familiar things. Pure
mapping (`renderer/lib/usage-equivalents.ts`, unit-tested) from totals → facts;
the component just renders them.

Candidate equivalences (pick a few; all derived from real constants):

| Fact | Basis |
|---|---|
| Output ≈ **N novels** written | output tokens × ~0.75 words/token ÷ 95,000 words (a typical novel) |
| ≈ **N hours** of reading | total words ÷ 238 wpm ÷ 60 |
| ≈ **N reams** of paper if printed | total words ÷ ~500 words/page ÷ 500 pages/ream |
| Spend ≈ **N cups of coffee** | costUSD ÷ $4.50 |
| Cache saved ≈ **$X** (and "≈ N coffees") | cached tokens re-priced at input rate − cached rate |
| ≈ **N back-and-forth messages** | totals.messages |

Each card: a big number + unit + one-line basis (e.g. "≈ 3 novels · at ~0.75
words/token"). Tasteful, monochrome, matches the existing Usage cards. Round
sensibly (e.g. "≈ 3", "≈ 12k words"). Hide a card if its value rounds to 0.

**Why words/novels, not "lines of code":** we don't track LOC; output tokens are
the honest proxy for "how much the model produced". Framing it as words/books
reads naturally and avoids over-claiming.

## Module B — Activity heatmap (GitHub-style)

A calendar grid: columns = weeks, rows = weekdays (Sun→Sat), each cell one day,
shaded by that day's intensity. Tooltip on hover ("2026-05-10 · $4.20 · 1.2M
tok · 38 msgs"). A small "less ▢▢▣▣ more" legend.

- **Range:** last ~26 weeks (half a year) by default — enough to feel like the
  GitHub graph without dwarfing the page. (Could expose 1y later.)
- **Metric:** shade by a chosen metric (default cost; could toggle to tokens /
  messages). Buckets via quantiles of non-zero days (so a few huge days don't
  flatten everything), mapped to 5 levels using the existing accent ramp
  (`bg-surface` → `bg-accent`).
- **Build:** pure `buildHeatmap(byDay, { weeks, metric, today })` →
  `{ weeks: Cell[][], max, levels }` in `renderer/lib/usage-heatmap.ts`,
  unit-tested (correct day alignment, bucketing, empty days). Component renders
  the grid + month labels.

## Execution plan

**M1 — In perspective**
- F1.1 `usage-equivalents.ts` pure mapping + tests (constants, rounding, hide-zero).
- F1.2 `<Equivalents>` card row in `UsageHistory` (under the summary cards).

**M2 — Activity heatmap**
- F2.1 `usage-heatmap.ts` pure builder + tests (week/day alignment, quantile
  buckets, empty/short history).
- F2.2 `<ActivityHeatmap>` component (grid, month labels, legend, hover readout)
  wired into the Usage history section.

Both modules are independent; TDD the two pure libs, render layer verified by a
build + eyeball. Ship together.

## Open decisions

- **D1 Which equivalences** to show (pick from the table — novels/reading-time/
  coffees/cache-saved/messages)?
- **D2 Heatmap metric + range:** default shade by cost or by tokens? 26 weeks ok?
