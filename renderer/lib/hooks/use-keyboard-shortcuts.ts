'use client';

import { useEffect } from 'react';
import {
  sortSessionsByActivity,
  useSessionsStore,
} from '../stores/sessions-store';
import { useUIStore } from '../stores/ui-store';

/**
 * Window-level keyboard shortcuts:
 *  - ⌘\         : toggle both sidebars
 *  - ⌘T         : open New Session modal
 *  - ⌘W         : kill the active session (with confirm)
 *  - ⌘1..⌘9     : switch to the Nth session in activity-sorted order
 *
 * Caught at window level with preventDefault to win over the embedded
 * xterm.js (which would otherwise pass the key into the CLI).
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const meta = e.metaKey;
      if (!meta) return;

      if (e.key === '\\') {
        e.preventDefault();
        useUIStore.getState().toggleLeft();
        return;
      }

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        // Clear any sticky `newSessionMode` from a sidebar "+" click —
        // ⌘T is a generic shortcut that should land on the modal's
        // own default scope, not whatever was last picked.
        useUIStore.getState().openNewSession();
        return;
      }

      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        const { activeId, sessions } = useSessionsStore.getState();
        if (!activeId) return;
        const s = sessions[activeId];
        if (!s) return;
        const isLive = s.status !== 'exited' && s.status !== 'errored';
        const confirmed = isLive
          ? window.confirm(
              `Close session "${s.displayName}"? The ${s.cli} process will be terminated.`,
            )
          : true;
        if (!confirmed) return;
        const api = window.agentDashboard?.sessions;
        if (!api) return;
        // Kill first (if alive) so PTY tears down cleanly, then drop the
        // record so the tab disappears from the sidebar.
        void (async () => {
          if (isLive) await api.kill(activeId);
          await api.forget(activeId);
        })();
        return;
      }

      // ⌘1..⌘9 → switch to the Nth session
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        const sorted = sortSessionsByActivity(useSessionsStore.getState().sessions);
        const target = sorted[idx];
        if (target) useSessionsStore.getState().setActive(target.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
