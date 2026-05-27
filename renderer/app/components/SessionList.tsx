'use client';

import { useMemo } from 'react';
import { basename } from '../../lib/path-helpers';
import { cn } from '../../lib/utils';
import {
  groupSessionsByCwd,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import { StatusDot } from './StatusDot';

const CLI_LABEL: Record<'claude' | 'codex', string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export function SessionList() {
  // Subscribe to the raw sessions map (stable ref) and derive groups in
  // useMemo. Selectors that return new arrays cannot be passed to the hook
  // directly — they trip React's "snapshot must be cached" infinite-loop guard.
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  const groups = useMemo(() => groupSessionsByCwd(sessions), [sessions]);

  if (groups.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-muted">
        No sessions yet. Hit <kbd className="font-mono text-ink">⌘T</kbd> to start one.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {groups.map((group) => (
        <div key={group.cwd} className="px-2">
          <div className="px-2 pt-1 pb-1.5 text-xs text-subtle truncate" title={group.cwd}>
            {basename(group.cwd)}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((session) => {
              const isActive = session.id === activeId;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => setActive(session.id)}
                    className={cn(
                      'w-full text-left rounded-md px-2 py-1.5 transition-colors',
                      'hover:bg-surface',
                      isActive && 'bg-surface ring-1 ring-accent/40',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot status={session.status} confidence={session.statusConfidence} />
                      <span className="text-[10px] uppercase tracking-wider text-subtle">
                        {CLI_LABEL[session.cli]}
                      </span>
                      <span className="truncate text-sm font-medium">
                        {session.displayName}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <span className="truncate">{session.gitBranch ?? '—'}</span>
                      <span>·</span>
                      <span>{session.metrics.messageCount} msgs</span>
                      {session.metrics.estimatedCostUSD !== null && (
                        <>
                          <span>·</span>
                          <span>${session.metrics.estimatedCostUSD.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                    {session.latestMessage && (
                      <div className="mt-1 text-xs text-muted/80 line-clamp-1">
                        {session.latestMessage.preview}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
