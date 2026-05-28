'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import type { CliKind } from '../../../shared/ipc-contracts';
import type { ResumableSession } from '../../../shared/session-types';

const CLI_OPTIONS: { kind: CliKind; label: string }[] = [
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'codex', label: 'Codex' },
];

export function NewSessionModal() {
  const open = useUIStore((s) => s.newSessionOpen);
  const setOpen = useUIStore((s) => s.setNewSessionOpen);

  const [cli, setCli] = useState<CliKind>('claude');
  const [cwd, setCwd] = useState<string>('');
  const [resumable, setResumable] = useState<ResumableSession[] | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed cwd to home on first open.
  useEffect(() => {
    if (!open) return;
    setCwd((prev) => prev || (window.agentDashboard?.env.homedir() ?? ''));
    setError(null);
  }, [open]);

  // Refresh resumable list whenever cli or cwd changes.
  useEffect(() => {
    if (!open || !cwd) {
      setResumable(null);
      return;
    }
    setResumable(null);
    setResumeId(null);
    const api = window.agentDashboard?.sessions;
    if (!api) return;
    let cancelled = false;
    void api
      .listResumable(cli, cwd)
      .then((list) => {
        if (!cancelled) setResumable(list);
      })
      .catch(() => {
        if (!cancelled) setResumable([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, cli, cwd]);

  const browse = useCallback(async () => {
    const picked = await window.agentDashboard?.sessions.pickDirectory({
      defaultPath: cwd || undefined,
    });
    if (picked) setCwd(picked);
  }, [cwd]);

  const submit = useCallback(async () => {
    if (!cwd) return;
    setPending(true);
    setError(null);
    try {
      await window.agentDashboard?.sessions.spawn({
        cli,
        cwd,
        cols: 120,
        rows: 32,
        spawnArgs: resumeId ? { resume: resumeId } : undefined,
      });
      setOpen(false);
      setResumeId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, [cli, cwd, resumeId, setOpen]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="New Session">
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>CLI</FieldLabel>
          <div className="mt-1 flex gap-2">
            {CLI_OPTIONS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setCli(kind)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
                  cli === kind
                    ? 'border-accent bg-accent/10 text-ink'
                    : 'border-edge/10 text-muted hover:border-edge/30',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>Working directory</FieldLabel>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/project"
              className="flex-1 rounded-md border border-edge/10 bg-sunken px-2 py-1.5 text-xs font-mono text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
            />
            <Button size="md" variant="default" onClick={() => void browse()}>
              Browse…
            </Button>
          </div>
        </div>

        {resumable && resumable.length > 0 && (
          <div>
            <FieldLabel>Resume an existing session?</FieldLabel>
            <ul className="mt-1 max-h-44 overflow-y-auto rounded-md border border-edge/10 bg-sunken">
              <li>
                <button
                  type="button"
                  onClick={() => setResumeId(null)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-xs hover:bg-surface',
                    resumeId === null && 'bg-surface',
                  )}
                >
                  <span className="text-ink">Start fresh</span>
                </button>
              </li>
              {resumable.slice(0, 30).map((r) => (
                <li key={r.cliSessionId} className="border-t border-edge/5">
                  <button
                    type="button"
                    onClick={() => setResumeId(r.cliSessionId)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs hover:bg-surface',
                      resumeId === r.cliSessionId && 'bg-surface',
                    )}
                  >
                    <div className="truncate text-ink">
                      {r.summary || r.firstPrompt || '(no preview)'}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted">
                      {r.cliSessionId.slice(0, 8)} ·{' '}
                      {r.modified ? new Date(r.modified).toLocaleString() : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
            {error}
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button size="md" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="md"
            variant="primary"
            onClick={() => void submit()}
            disabled={pending || !cwd}
          >
            {pending ? 'Starting…' : resumeId ? 'Resume' : 'Start'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-subtle">{children}</div>;
}
