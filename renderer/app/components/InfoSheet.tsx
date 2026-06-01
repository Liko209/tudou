'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { tildify } from '../../lib/path-helpers';
import { timeAgo } from '../../lib/time-ago';
import { contextUsage, formatTokens } from '../../lib/context-usage';
import { StatusDot } from './StatusDot';
import { Button } from '../../components/ui/Button';
import type { Session } from '../../../shared/session-types';

interface InfoSheetProps {
  open: boolean;
  onClose: () => void;
  session: Session;
}

/**
 * Floating sheet that overlays the right edge of the main pane. Shows the
 * full session-info detail (was the M3 right-column SidePanel before the
 * P1 layout redesign moved it out of always-on view).
 */
export function InfoSheet({ open, onClose, session }: InfoSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const m = session.metrics;
  const usage = contextUsage(m);
  const homeDir = window.agentDashboard?.env.homedir() ?? null;

  return (
    <>
      <div
        className="absolute inset-0 z-20 bg-canvas/30"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute right-2 top-2 z-30 w-80 rounded-md border border-edge/10 bg-surface p-4 text-sm shadow-[0_8px_32px_rgb(0_0_0/0.4)]">
        <div className="mb-3 flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={session.status} confidence={session.statusConfidence} />
              <span className="truncate font-medium text-ink">{session.title || session.displayName}</span>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-muted" title={session.cwd}>
              {tildify(session.cwd, homeDir)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-canvas hover:text-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <Field label="cli" value={session.cli} />
        <Field label="branch" value={session.gitBranch ?? '—'} mono />
        <Field
          label="status"
          value={`${session.status}${session.statusConfidence === 'low' ? ' (polling)' : ''}`}
        />
        <Field label="started" value={`${timeAgo(session.startedAt)} ago`} />

        {usage && (
          <>
            <FieldLabel>Context window</FieldLabel>
            <div className="mt-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge/10">
                <div
                  className={
                    usage.pct >= 90
                      ? 'h-full rounded-full bg-danger'
                      : usage.pct >= 70
                        ? 'h-full rounded-full bg-warning'
                        : 'h-full rounded-full bg-success'
                  }
                  style={{ width: `${usage.pct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-xs text-muted">
                <span>
                  {formatTokens(usage.used)} / {formatTokens(usage.limit)} ({usage.pct}%)
                </span>
                <span>{formatTokens(usage.remaining)} free</span>
              </div>
            </div>
          </>
        )}

        <FieldLabel>Tokens</FieldLabel>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-xs">
          <dt className="text-muted">input</dt>
          <dd className="text-ink">{m.tokensInput.toLocaleString()}</dd>
          <dt className="text-muted">cached</dt>
          <dd className="text-ink">{m.tokensCached.toLocaleString()}</dd>
          <dt className="text-muted">output</dt>
          <dd className="text-ink">{m.tokensOutput.toLocaleString()}</dd>
          <dt className="text-muted">cost</dt>
          <dd className="text-ink">
            {m.estimatedCostUSD === null ? '—' : `$${m.estimatedCostUSD.toFixed(3)}`}
          </dd>
          <dt className="text-muted">msgs</dt>
          <dd className="text-ink">{m.messageCount}</dd>
        </dl>

        {session.currentTool && (
          <>
            <FieldLabel>Tool</FieldLabel>
            <div className="mt-1 rounded-md border border-edge/10 bg-sunken p-2 text-xs">
              <div className="font-medium text-ink">{session.currentTool.name}</div>
              {session.currentTool.description && (
                <div className="mt-0.5 truncate font-mono text-muted">
                  {session.currentTool.description}
                </div>
              )}
            </div>
          </>
        )}

        {session.latestMessage && (
          <>
            <FieldLabel>Latest ({session.latestMessage.role})</FieldLabel>
            <div className="mt-1 rounded-md border border-edge/10 bg-sunken p-2 text-xs text-ink/90">
              {session.latestMessage.preview}
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              void window.agentDashboard?.sessions.kill(session.id);
            }}
            disabled={session.status === 'exited' || session.status === 'errored'}
          >
            Kill
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void window.agentDashboard?.sessions.forget(session.id);
              onClose();
            }}
          >
            Close tab
          </Button>
        </div>
      </aside>
    </>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 text-[11px] uppercase tracking-wider text-subtle">{children}</div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11px] uppercase tracking-wider text-subtle">{label}</span>
      <span className={mono ? 'font-mono text-sm text-ink' : 'text-sm text-ink'}>{value}</span>
    </div>
  );
}
