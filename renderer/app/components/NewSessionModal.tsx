'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';
import { useUIStore } from '../../lib/stores/ui-store';
import type { CliKind } from '../../../shared/ipc-contracts';
import type { ResumableSession } from '../../../shared/session-types';

const CLI_OPTIONS: { kind: CliKind; label: string; description: string }[] = [
  { kind: 'claude', label: 'Claude Code', description: 'Anthropic, file-aware' },
  { kind: 'codex', label: 'Codex', description: 'OpenAI, GPT-5' },
];

export function NewSessionModal() {
  const open = useUIStore((s) => s.newSessionOpen);
  const setOpen = useUIStore((s) => s.setNewSessionOpen);

  const [cli, setCli] = useState<CliKind>('claude');
  const [tieToProject, setTieToProject] = useState(false);
  const [cwd, setCwd] = useState<string>('');
  const [resumable, setResumable] = useState<ResumableSession[] | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setError(null);
    setResumeId(null);
    setCwd((prev) => prev || (window.agentDashboard?.env.homedir() ?? ''));
  }, [open]);

  // Resumable list only meaningful for project mode (chats use ad-hoc dirs)
  useEffect(() => {
    if (!open || !tieToProject || !cwd) {
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
  }, [open, tieToProject, cli, cwd]);

  const browse = useCallback(async () => {
    const picked = await window.agentDashboard?.sessions.pickDirectory({
      defaultPath: cwd || undefined,
    });
    if (picked) {
      setCwd(picked);
      setTieToProject(true);
    }
  }, [cwd]);

  const submit = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await window.agentDashboard?.sessions.spawn({
        cli,
        cols: 120,
        rows: 32,
        ...(tieToProject ? { cwd } : { chat: true }),
        spawnArgs: resumeId ? { resume: resumeId } : undefined,
      });
      setOpen(false);
      setResumeId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, [cli, tieToProject, cwd, resumeId, setOpen]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="New chat">
      <div className="flex flex-col gap-5">
        <Field label="Agent">
          <select
            value={cli}
            onChange={(e) => setCli(e.target.value as CliKind)}
            className="w-full rounded-md border border-edge/10 bg-sunken px-2 py-1.5 text-sm text-ink focus:border-accent/60 focus:outline-none"
          >
            {CLI_OPTIONS.map(({ kind, label, description }) => (
              <option key={kind} value={kind}>
                {label} — {description}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Working directory">
          <label className="mb-2 flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={tieToProject}
              onChange={(e) => setTieToProject(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span className="text-muted">
              <span className="text-ink">Tie to a project</span> — pick a working
              directory so this session shows up under <span className="text-ink">Projects</span>.
              Otherwise it lives in <span className="text-ink">Chats</span> with a
              sandboxed scratch dir.
            </span>
          </label>
          {tieToProject && (
            <div className="flex gap-2">
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 rounded-md border border-edge/10 bg-sunken px-2 py-1.5 font-mono text-xs text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
              />
              <Button size="md" variant="default" onClick={() => void browse()}>
                Browse…
              </Button>
            </div>
          )}
        </Field>

        {tieToProject && resumable && resumable.length > 0 && (
          <Field label="Resume an existing session?">
            <ul className="max-h-44 overflow-y-auto rounded-md border border-edge/10 bg-sunken">
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
          </Field>
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
            disabled={pending || (tieToProject && !cwd)}
          >
            {pending ? 'Starting…' : resumeId ? 'Resume' : 'Start'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      {children}
    </div>
  );
}
