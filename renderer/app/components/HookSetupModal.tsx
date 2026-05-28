'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';

interface HookStatus {
  scriptInstalled: boolean;
  scriptPath: string;
  settingsPath: string;
  registeredEvents: string[];
  fullyInstalled: boolean;
}

const DISMISS_KEY = 'agent-dashboard.hook-prompt-dismissed';

/**
 * First-launch hook installer modal + ongoing settings dialog. Decides
 * whether to auto-open on mount based on:
 *   - installer status (do we need to install?)
 *   - localStorage flag (has the user told us to stop asking?)
 */
export function HookSetupModal() {
  const open = useUIStore((s) => s.hookModalOpen);
  const setOpen = useUIStore((s) => s.setHookModalOpen);

  const [status, setStatus] = useState<HookStatus | null>(null);
  const [manualSnippet, setManualSnippet] = useState<string | null>(null);
  const [mode, setMode] = useState<'overview' | 'manual' | 'installed'>('overview');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First-launch auto-open: only when not installed AND user hasn't told us no.
  useEffect(() => {
    const api = window.agentDashboard?.hooks;
    if (!api) return;
    void api.getStatus().then((s) => {
      setStatus(s);
      if (!s.fullyInstalled && localStorage.getItem(DISMISS_KEY) !== 'true') {
        setOpen(true);
      }
    });
  }, [setOpen]);

  // Refresh status + view mode whenever modal opens.
  useEffect(() => {
    if (!open) return;
    const api = window.agentDashboard?.hooks;
    if (!api) return;
    void api.getStatus().then((s) => {
      setStatus(s);
      setMode(s.fullyInstalled ? 'installed' : 'overview');
      setError(null);
    });
  }, [open]);

  const install = useCallback(async () => {
    const api = window.agentDashboard?.hooks;
    if (!api) return;
    setPending(true);
    setError(null);
    try {
      const next = await api.install();
      setStatus(next);
      setMode(next.fullyInstalled ? 'installed' : 'overview');
      // Once successfully installed, remove the "don't ask" flag in case
      // the user later uninstalls — we'll prompt again if needed.
      localStorage.removeItem(DISMISS_KEY);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, []);

  const uninstall = useCallback(async () => {
    const api = window.agentDashboard?.hooks;
    if (!api) return;
    const ok = window.confirm(
      'Remove the dashboard hook from ~/.claude/settings.json? Status will fall back to polling mode (~10s SLA instead of <3s).',
    );
    if (!ok) return;
    setPending(true);
    setError(null);
    try {
      const next = await api.uninstall();
      setStatus(next);
      setMode('overview');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, []);

  const openManual = useCallback(async () => {
    const api = window.agentDashboard?.hooks;
    if (!api) return;
    setManualSnippet(await api.getManualSnippet());
    setMode('manual');
  }, []);

  const notNow = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setOpen(false);
  }, [setOpen]);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Status notifications: enable Claude hook?"
      maxWidth="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Without a hook, the dashboard polls Claude's JSONL to guess when a
          session is waiting on you — about <span className="text-ink">10 s</span>
          {' '}latency. With a hook, Claude pushes the event directly:{' '}
          <span className="text-ink">&lt;3 s</span> and tagged as high-confidence.
        </p>

        {status && (
          <StatusBox
            label="Current hook state"
            value={
              status.fullyInstalled
                ? `Installed (${status.registeredEvents.join(', ')})`
                : status.registeredEvents.length > 0
                  ? `Partial (${status.registeredEvents.join(', ')})`
                  : 'Not installed (polling mode)'
            }
            tone={status.fullyInstalled ? 'good' : 'neutral'}
          />
        )}

        {error && (
          <div className="rounded-md bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
            {error}
          </div>
        )}

        {mode === 'manual' && status && manualSnippet && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted">
              Paste this into <span className="text-ink font-mono">{status.settingsPath}</span>{' '}
              (Claude reads it on next launch):
            </div>
            <pre className="max-h-48 overflow-auto rounded-md border border-edge/10 bg-sunken p-3 font-mono text-[11px] text-ink">
              {manualSnippet}
            </pre>
            <p className="text-xs text-muted">
              The hook script doesn't exist yet — Auto inject creates it at{' '}
              <span className="text-ink font-mono">{status.scriptPath}</span>. If you go
              manual, you'll also need to write that script yourself.
            </p>
          </div>
        )}

        {mode === 'installed' && (
          <div className="text-xs text-muted">
            The dashboard is receiving live Stop / UserPromptSubmit events. Sessions you
            spawn here will show high-confidence status dots.
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          {mode === 'manual' && (
            <Button size="md" variant="ghost" onClick={() => setMode('overview')}>
              Back
            </Button>
          )}

          {mode === 'overview' && (
            <>
              <Button size="md" variant="ghost" disabled={pending} onClick={notNow}>
                Not now
              </Button>
              <Button size="md" variant="ghost" disabled={pending} onClick={() => void openManual()}>
                Manual instructions
              </Button>
              <Button size="md" variant="primary" disabled={pending} onClick={() => void install()}>
                {pending ? 'Installing…' : 'Auto inject'}
              </Button>
            </>
          )}

          {mode === 'installed' && (
            <>
              <Button size="md" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button size="md" variant="danger" disabled={pending} onClick={() => void uninstall()}>
                {pending ? 'Removing…' : 'Uninstall'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StatusBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'neutral';
}) {
  return (
    <div className={cn('rounded-md border px-3 py-2 text-xs', tone === 'good' ? 'border-success/30 bg-success/5 text-ink' : 'border-edge/10 bg-sunken text-muted')}>
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-0.5 text-ink">{value}</div>
    </div>
  );
}
