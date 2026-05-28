'use client';

import { useEffect, useMemo, useState } from 'react';
import { basename } from '../../lib/path-helpers';
import { cn } from '../../lib/utils';
import { timeAgo } from '../../lib/time-ago';
import {
  partitionSessions,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import { useUIStore } from '../../lib/stores/ui-store';
import { Button } from '../../components/ui/Button';
import { StatusDot } from './StatusDot';
import type { Session } from '../../../shared/session-types';

const CLI_LABEL: Record<'claude' | 'codex', string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export function Sidebar() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  const setNewSessionOpen = useUIStore((s) => s.setNewSessionOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const [chatsBaseDir, setChatsBaseDir] = useState('');
  const [query, setQuery] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    setChatsBaseDir(window.agentDashboard?.env.chatsBaseDir() ?? '');
  }, []);

  const { projects, chats } = useMemo(
    () => partitionSessions(sessions, chatsBaseDir),
    [sessions, chatsBaseDir],
  );

  const q = query.trim().toLowerCase();
  const matches = (s: Session): boolean => {
    if (!q) return true;
    return (
      s.displayName.toLowerCase().includes(q) ||
      s.cwd.toLowerCase().includes(q) ||
      (s.latestMessage?.preview.toLowerCase().includes(q) ?? false)
    );
  };

  const visibleProjects = projects
    .map((g) => ({ ...g, items: g.items.filter(matches) }))
    .filter((g) => g.items.length > 0);
  const visibleChats = chats.filter(matches);

  const toggleProject = (cwd: string): void => {
    setCollapsedProjects((cur) => {
      const next = new Set(cur);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  };

  const killAndForget = async (id: string): Promise<void> => {
    const api = window.agentDashboard?.sessions;
    if (!api) return;
    const s = sessions[id];
    if (!s) return;
    const isLive = s.status !== 'exited' && s.status !== 'errored';
    if (isLive) {
      const ok = window.confirm(`Close session "${s.displayName}"?`);
      if (!ok) return;
      await api.kill(id);
    }
    await api.forget(id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-2 pt-3">
        <Button
          size="md"
          variant="primary"
          className="w-full justify-start"
          onClick={() => setNewSessionOpen(true)}
        >
          + New chat
        </Button>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="h-8 rounded-md border border-edge/10 bg-sunken px-2 text-xs text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-1">
        {visibleProjects.length > 0 && (
          <SectionLabel>Projects</SectionLabel>
        )}
        {visibleProjects.map((group) => {
          const collapsed = collapsedProjects.has(group.cwd);
          return (
            <div key={group.cwd} className="mb-1">
              <button
                type="button"
                onClick={() => toggleProject(group.cwd)}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs text-muted hover:bg-surface"
                title={group.cwd}
              >
                <span className="text-[9px] text-subtle">{collapsed ? '▶' : '▼'}</span>
                <span className="truncate text-ink">{basename(group.cwd)}</span>
                <span className="ml-auto text-subtle">{group.items.length}</span>
              </button>
              {!collapsed &&
                group.items.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    isActive={s.id === activeId}
                    indent
                    onSelect={() => setActive(s.id)}
                    onClose={() => void killAndForget(s.id)}
                  />
                ))}
            </div>
          );
        })}

        {visibleChats.length > 0 && <SectionLabel>Chats</SectionLabel>}
        {visibleChats.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            isActive={s.id === activeId}
            onSelect={() => setActive(s.id)}
            onClose={() => void killAndForget(s.id)}
          />
        ))}

        {visibleProjects.length === 0 && visibleChats.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted">
            {q ? 'No matches.' : (
              <>No sessions yet.<br />Hit <kbd className="font-mono text-ink">⌘T</kbd> to start one.</>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-edge/5 p-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface"
        >
          <span>⚙</span>
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wider text-subtle">
      {children}
    </div>
  );
}

interface SessionRowProps {
  session: Session;
  isActive: boolean;
  indent?: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function SessionRow({ session, isActive, indent, onSelect, onClose }: SessionRowProps) {
  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-md py-1.5 pr-1 text-xs',
        indent ? 'pl-6' : 'pl-2',
        'hover:bg-surface',
        isActive && 'bg-surface ring-1 ring-accent/40',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 items-center gap-2 truncate text-left"
        title={session.cwd}
      >
        <StatusDot status={session.status} confidence={session.statusConfidence} />
        <span className="text-[9px] uppercase text-subtle">{CLI_LABEL[session.cli]}</span>
        <span className="truncate text-ink">{stripLeadingCli(session.displayName)}</span>
      </button>
      <span
        className="shrink-0 font-mono text-[10px] text-subtle group-hover:hidden"
        title={new Date(session.lastActivityAt).toLocaleString()}
      >
        {timeAgo(session.lastActivityAt)}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-danger group-hover:flex"
        title="Close session"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Sidebar already shows the CLI badge separately, so trim the "Claude · "
 * / "Codex · " prefix that autoName puts on Chat-kind sessions to avoid
 * a redundant label.
 */
function stripLeadingCli(name: string): string {
  return name.replace(/^(Claude|Codex)\s·\s/, '');
}
