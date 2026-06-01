'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';
import { resolveActiveTheme } from '../../lib/active-theme';
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
  const presetMode = useUIStore((s) => s.newSessionMode);
  const presetCwd = useUIStore((s) => s.newSessionCwd);

  const [cli, setCli] = useState<CliKind>('claude');
  const [tieToProject, setTieToProject] = useState(false);
  const [cwd, setCwd] = useState<string>('');
  const [resumable, setResumable] = useState<ResumableSession[] | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open. tieToProject defaults to ad-hoc chat (false) so
  // generic entry points (top "New chat" button, ⌘T) land on the chat
  // tab; sidebar "+ project" passes presetMode='project' to override.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setResumeId(null);
    // A project "+" button passes the exact project dir → prefill it and lock
    // to project mode. Otherwise keep prior cwd or fall back to home.
    if (presetCwd) {
      setCwd(presetCwd);
      setTieToProject(true);
    } else {
      setCwd((prev) => prev || (window.agentDashboard?.env.homedir() ?? ''));
      setTieToProject(presetMode === 'project');
    }
  }, [open, presetMode, presetCwd]);

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
        theme: resolveActiveTheme(),
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
          <div className="grid grid-cols-2 gap-1.5">
            {CLI_OPTIONS.map(({ kind, label, description }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setCli(kind)}
                className={cn(
                  'rounded-md border px-3 py-2 text-left transition-colors',
                  cli === kind
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-edge/10 bg-sunken hover:border-edge/30',
                )}
              >
                <div className="text-sm text-ink">{label}</div>
                <div className="mt-0.5 text-[11px] text-muted">{description}</div>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Scope">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setTieToProject(false)}
              className={cn(
                'rounded-md border px-3 py-2 text-left transition-colors',
                !tieToProject
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-edge/10 bg-sunken hover:border-edge/30',
              )}
            >
              <div className="text-sm text-ink">Chat</div>
              <div className="mt-0.5 text-[11px] text-muted">Ad-hoc, sandboxed dir</div>
            </button>
            <button
              type="button"
              onClick={() => setTieToProject(true)}
              className={cn(
                'rounded-md border px-3 py-2 text-left transition-colors',
                tieToProject
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-edge/10 bg-sunken hover:border-edge/30',
              )}
            >
              <div className="text-sm text-ink">Project</div>
              <div className="mt-0.5 text-[11px] text-muted">Pick a working dir</div>
            </button>
          </div>
          {tieToProject && (
            <div className="mt-2 flex gap-2">
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
