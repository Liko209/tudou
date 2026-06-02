'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Minimize2,
  FolderPlus,
  Pencil,
  BarChart3,
  Plus,
  Search,
  Settings,
  SquarePen,
  X,
  type LucideIcon,
} from 'lucide-react';
import { basename } from '../../lib/path-helpers';
import { cn } from '../../lib/utils';
import { timeAgo } from '../../lib/time-ago';
import {
  buildSidebarItems,
  type SidebarItem,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import { useUIStore } from '../../lib/stores/ui-store';
import { resolveActiveTheme } from '../../lib/active-theme';
import { StatusDot } from './StatusDot';
import { CliBadge } from './CliBadge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

export function Sidebar() {
  const sessions = useSessionsStore((s) => s.sessions);
  const previous = useSessionsStore((s) => s.previous);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  const removePrevious = useSessionsStore((s) => s.removePrevious);
  const renamePrevious = useSessionsStore((s) => s.renamePrevious);
  const openNewSession = useUIStore((s) => s.openNewSession);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const usageOpen = useUIStore((s) => s.usageOpen);
  const setUsageOpen = useUIStore((s) => s.setUsageOpen);
  const sectionsCollapsed = useUIStore((s) => s.sectionsCollapsed);
  const toggleSectionCollapsed = useUIStore((s) => s.toggleSectionCollapsed);

  const [chatsBaseDir, setChatsBaseDir] = useState('');
  const [query, setQuery] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [confirmKillItem, setConfirmKillItem] = useState<SidebarItem | null>(null);
  const [pendingResumeKey, setPendingResumeKey] = useState<string | null>(null);

  useEffect(() => {
    setChatsBaseDir(window.agentDashboard?.env.chatsBaseDir() ?? '');
  }, []);

  const { projects, chats } = useMemo(
    () => buildSidebarItems(sessions, previous, chatsBaseDir),
    [sessions, previous, chatsBaseDir],
  );

  const q = query.trim().toLowerCase();
  const matches = (it: SidebarItem): boolean => {
    if (!q) return true;
    return (
      it.displayName.toLowerCase().includes(q) ||
      it.cwd.toLowerCase().includes(q) ||
      (it.live?.latestMessage?.preview.toLowerCase().includes(q) ?? false)
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

  const collapseAllProjects = (): void => {
    setCollapsedProjects(new Set(visibleProjects.map((g) => g.cwd)));
  };

  const handleSelect = async (it: SidebarItem): Promise<void> => {
    setUsageOpen(false); // selecting a session leaves the Usage / Settings overlay
    setSettingsOpen(false);
    if (it.isLive && it.live) {
      setActive(it.live.id);
      return;
    }
    if (!it.dormant || !it.dormant.resumable || !it.dormant.cliSessionId) return;
    const api = window.agentDashboard?.sessions;
    if (!api) return;
    setPendingResumeKey(it.key);
    try {
      const spawned = await api.spawn({
        cli: it.dormant.cli,
        cwd: it.dormant.cwd,
        cols: 120,
        rows: 32,
        theme: resolveActiveTheme(),
        spawnArgs: { resume: it.dormant.cliSessionId },
      });
      // onAdd handler will setActive; do it explicitly here too in case
      // the event lost the race against the rendered snapshot.
      setActive(spawned.id);
    } finally {
      setPendingResumeKey(null);
    }
  };

  const handleRename = async (it: SidebarItem, title: string): Promise<void> => {
    const api = window.agentDashboard?.sessions;
    const id = it.isLive ? it.live?.id : it.dormant?.id;
    if (!api || !id) return;
    await api.rename(id, title);
    // Live sessions get an `update` push that refreshes the store; dormant
    // ones only touch the persistence file, so patch the store directly.
    if (!it.isLive && it.dormant) {
      renamePrevious(it.dormant.id, title.trim() || null);
    }
  };

  const requestClose = (it: SidebarItem): void => {
    if (!it.isLive) {
      // Dormant: just drop the persistence record.
      if (it.dormant) {
        void window.agentDashboard?.sessions.dismissPrevious(it.dormant.id);
        removePrevious(it.dormant.id);
      }
      return;
    }
    if (!it.live) return;
    const isRunning = it.live.status !== 'exited' && it.live.status !== 'errored';
    if (isRunning) {
      setConfirmKillItem(it);
    } else {
      // Already-exited tabs go straight to dormant — no confirm needed.
      void window.agentDashboard?.sessions.release(it.live.id);
    }
  };

  const confirmCloseLive = async (): Promise<void> => {
    const it = confirmKillItem;
    setConfirmKillItem(null);
    if (!it || !it.live) return;
    const api = window.agentDashboard?.sessions;
    if (!api) return;
    await api.kill(it.live.id);
    await api.release(it.live.id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Drag region that sits under macOS traffic lights. With
          titleBarStyle=hiddenInset the lights overlay the sidebar's
          top-left; this 48px band matches the session header height and
          centers the 12px lights (18 + 12 + 18 = 48, via
          BrowserWindow.trafficLightPosition in main) so the lights, the
          header buttons and the title all sit on one line. */}
      <div className="titlebar-drag h-12 shrink-0" />
      <div className="flex flex-col gap-2 px-2.5 pb-2 pt-1 titlebar-no-drag">
        <button
          type="button"
          onClick={() => openNewSession()}
          className={cn(
            'flex h-9 items-center gap-2 rounded-md border border-edge/10 bg-surface px-3',
            'text-sm text-ink hover:border-accent/50 hover:bg-surface/80',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40',
          )}
        >
          <Plus className="h-4 w-4 text-muted" strokeWidth={2} />
          <span>New chat</span>
        </button>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-9 w-full rounded-md border border-transparent bg-sunken pl-8 pr-2.5 text-sm text-ink placeholder:text-subtle focus:border-accent/40 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-1">
        <SectionHeader
          label="Projects"
          collapsed={sectionsCollapsed.projects}
          onToggle={() => toggleSectionCollapsed('projects')}
          actions={
            <>
              {visibleProjects.length > 0 && (
                <HeaderAction
                  icon={Minimize2}
                  label="Collapse all projects"
                  onClick={collapseAllProjects}
                />
              )}
              <HeaderAction
                icon={FolderPlus}
                label="New project session"
                onClick={() => openNewSession('project')}
              />
            </>
          }
        />
        {!sectionsCollapsed.projects && (
          <div>
            {visibleProjects.length === 0 ? (
              <SectionEmpty>{q ? 'No matches.' : 'No project sessions yet.'}</SectionEmpty>
            ) : (
              visibleProjects.map((group) => {
                const collapsed = collapsedProjects.has(group.cwd);
                return (
                  <div key={group.cwd} className="group/proj mb-1">
                    <div className="flex items-center rounded pr-1 hover:bg-surface/60">
                      <button
                        type="button"
                        onClick={() => toggleProject(group.cwd)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm text-muted"
                        title={group.cwd}
                      >
                        {collapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle" strokeWidth={2} />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" strokeWidth={2} />
                        )}
                        <span className="truncate text-ink">{basename(group.cwd)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openNewSession('project', group.cwd);
                        }}
                        aria-label={`New session in ${basename(group.cwd)}`}
                        title="New session in this project"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle opacity-0 hover:bg-canvas hover:text-ink group-hover/proj:opacity-100"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      <span className="shrink-0 px-1 text-xs text-subtle">{group.items.length}</span>
                    </div>
                    {!collapsed &&
                      group.items.map((it) => (
                        <SessionRow
                          key={it.key}
                          item={it}
                          isActive={it.live?.id === activeId}
                          isResuming={pendingResumeKey === it.key}
                          indent
                          onSelect={() => void handleSelect(it)}
                          onClose={() => requestClose(it)}
                          onRename={(title) => void handleRename(it, title)}
                        />
                      ))}
                  </div>
                );
              })
            )}
          </div>
        )}

        <SectionHeader
          label="Chats"
          collapsed={sectionsCollapsed.chats}
          onToggle={() => toggleSectionCollapsed('chats')}
          actions={
            <HeaderAction
              icon={SquarePen}
              label="New chat"
              onClick={() => openNewSession('chat')}
            />
          }
        />
        {!sectionsCollapsed.chats && (
          <div>
            {visibleChats.length === 0 ? (
              <SectionEmpty>{q ? 'No matches.' : 'No chats yet.'}</SectionEmpty>
            ) : (
              visibleChats.map((it) => (
                <SessionRow
                  key={it.key}
                  item={it}
                  isActive={it.live?.id === activeId}
                  isResuming={pendingResumeKey === it.key}
                  onSelect={() => void handleSelect(it)}
                  onClose={() => requestClose(it)}
                  onRename={(title) => void handleRename(it, title)}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div className="border-t border-edge/5 p-2">
        <button
          type="button"
          onClick={() => setUsageOpen(!usageOpen)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface/60 hover:text-ink',
            usageOpen ? 'bg-accent/10 text-ink' : 'text-muted',
          )}
        >
          <BarChart3 className="h-4 w-4" strokeWidth={1.75} />
          <span>Usage</span>
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface/60 hover:text-ink',
            settingsOpen ? 'bg-accent/10 text-ink' : 'text-muted',
          )}
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
          <span>Settings</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmKillItem !== null}
        title={`Close ${confirmKillItem?.displayName ?? 'session'}?`}
        description={`The ${confirmKillItem?.cli} process will be terminated. The session stays resumable from this list.`}
        confirmLabel="Close session"
        destructive
        onConfirm={() => void confirmCloseLive()}
        onCancel={() => setConfirmKillItem(null)}
      />
    </div>
  );
}

interface SectionHeaderProps {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}

function SectionHeader({ label, collapsed, onToggle, actions }: SectionHeaderProps) {
  return (
    <div className="group/section flex items-center gap-1 px-3 pb-1 pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-1 text-left text-[11px] font-medium uppercase tracking-wider text-subtle hover:text-muted"
      >
        <span>{label}</span>
        {collapsed ? (
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
        ) : (
          <ChevronDown
            className="h-3 w-3 opacity-0 transition-opacity group-hover/section:opacity-100"
            strokeWidth={2}
          />
        )}
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100">
        {actions}
      </div>
    </div>
  );
}

function HeaderAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="flex h-5 w-5 items-center justify-center rounded text-subtle hover:bg-surface/80 hover:text-ink"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

function SectionEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-2 text-xs text-subtle">{children}</div>
  );
}

interface SessionRowProps {
  item: SidebarItem;
  isActive: boolean;
  isResuming: boolean;
  indent?: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}

function SessionRow({ item, isActive, isResuming, indent, onSelect, onClose, onRename }: SessionRowProps) {
  const dormantNotResumable = !item.isLive && !(item.dormant?.resumable ?? false);
  const dim = !item.isLive;
  const label = item.title || stripLeadingCli(item.displayName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEditing = (): void => {
    setDraft(item.title ?? stripLeadingCli(item.displayName));
    setEditing(true);
  };

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (item.title ?? '')) onRename(next);
  };
  return (
    <div
      className={cn(
        // h-9 explicit so the row height never depends on whether the
        // close button (h-6) is rendered — hover used to jump the row
        // from ~31px (text line-height) to 36px (close button height)
        // and shift everything below it.
        'group relative mt-0.5 flex h-9 items-center gap-2 rounded-md pr-1.5 pl-2.5 text-sm',
        'hover:bg-surface/60',
        isActive && 'bg-accent/10 text-ink',
        dormantNotResumable && 'opacity-50',
      )}
    >
      {/* Indent spacer kept OUTSIDE any overflow-hidden so the dot below
          can't get clipped by an upstream `truncate`. Was previously
          `pl-6` on the row + dot inside the truncate button, which
          chopped half the dot off in narrow sidebars. */}
      {indent && <span aria-hidden className="block w-3 shrink-0" />}
      {item.isLive && item.live ? (
        <StatusDot
          status={item.live.status}
          confidence={item.live.statusConfidence}
        />
      ) : (
        // Match StatusDot's 14px footprint (centered 10px dot) so live and
        // dormant rows align column-for-column.
        <span
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center"
          title="Not running — click to resume"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-subtle/40" />
        </span>
      )}
      <CliBadge cli={item.cli} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
          placeholder={stripLeadingCli(item.displayName)}
          className="min-w-0 flex-1 rounded border border-accent/40 bg-sunken px-1.5 py-0.5 text-sm text-ink focus:outline-none"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            onDoubleClick={startEditing}
            disabled={isResuming || dormantNotResumable}
            className="flex flex-1 min-w-0 items-center text-left disabled:cursor-not-allowed"
            title={
              dormantNotResumable
                ? `${item.cwd} (history file no longer available)`
                : `${item.cwd}\nDouble-click to rename`
            }
          >
            <span
              className={cn(
                'truncate',
                isActive ? 'text-ink' : dim ? 'text-subtle' : 'text-muted',
                isResuming && 'italic',
              )}
            >
              {isResuming ? 'Resuming…' : label}
            </span>
          </button>
          <span
            className="shrink-0 font-mono text-[11px] text-subtle group-hover:hidden"
            title={new Date(item.lastActivityAt).toLocaleString()}
          >
            {timeAgo(item.lastActivityAt)}
          </span>
          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startEditing();
              }}
              aria-label={`Rename ${label}`}
              className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-ink"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={`Close ${label}`}
              className="flex h-6 w-6 items-center justify-center rounded text-subtle hover:bg-canvas hover:text-danger"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function stripLeadingCli(name: string): string {
  return name.replace(/^(Claude|Codex)\s·\s/, '');
}
