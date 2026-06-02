'use client';

import { useMemo, useState } from 'react';
import type { DailyUsage } from '../../../shared/usage-types';
import { buildHeatmap, type HeatMetric, type HeatCell } from '../../lib/usage-heatmap';
import { formatTokens } from '../../lib/context-usage';
import { formatUSD } from '../../lib/usage';
import { cn } from '../../lib/utils';

// Use only Tailwind's default opacity steps (5/10/30/50/75/…) — arbitrary ones
// like /8 or /45 generate NO css, which is why empty cells were invisible.
// Level 0 = a visible empty square (so blank days still draw a grid).
const LEVEL_CLASS = [
  'bg-edge/10',
  'bg-accent/30',
  'bg-accent/50',
  'bg-accent/75',
  'bg-accent',
] as const;

const WEEKDAY_LABEL = ['', 'Mon', '', 'Wed', '', 'Fri', '']; // rows Sun..Sat
const METRICS: { key: HeatMetric; label: string }[] = [
  { key: 'tokens', label: 'Tokens' },
  { key: 'cost', label: 'Cost' },
  { key: 'messages', label: 'Msgs' },
];

function fmt(metric: HeatMetric, v: number): string {
  if (metric === 'cost') return formatUSD(v);
  if (metric === 'messages') return `${v.toLocaleString('en-US')} msgs`;
  return `${formatTokens(v)} tok`;
}

/**
 * GitHub-style contribution calendar of daily usage (52 weeks). Shade defaults
 * to tokens; a small toggle switches the metric. Pure layout from
 * {@link buildHeatmap}; this just paints the grid + a hover readout.
 */
export function ActivityHeatmap({ byDay }: { byDay: DailyUsage[] }) {
  const [metric, setMetric] = useState<HeatMetric>('tokens');
  const [hover, setHover] = useState<HeatCell | null>(null);

  const heat = useMemo(
    () => buildHeatmap(byDay, { weeks: 52, metric, today: Date.now() }),
    [byDay, metric],
  );

  const activeDays = heat.weeks.flat().filter((c): c is HeatCell => !!c && c.value > 0).length;

  return (
    <div className="rounded-lg border border-edge/10 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
          Activity · last 52 weeks
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-subtle">
            {hover ? (
              <>
                <span className="font-mono text-ink">{hover.date}</span> · {fmt(metric, hover.value)}
              </>
            ) : (
              `${activeDays} active day${activeDays === 1 ? '' : 's'}`
            )}
          </span>
          <div className="flex rounded-md bg-sunken p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] transition-colors',
                  metric === m.key ? 'bg-canvas text-ink shadow-sm' : 'text-subtle hover:text-ink',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          {/* month labels */}
          <div className="flex pl-7 text-[9px] text-subtle">
            {heat.monthLabels.map((m, i) => (
              <div key={i} className="w-[13px] shrink-0">
                {m}
              </div>
            ))}
          </div>
          {/* weekday gutter + week columns */}
          <div className="flex gap-[3px]">
            <div className="mr-1 flex w-6 shrink-0 flex-col gap-[3px]">
              {WEEKDAY_LABEL.map((d, i) => (
                <div key={i} className="h-2.5 text-[9px] leading-[10px] text-subtle">
                  {d}
                </div>
              ))}
            </div>
            {heat.weeks.map((col, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {col.map((cell, di) =>
                  cell ? (
                    <div
                      key={di}
                      onMouseEnter={() => setHover(cell)}
                      onMouseLeave={() => setHover(null)}
                      title={`${cell.date} · ${fmt(metric, cell.value)}`}
                      className={cn('h-2.5 w-2.5 rounded-[2px]', LEVEL_CLASS[cell.level])}
                    />
                  ) : (
                    <div key={di} className="h-2.5 w-2.5" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-subtle">
        <span>less</span>
        {LEVEL_CLASS.map((c, i) => (
          <span key={i} className={cn('h-2.5 w-2.5 rounded-[2px]', c)} />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}
