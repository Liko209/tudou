'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';
import { basename } from '../../lib/path-helpers';
import type { PreviousSession } from '../../../shared/session-types';

const CLI_LABEL: Record<'claude' | 'codex', string> = {
  claude: 'claude',
  codex: 'codex',
};

export function ResumeBanner() {
  const [previous, setPrevious] = useState<PreviousSession[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // One-shot load on mount.
  useEffect(() => {
    const api = window.agentDashboard?.sessions;
    if (!api) return;
    void api.listPrevious().then((list) => {
      setPrevious(list);
      // Default-select all resumable so [Resume selected] does the right
      // thing without per-item clicking.
      setSelected(new Set(list.filter((p) => p.resumable).map((p) => p.id)));
    });
  }, []);

  const resumeMany = useCallback(
    async (items: PreviousSession[]) => {
      const api = window.agentDashboard?.sessions;
      if (!api) return;
      setPending(true);
      try {
        // Sequential — keeps the chokidar locators from racing each other.
        for (const item of items) {
          if (!item.resumable || !item.cliSessionId) continue;
          try {
            await api.spawn({
              cli: item.cli,
              cwd: item.cwd,
              cols: 120,
              rows: 32,
              spawnArgs: { resume: item.cliSessionId },
            });
          } catch (err) {
            // Don't abort the batch on one failure; just log to console.
             
            console.error('[ResumeBanner] resume failed for', item.id, err);
          }
        }
        // After resume, banner has done its job.
        setDismissed(true);
        await api.dismissAllPrevious();
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const dismissAll = useCallback(async () => {
    setDismissed(true);
    await window.agentDashboard?.sessions.dismissAllPrevious();
  }, []);

  if (dismissed || previous === null || previous.length === 0) return null;

  const resumableCount = previous.filter((p) => p.resumable).length;
  const selectedItems = previous.filter((p) => selected.has(p.id));

  return (
    <div className="border-b border-edge/5 bg-accent/5 px-4 py-2.5 text-sm">
      {!picking ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-ink">
            <span className="font-medium">{previous.length}</span> session
            {previous.length === 1 ? '' : 's'} from last time
            {resumableCount < previous.length && (
              <span className="ml-2 text-muted">
                ({resumableCount} still resumable)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={pending || resumableCount === 0}
              onClick={() => void resumeMany(previous.filter((p) => p.resumable))}
            >
              {pending ? 'Resuming…' : `Resume all (${resumableCount})`}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPicking(true)}>
              Pick…
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => void dismissAll()}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-ink">Pick which to resume:</div>
            <button
              type="button"
              onClick={() => void dismissAll()}
              className="text-xs text-muted hover:text-ink"
            >
              ✕
            </button>
          </div>
          <ul className="max-h-44 overflow-y-auto rounded-md border border-edge/10 bg-sunken">
            {previous.map((p) => {
              const isSelected = selected.has(p.id);
              const isDisabled = !p.resumable;
              return (
                <li key={p.id} className="border-b border-edge/5 last:border-b-0">
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-2',
                      isDisabled && 'cursor-not-allowed opacity-50',
                      !isDisabled && 'hover:bg-surface',
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={isDisabled}
                      checked={isSelected}
                      onChange={() => {
                        setSelected((cur) => {
                          const next = new Set(cur);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        });
                      }}
                      className="accent-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-ink truncate">
                        {p.displayName}
                        <span className="ml-2 text-[10px] uppercase text-subtle">
                          {CLI_LABEL[p.cli]}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted font-mono truncate">
                        {basename(p.cwd)}
                        {!p.resumable && (
                          <span className="ml-2 text-danger">file no longer available</span>
                        )}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPicking(false)}>
              Back
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={pending || selectedItems.length === 0}
              onClick={() => void resumeMany(selectedItems)}
            >
              {pending ? 'Resuming…' : `Resume selected (${selectedItems.length})`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
