'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DailyUsage, UsageHistory } from '../../../shared/usage-types';
import { formatTokens } from '../../lib/context-usage';
import { formatUSD } from '../../lib/usage';
import {
  rollupPeriod,
  cacheHitPct,
  burnRate,
  PERIOD_LABELS,
  type UsagePeriod,
} from '../../lib/usage-period';
import { cn } from '../../lib/utils';

/** Trim a model id to a compact label: drop a trailing -YYYYMMDD date stamp. */
export function shortModel(model: string): string {
  return model.replace(/-\d{6,}$/, '');
}

function tokensOf(t: { tokensInput: number; tokensOutput: number; tokensCached: number }): number {
  return t.tokensInput + t.tokensOutput + t.tokensCached;
}

const PERIODS: UsagePeriod[] = ['today', '7d', '30d', 'all'];

interface Loaded {
  loading: boolean;
  error: string | null;
  data: UsageHistory | null;
}

/**
 * Historical usage scanned from the CLI JSONL transcripts on disk, sliceable by
 * period (Today / 7d / 30d / All). Loaded lazily over IPC when the Usage view
 * opens; refreshable.
 */
export function UsageHistorySection() {
  const [state, setState] = useState<Loaded>({ loading: true, error: null, data: null });
  const [period, setPeriod] = useState<UsagePeriod>('7d');

  const load = useCallback(() => {
    const api = window.agentDashboard?.usage;
    if (!api) {
      setState({ loading: false, error: 'unavailable', data: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getHistory()
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((e) => setState({ loading: false, error: e instanceof Error ? e.message : String(e), data: null }));
  }, []);

  useEffect(() => load(), [load]);

  const data = state.data;
  const roll = useMemo(
    () => (data ? rollupPeriod(data, period, Date.now()) : null),
    [data, period],
  );

  return (
    <div className="rounded-lg border border-edge/10 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">History · Claude</div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md bg-sunken p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] transition-colors',
                  period === p ? 'bg-canvas text-ink shadow-sm' : 'text-subtle hover:text-ink',
                )}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={load}
            aria-label="Refresh history"
            title="Refresh"
            className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-ink"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', state.loading && 'animate-spin')} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {state.error ? (
        <div className="text-xs text-muted">Couldn’t read history: {state.error}</div>
      ) : !data || !roll ? (
        <div className="text-xs text-subtle">Scanning transcripts…</div>
      ) : data.totals.messages === 0 ? (
        <div className="text-xs text-muted">No Claude transcripts found yet.</div>
      ) : (
        <div className="flex flex-col gap-4">
          <Cards roll={roll} />
          <DayBars days={roll.days} />
          <div className="grid grid-cols-2 gap-4">
            <BarList
              title="By model"
              rows={roll.byModel.slice(0, 6).map((m) => ({ key: m.model, label: shortModel(m.model), cost: m.costUSD }))}
            />
            <BarList
              title="By project"
              rows={roll.byProject.slice(0, 6).map((p) => ({ key: p.project, label: p.project.split('/').pop() || p.project, cost: p.costUSD }))}
            />
          </div>
          <TopSessions data={data} />
        </div>
      )}
    </div>
  );
}

function Cards({ roll }: { roll: NonNullable<ReturnType<typeof rollupPeriod>> }) {
  const burn = burnRate(roll.days);
  return (
    <div className="grid grid-cols-4 gap-3 text-center">
      <Stat label="Cost" value={formatUSD(roll.totals.costUSD)} sub={`${roll.totals.messages} msgs`} />
      <Stat label="Tokens" value={formatTokens(tokensOf(roll.totals))} sub={`${formatTokens(roll.totals.tokensOutput)} out`} />
      <Stat label="Cache hit" value={`${cacheHitPct(roll.totals)}%`} sub="of input" />
      <Stat
        label="Burn rate"
        value={`${formatUSD(burn.perDay)}/d`}
        sub={`~${formatUSD(burn.projectedMonth)}/mo`}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md bg-sunken px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-ink">{value}</div>
      <div className="text-[10px] text-subtle">{sub}</div>
    </div>
  );
}

/** Daily cost bars with a hover readout line below. */
function DayBars({ days }: { days: DailyUsage[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0.0001, ...days.map((d) => d.costUSD));
  const active = hover !== null ? days[hover] : days[days.length - 1];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-subtle">Daily cost</span>
        {active && (
          <span className="text-[11px] text-subtle">
            <span className="font-mono text-ink">{active.date}</span> · {formatUSD(active.costUSD)} ·{' '}
            {formatTokens(tokensOf(active))} tok · {active.messages} msgs
          </span>
        )}
      </div>
      {days.length === 0 ? (
        <div className="text-[11px] text-subtle">No activity in this period.</div>
      ) : (
        <div className="flex h-20 items-end gap-0.5" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <div
              key={d.date}
              onMouseEnter={() => setHover(i)}
              title={`${d.date} · ${formatUSD(d.costUSD)}`}
              className={cn(
                'min-w-[2px] flex-1 cursor-default rounded-sm transition-colors',
                hover === i ? 'bg-accent' : 'bg-accent/55 hover:bg-accent',
              )}
              style={{ height: `${Math.max(2, Math.round((d.costUSD / max) * 100))}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BarList({ title, rows }: { title: string; rows: { key: string; label: string; cost: number }[] }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.cost));
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-subtle">{title}</div>
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 ? (
          <div className="text-[11px] text-subtle">—</div>
        ) : (
          rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-xs" title={`${r.key} · ${formatUSD(r.cost)}`}>
              <span className="w-24 shrink-0 truncate font-mono text-muted">{r.label}</span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.round((r.cost / max) * 100)}%` }} />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-subtle">{formatUSD(r.cost)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Costliest sessions (all-time) — a leaderboard, independent of the period. */
function TopSessions({ data }: { data: UsageHistory }) {
  if (data.sessions.length === 0) return null;
  const avg = data.sessionCount > 0 ? data.totals.costUSD / data.sessionCount : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-subtle">Costliest sessions · all time</span>
        <span className="text-[10px] text-subtle">
          {data.sessionCount} sessions · {formatUSD(avg)} avg
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {data.sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs" title={`${s.project}\n${s.id}`}>
            <span className="w-28 shrink-0 truncate font-mono text-muted">
              {s.project.split('/').pop() || s.project}
            </span>
            <span className="w-20 shrink-0 font-mono text-subtle">{s.date}</span>
            <span className="min-w-0 flex-1 truncate text-subtle">{formatTokens(tokensOf(s))} tok</span>
            <span className="shrink-0 font-mono text-muted">{formatUSD(s.costUSD)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
