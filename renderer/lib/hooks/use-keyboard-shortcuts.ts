'use client';

import { useEffect } from 'react';
import {
  sortSessionsByActivity,
  useSessionsStore,
} from '../stores/sessions-store';
import { useUIStore } from '../stores/ui-store';

/**
 * Window-level keyboard shortcuts:
 *  - ⌘B          : toggle the left sidebar
 *  - ⌘⇧B         : toggle the right panel
 *  - ⌘⌥B         : toggle the bottom panel
 *  - ⌘\          : toggle the left sidebar (legacy)
 *  - ⌘N          : new session in the current project (else generic New chat)
 *  - ⌘⇧N         : New chat (generic)
 *  - ⌘T          : open New Session modal
 *  - ⌘W          : kill the active session (with confirm)
 *  - ⌘1..⌘9      : switch to the Nth session in activity-sorted order
 *
 * Caught at window level with preventDefault to win over the embedded
 * xterm.js (which would otherwise pass the key into the CLI). Letter keys
 * match on `e.code` so ⌘⌥B keeps working (Option rewrites `e.key`).
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const meta = e.metaKey;
      if (!meta) return;

      // ⌘B / ⌘⇧B / ⌘⌥B → toggle left / right / bottom panels.
      if (e.code === 'KeyB') {
        e.preventDefault();
        const ui = useUIStore.getState();
        if (!e.altKey && !e.shiftKey) {
          ui.toggleLeft();
          return;
        }
        // Right/bottom panels are per-session — toggle the active session's.
        const activeId = useSessionsStore.getState().activeId;
        const panel = activeId ? ui.panels[activeId] : undefined;
        if (e.altKey) ui.setBottomPanelOpen(!(panel?.bottomOpen ?? false));
        else ui.setRightPanelOpen(!(panel?.rightOpen ?? false));
        return;
      }

      // ⌘N → new session in the current project; ⌘⇧N → generic New chat.
      if (e.code === 'KeyN') {
        e.preventDefault();
        const ui = useUIStore.getState();
        if (e.shiftKey) {
          ui.openNewSession();
          return;
        }
        const { activeId, sessions } = useSessionsStore.getState();
        const active = activeId ? sessions[activeId] : null;
        const chatsBase = window.agentDashboard?.env.chatsBaseDir() ?? '';
        // "In a project" = active session whose cwd isn't under the generic
        // chats base dir. Prefill the modal with that project's cwd.
        if (active && !(chatsBase && active.cwd.startsWith(chatsBase))) {
          ui.openNewSession('project', active.cwd);
        } else {
          ui.openNewSession();
        }
        return;
      }

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
