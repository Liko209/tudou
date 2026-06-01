'use client';

import { type ReactNode } from 'react';
import { selectActiveSession, useSessionsStore } from '../../lib/stores/sessions-store';
import { contextUsage, formatTokens, type ContextUsage } from '../../lib/context-usage';
import { useCountUp } from '../../lib/hooks/use-count-up';
import { cn } from '../../lib/utils';

/**
 * Thin always-on status bar pinned to the bottom of the main pane (VSCode /
 * ccstatusline style). Surfaces the active session's model, token counts,
 * running cost and context-window usage.
 *
 * Numbers roll via CountUp — which also makes the otherwise-jarring climb
 * during a session resume (the adapter replays the whole transcript and the
 * cumulative token totals tick up from 0) read as a smooth animation.
 */
export function StatusBar() {
  const active = useSessionsStore(selectActiveSession);
  const m = active?.metrics;
  const usage = contextUsage(m);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-edge/10 bg-sunken px-3 font-mono text-[11px] text-subtle">
      {active && m ? (
        <>
          <span className="shrink-0 text-muted" title={active.model ?? active.cli}>
            {prettyModel(active.model) ?? active.cli.toUpperCase()}
          </span>
          <Sep />
          <span className="shrink-0" title="Tokens in / out">
            <span className="text-muted">↑</span>{' '}
            <Count value={m.tokensInput} format={formatTokens} />{' '}
            <span className="text-muted">↓</span>{' '}
            <Count value={m.tokensOutput} format={formatTokens} />
          </span>
          <span className="shrink-0" title="Cached input tokens">
            cache <Count value={m.tokensCached} format={formatTokens} />
          </span>
          <Sep />
          <span className="shrink-0" title="Estimated cost (USD)">
            {m.estimatedCostUSD == null ? (
              '—'
            ) : (
              <Count value={m.estimatedCostUSD} format={formatCost} />
            )}
          </span>
          {usage && (
            <>
              <Sep />
              <ContextBar usage={usage} />
            </>
          )}
          <span
            className="ml-auto shrink-0 truncate text-subtle"
            title={`${m.messageCount} messages`}
          >
            <Count value={m.messageCount} /> msg{m.messageCount === 1 ? '' : 's'}
          </span>
        </>
      ) : (
        <span className="text-subtle">No active session</span>
      )}
    </footer>
  );
}

/** Rolling number — animates toward `value` (see useCountUp). */
function Count({ value, format }: { value: number; format?: (n: number) => string }) {
  const display = useCountUp(value);
  return <>{format ? format(display) : String(Math.round(display))}</>;
}

function formatCost(v: number): string {
  return `$${v.toFixed(v >= 1 ? 2 : 3)}`;
}

function Sep(): ReactNode {
  return <span className="shrink-0 text-edge/30">·</span>;
}

/**
 * Context-window progress bar. Fill = used / window (same metric ccstatusline
 * uses: input + cache_creation + cache_read). Greens → ambers at 70% → reds
 * at 90%, near the point Claude auto-compacts.
 */
function ContextBar({ usage }: { usage: ContextUsage }) {
  const { pct, used, limit, remaining } = usage;
  const fill = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-success';
  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      title={`Context ${pct}% used · ${formatTokens(used)} / ${formatTokens(limit)} · ${formatTokens(remaining)} free`}
    >
      <span className="text-muted">ctx</span>
      <div className="h-2 w-16 overflow-hidden rounded-full bg-edge/10">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-out', fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums">
        <Count value={pct} />%
      </span>
      <span className="text-subtle">
        {formatTokens(used)}/{formatTokens(limit)}
      </span>
    </div>
  );
}

/**
 * Trim a raw model id to something readable: drop the provider prefix and
 * trailing release date. `claude-sonnet-4-5-20250929` → `sonnet-4-5`.
 */
function prettyModel(model: string | null | undefined): string | null {
  if (!model) return null;
  return model.replace(/-\d{8}$/, '').replace(/^claude-/, '') || model;
}
