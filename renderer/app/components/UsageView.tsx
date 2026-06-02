'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useSessionsStore, sortSessionsByActivity } from '../../lib/stores/sessions-store';
import { useUIStore } from '../../lib/stores/ui-store';
import { summarizeUsage, formatUSD, type UsageSummary } from '../../lib/usage';
import { contextUsage, formatTokens } from '../../lib/context-usage';
import { cn } from '../../lib/utils';
import { CliBadge } from './CliBadge';
import { StatusDot } from './StatusDot';
import { UsageHistorySection, shortModel } from './UsageHistory';
import { RateLimitsSection } from './RateLimits';

/**
 * Full-screen Usage overview — aggregates the live per-session metrics Tudou
 * already tracks (tokens, cost, context window, model) across all sessions,
 * with a per-session breakdown. Rendered over the center pane.
 */
export function UsageView() {
  const sessions = useSessionsStore((s) => s.sessions);
  const setActive = useSessionsStore((s) => s.setActive);
  const setUsageOpen = useUIStore((s) => s.setUsageOpen);

  const list = useMemo(() => sortSessionsByActivity(sessions), [sessions]);
  const summary = useMemo(() => summarizeUsage(list), [list]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-edge/10 px-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-medium text-ink">Usage</h1>
          <span className="text-xs text-subtle">
            live · {summary.sessionCount} session{summary.sessionCount === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setUsageOpen(false)}
          aria-label="Close usage"
          className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-surface/60 hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <RateLimitsSection />
          <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">Live</div>
          {summary.sessionCount === 0 ? (
            <div className="rounded-lg border border-edge/10 bg-surface p-6 text-center text-sm text-muted">
              No running sessions — live usage appears here once a session starts.
            </div>
          ) : (
            <>
              <SummaryCards summary={summary} />
              <ModelDistribution summary={summary} />
              <SessionTable list={list} onOpen={(id) => { setActive(id); setUsageOpen(false); }} />
            </>
          )}
          <UsageHistorySection />
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ summary }: { summary: UsageSummary }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card label="Estimated cost">
        <div className="text-2xl font-semibold text-ink">{formatUSD(summary.totalCostUSD)}</div>
        {!summary.hasCostData && <div className="mt-1 text-[11px] text-subtle">no cost data yet</div>}
      </Card>
      <Card label="Total tokens">
        <div className="text-2xl font-semibold text-ink">{formatTokens(summary.totalTokens)}</div>
        <div className="mt-1 text-[11px] text-subtle">
          {formatTokens(summary.tokensInput)} in · {formatTokens(summary.tokensOutput)} out ·{' '}
          {formatTokens(summary.tokensCached)} cache
        </div>
      </Card>
      <Card label="Sessions">
        <div className="text-2xl font-semibold text-ink">{summary.sessionCount}</div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-subtle">
          {summary.statusCounts.working > 0 && <span>{summary.statusCounts.working} working</span>}
          {summary.statusCounts.waiting > 0 && <span>{summary.statusCounts.waiting} waiting</span>}
          {summary.statusCounts.blocked > 0 && (
            <span className="text-warning">{summary.statusCounts.blocked} blocked</span>
          )}
          {summary.statusCounts.errored > 0 && (
            <span className="text-danger">{summary.statusCounts.errored} errored</span>
          )}
        </div>
      </Card>
    </div>
  );
}

function ModelDistribution({ summary }: { summary: UsageSummary }) {
  if (summary.byModel.length === 0) return null;
  const max = Math.max(1, ...summary.byModel.map((m) => m.tokens));
  return (
    <Section title="By model">
      <div className="flex flex-col gap-2">
        {summary.byModel.map((m) => (
          <div key={m.model} className="flex items-center gap-3 text-xs">
            <span className="w-40 shrink-0 truncate font-mono text-muted" title={m.model}>
              {shortModel(m.model)}
            </span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-accent/70"
                style={{ width: `${Math.round((m.tokens / max) * 100)}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-muted">
              {formatTokens(m.tokens)}
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-subtle">
              {formatUSD(m.costUSD)}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SessionTable({
  list,
  onOpen,
}: {
  list: ReturnType<typeof sortSessionsByActivity>;
  onOpen: (id: string) => void;
}) {
  return (
    <Section title="By session">
      <div className="flex flex-col">
        {list.map((s) => {
          const ctx = contextUsage(s.metrics);
          const tokens = s.metrics.tokensInput + s.metrics.tokensOutput + s.metrics.tokensCached;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.id)}
              title={`${s.cwd}\nOpen session`}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-left text-xs hover:bg-surface/60"
            >
              <CliBadge cli={s.cli} />
              <StatusDot status={s.status} confidence={s.statusConfidence} />
              <span className="w-44 shrink-0 truncate text-sm text-ink" title={s.title ?? s.displayName}>
                {s.title ?? s.displayName}
              </span>
              <span className="w-28 shrink-0 truncate font-mono text-subtle" title={s.model ?? ''}>
                {s.model ? shortModel(s.model) : '—'}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                  {ctx && (
                    <div
                      className={cn('h-full rounded-full', ctx.pct >= 85 ? 'bg-warning' : 'bg-success/70')}
                      style={{ width: `${ctx.pct}%` }}
                    />
                  )}
                </div>
                <span className="w-9 shrink-0 text-right font-mono text-subtle">
                  {ctx ? `${ctx.pct}%` : '—'}
                </span>
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-muted">{formatTokens(tokens)}</span>
              <span className="w-14 shrink-0 text-right font-mono text-muted">
                {s.metrics.estimatedCostUSD != null ? formatUSD(s.metrics.estimatedCostUSD) : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge/10 bg-surface p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge/10 bg-surface p-4">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">{title}</div>
      {children}
    </div>
  );
}
