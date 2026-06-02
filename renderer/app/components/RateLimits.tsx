'use client';

import { useCallback, useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import type { RateLimits, RateLimitWindow } from '../../../shared/usage-types';
import { cn } from '../../lib/utils';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

// Show the consent prompt at most once; declining or enabling both set it.
const PROMPT_KEY = 'agent-dashboard.rateLimitPrompted';
function alreadyPrompted(): boolean {
  return typeof window !== 'undefined' && window.localStorage?.getItem(PROMPT_KEY) === '1';
}
function markPrompted(): void {
  if (typeof window !== 'undefined') window.localStorage?.setItem(PROMPT_KEY, '1');
}

interface State {
  loading: boolean;
  enabled: boolean;
  data: RateLimits | null;
}

function countdown(resetsAt: number): string {
  if (!resetsAt) return '';
  const secs = resetsAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return 'resetting…';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-danger';
  if (pct >= 70) return 'bg-warning';
  return 'bg-success/70';
}

function Gauge2({ label, win }: { label: string; win: RateLimitWindow | undefined }) {
  if (!win) return null;
  return (
    <div className="rounded-md bg-sunken p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">{label}</span>
        <span className="font-mono text-sm font-semibold text-ink">{Math.round(win.usedPercentage)}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
        <div className={cn('h-full rounded-full', barColor(win.usedPercentage))} style={{ width: `${win.usedPercentage}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-subtle">{countdown(win.resetsAt)}</div>
    </div>
  );
}

/**
 * Claude rate-limit gauges (5-hour / weekly), captured via an opt-in statusLine
 * wrapper that preserves any existing statusLine command. Off by default —
 * shows an enable CTA until the user turns it on.
 */
export function RateLimitsSection() {
  const [state, setState] = useState<State>({ loading: true, enabled: false, data: null });
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  const refresh = useCallback(() => {
    const api = window.agentDashboard?.usage;
    if (!api?.getRateLimits) {
      setState({ loading: false, enabled: false, data: null });
      return;
    }
    api
      .getRateLimits()
      .then((r) => {
        setState({ loading: false, enabled: r.status.enabled, data: r.data });
        // First time the Usage view is opened and tracking is off → ask once.
        if (!r.status.enabled && !alreadyPrompted()) setConsent(true);
      })
      .catch(() => setState({ loading: false, enabled: false, data: null }));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const toggle = (enable: boolean): void => {
    markPrompted();
    setConsent(false);
    const api = window.agentDashboard?.usage;
    if (!api?.toggleRateLimits) return;
    setBusy(true);
    api
      .toggleRateLimits(enable)
      .then((r) => setState({ loading: false, enabled: r.status.enabled, data: r.data }))
      .finally(() => setBusy(false));
  };

  const declineConsent = (): void => {
    markPrompted();
    setConsent(false);
  };

  return (
    <>
    <div className="rounded-lg border border-edge/10 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">
          <Gauge className="h-3.5 w-3.5" strokeWidth={1.75} />
          Rate limits · Claude
        </div>
        {state.enabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => toggle(false)}
            className="text-[11px] text-subtle hover:text-ink disabled:opacity-50"
          >
            Disable
          </button>
        )}
      </div>

      {state.loading ? (
        <div className="text-xs text-subtle">Checking…</div>
      ) : !state.enabled ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted">
            Track your Claude 5-hour and weekly limits here. This adds a Tudou statusLine wrapper that
            captures the quota and still runs your existing status line unchanged.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => toggle(true)}
            className="rounded-md bg-accent/15 px-2.5 py-1 text-xs font-medium text-ink hover:bg-accent/25 disabled:opacity-50"
          >
            {busy ? 'Enabling…' : 'Enable rate-limit tracking'}
          </button>
        </div>
      ) : !state.data ? (
        <div className="text-xs text-muted">Enabled — waiting for the next Claude turn to report usage.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Gauge2 label="5-hour" win={state.data.fiveHour} />
          <Gauge2 label="Weekly" win={state.data.sevenDay} />
        </div>
      )}
    </div>
    <ConfirmDialog
      open={consent}
      title="Track Claude rate limits?"
      description="Tudou can show your 5-hour and weekly limits by adding a statusLine wrapper to ~/.claude/settings.json. It preserves your existing status line (ccstatusline runs unchanged) and applies to every Claude session on this machine. Reversible anytime via Disable."
      confirmLabel="Enable"
      cancelLabel="Not now"
      onConfirm={() => toggle(true)}
      onCancel={declineConsent}
    />
    </>
  );
}
