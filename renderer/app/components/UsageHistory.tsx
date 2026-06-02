'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UsageHistory } from '../../../shared/usage-types';
import { formatTokens } from '../../lib/context-usage';
import { formatUSD } from '../../lib/usage';
import { cn } from '../../lib/utils';

/** Trim a model id to a compact label: drop a trailing -YYYYMMDD date stamp. */
export function shortModel(model: string): string {
  return model.replace(/-\d{6,}$/, '');
}

function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Loaded {
  loading: boolean;
  error: string | null;
  data: UsageHistory | null;
}

/**
 * Historical usage scanned from the CLI JSONL transcripts on disk
 * (all-time, plus today / last-7-days rollups). Loaded lazily over IPC when
 * the Usage view opens; refreshable.
 */
export function UsageHistorySection() {
  const [state, setState] = useState<Loaded>({ loading: true, error: null, data: null });

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
  // today / last 7 days from the client's local calendar.
  const todayStr = localDay(new Date());
  const weekAgoStr = localDay(new Date(Date.now() - 6 * 86_400_000));
  const today = data?.byDay.find((d) => d.date === todayStr);
  const weekCost =
    data?.byDay.filter((d) => d.date >= weekAgoStr).reduce((a, d) => a + d.costUSD, 0) ?? 0;
  const weekTokens =
    data?.byDay
      .filter((d) => d.date >= weekAgoStr)
      .reduce((a, d) => a + d.tokensInput + d.tokensOutput + d.tokensCached, 0) ?? 0;

  return (
    <div className="rounded-lg border border-edge/10 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
          History · Claude
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

      {state.error ? (
        <div className="text-xs text-muted">Couldn’t read history: {state.error}</div>
      ) : !data ? (
        <div className="text-xs text-subtle">Scanning transcripts…</div>
      ) : data.totals.messages === 0 ? (
        <div className="text-xs text-muted">No Claude transcripts found yet.</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Today" value={formatUSD(today?.costUSD ?? 0)} sub={formatTokens((today?.tokensInput ?? 0) + (today?.tokensOutput ?? 0) + (today?.tokensCached ?? 0)) + ' tok'} />
            <Stat label="Last 7 days" value={formatUSD(weekCost)} sub={formatTokens(weekTokens) + ' tok'} />
            <Stat label="All time" value={formatUSD(data.totals.costUSD)} sub={formatTokens(data.totals.tokensInput + data.totals.tokensOutput + data.totals.tokensCached) + ' tok'} />
          </div>

          <DayBars data={data} />

          <div className="grid grid-cols-2 gap-4">
            <MiniTable
              title="Top models"
              rows={data.byModel.slice(0, 6).map((m) => ({ key: m.model, label: shortModel(m.model), cost: m.costUSD }))}
            />
            <MiniTable
              title="Top projects"
              rows={data.byProject.slice(0, 6).map((p) => ({ key: p.project, label: p.project.split('/').pop() || p.project, cost: p.costUSD }))}
            />
          </div>
        </div>
      )}
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

/** Last 14 days as vertical cost bars. */
function DayBars({ data }: { data: UsageHistory }) {
  const days: { date: string; cost: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = localDay(new Date(Date.now() - i * 86_400_000));
    const d = data.byDay.find((x) => x.date === date);
    days.push({ date, cost: d?.costUSD ?? 0 });
  }
  const max = Math.max(0.0001, ...days.map((d) => d.cost));
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-subtle">Last 14 days</div>
      <div className="flex h-16 items-end gap-1">
        {days.map((d) => (
          <div
            key={d.date}
            className="group relative flex-1 rounded-sm bg-accent/60"
            style={{ height: `${Math.max(2, Math.round((d.cost / max) * 100))}%` }}
            title={`${d.date} · ${formatUSD(d.cost)}`}
          />
        ))}
      </div>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: { key: string; label: string; cost: number }[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-subtle">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-mono text-muted" title={r.key}>
              {r.label}
            </span>
            <span className="shrink-0 font-mono text-subtle">{formatUSD(r.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
