'use client';

import { useMemo, useState } from 'react';
import { FolderPlus, Settings as SettingsIcon, SquarePen } from 'lucide-react';
import { useSessionsStore } from '../../lib/stores/sessions-store';
import { useUIStore } from '../../lib/stores/ui-store';
import { resolveActiveTheme } from '../../lib/active-theme';
import { basename } from '../../lib/path-helpers';
import { timeAgo } from '../../lib/time-ago';
import { cn } from '../../lib/utils';
import type { PreviousSession } from '../../../shared/session-types';
import { Terminal } from './Terminal';

/**
 * Renders one persistent <Terminal> per session and toggles visibility via
 * display:none so the offscreen sessions keep accumulating PTY output
 * (preserving scrollback when the user tabs away and back).
 *
 * The duplicate "session info strip" that used to live above the terminal
 * was removed — SessionHeader already shows status/name/cwd and a second
 * surface there just added visual noise.
 */
export function CenterPane() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  // Panel-only sessions render exclusively inside their dock panel —
  // skip them here so we don't carry a hidden duplicate xterm in main.
  const ids = useMemo(
    () => Object.keys(sessions).filter((id) => !sessions[id]?.panelOnly),
    [sessions],
  );

  if (ids.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full bg-canvas">
      {ids.map((id) => (
        <div
          key={id}
          className="absolute inset-0"
          style={{ display: id === activeId ? 'block' : 'none' }}
        >
          <Terminal sessionId={id} />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const openNewSession = useUIStore((s) => s.openNewSession);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const previous = useSessionsStore((s) => s.previous);
  const setActive = useSessionsStore((s) => s.setActive);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Most-recent resumable dormant sessions, capped so the landing
  // page doesn't double as the full history — that's the sidebar's
  // job. 6 cards = 2 rows of 3 at typical sidebar-open widths.
  const recent = useMemo(
    () =>
      previous
        .filter((p) => p.resumable && p.cliSessionId)
        .slice(0, 6),
    [previous],
  );

  const handleResume = async (p: PreviousSession): Promise<void> => {
    if (!p.cliSessionId) return;
    const api = window.agentDashboard?.sessions;
    if (!api) return;
    setPendingId(p.id);
    try {
      const spawned = await api.spawn({
        cli: p.cli,
        cwd: p.cwd,
        cols: 120,
        rows: 32,
        theme: resolveActiveTheme(),
        spawnArgs: { resume: p.cliSessionId },
      });
      setActive(spawned.id);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-canvas px-8 py-12">
      <div className="flex w-full max-w-3xl flex-col gap-10">
        <div className="text-center">
          <h1 className="text-2xl font-medium text-ink">Tudou</h1>
          <p className="mt-2 text-sm text-muted">
            Pick up where you left off, or start something new.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <ActionCard
            icon={FolderPlus}
            label="New project session"
            description="Spawn a CLI in a project directory."
            onClick={() => openNewSession('project')}
          />
          <ActionCard
            icon={SquarePen}
            label="New chat"
            description="Ad-hoc session, no project tie."
            onClick={() => openNewSession('chat')}
          />
          <ActionCard
            icon={SettingsIcon}
            label="Settings"
            description="Notifications, paths, theme."
            onClick={() => setSettingsOpen(true)}
          />
        </div>

        {recent.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-subtle">
              Recent
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {recent.map((p) => (
                <RecentCard
                  key={p.id}
                  item={p}
                  pending={pendingId === p.id}
                  onClick={() => void handleResume(p)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-xs text-subtle">
          Press{' '}
          <Kbd>⌘T</Kbd> for a new session ·{' '}
          <Kbd>⌘\</Kbd> to toggle sidebar
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: typeof FolderPlus;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1.5 rounded-lg border border-edge/10 bg-surface p-4 text-left',
        'transition-colors hover:border-accent/40 hover:bg-surface/80',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
      )}
    >
      <Icon className="h-5 w-5 text-muted" strokeWidth={1.75} />
      <div className="text-sm font-medium text-ink">{label}</div>
      <div className="text-xs text-muted">{description}</div>
    </button>
  );
}

function RecentCard({
  item,
  pending,
  onClick,
}: {
  item: PreviousSession;
  pending: boolean;
  onClick: () => void;
}) {
  const cliLabel = item.cli === 'claude' ? 'CL' : 'CX';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={item.cwd}
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-edge/10 bg-surface p-3 text-left',
        'transition-colors hover:border-accent/40 hover:bg-surface/80',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[10px] tracking-wider text-subtle">
          {cliLabel}
        </span>
        <span className="truncate text-sm text-ink">
          {item.title || stripLeadingCli(item.displayName)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-mono text-muted">{basename(item.cwd)}</span>
        <span className={cn('shrink-0 text-subtle', pending && 'italic text-muted')}>
          {pending ? 'Resuming…' : timeAgo(item.startedAt)}
        </span>
      </div>
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-edge/10 bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

function stripLeadingCli(name: string): string {
  return name.replace(/^(Claude|Codex)\s·\s/, '');
}
