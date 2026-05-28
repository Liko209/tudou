'use client';

import { useMemo } from 'react';
import { useSessionsStore } from '../../lib/stores/sessions-store';
import { Terminal } from './Terminal';
import { StatusDot } from './StatusDot';

/**
 * Renders one persistent <Terminal> per session and toggles visibility via
 * display:none so the offscreen sessions keep accumulating PTY output
 * (preserving scrollback when the user tabs away and back).
 */
export function CenterPane() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const ids = useMemo(() => Object.keys(sessions), [sessions]);
  const activeSession = activeId ? sessions[activeId] : null;

  if (ids.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center text-muted">
          <p className="text-sm">No session yet.</p>
          <p className="mt-2 text-xs">
            Hit <kbd className="font-mono text-ink">⌘T</kbd> or use the toolbar to
            spawn one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {activeSession && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-edge/5 bg-canvas px-3 text-xs">
          <StatusDot status={activeSession.status} confidence={activeSession.statusConfidence} />
          <span className="text-ink font-medium">{activeSession.displayName}</span>
          <span className="text-subtle">·</span>
          <span className="text-muted font-mono truncate">{activeSession.cwd}</span>
        </div>
      )}
      <div className="relative flex-1 min-h-0 bg-canvas">
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
    </div>
  );
}
