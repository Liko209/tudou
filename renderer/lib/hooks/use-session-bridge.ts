'use client';

import { useEffect } from 'react';
import { useSessionsStore } from '../stores/sessions-store';
import { useUIStore } from '../stores/ui-store';

/**
 * Mount once at app root. Loads the current Session snapshot from main and
 * subscribes to add / update / remove push events, keeping the Zustand
 * store in sync. Also tracks the dormant "previous sessions" list so the
 * sidebar can render lazy-resumable entries alongside live ones.
 */
export function useSessionBridge(): void {
  const upsertSession = useSessionsStore((s) => s.upsertSession);
  const removeSession = useSessionsStore((s) => s.removeSession);
  const bulkReplace = useSessionsStore((s) => s.bulkReplace);
  const setActive = useSessionsStore((s) => s.setActive);
  const setPrevious = useSessionsStore((s) => s.setPrevious);

  useEffect(() => {
    const api = window.agentDashboard?.sessions;
    if (!api) return;

    let cancelled = false;

    const refreshPrevious = (): void => {
      void api.listPrevious().then((list) => {
        if (!cancelled) setPrevious(list);
      });
    };

    void api.list().then((sessions) => {
      if (cancelled) return;
      bulkReplace(sessions);
      // If a session is already running but none active, pick the newest.
      if (sessions.length > 0 && useSessionsStore.getState().activeId === null) {
        const newest = sessions.reduce((a, b) =>
          a.lastActivityAt >= b.lastActivityAt ? a : b,
        );
        setActive(newest.id);
      }
    });
    refreshPrevious();

    const offAdd = api.onAdd((session) => {
      upsertSession(session);
      // Auto-focus newly spawned session — but not panel-only ones; those
      // live inside a dock panel and would hijack the main view.
      if (!session.panelOnly) {
        setActive(session.id);
        // Starting fresh work in a removed project brings it back — otherwise
        // the new session would be running but invisible in the sidebar.
        const ui = useUIStore.getState();
        if (ui.hiddenProjects.includes(session.cwd)) ui.unhideProject(session.cwd);
      }
      // A new live session may have just consumed a dormant entry
      // (resume flow removes the prior persistence record) — resync.
      refreshPrevious();
    });
    const offUpdate = api.onUpdate((session) => upsertSession(session));
    const offRemove = api.onRemove(({ id }) => {
      removeSession(id);
      // Closing a tab with `release` leaves a fresh dormant record;
      // closing with `forget` removes it. Either way, refetch.
      refreshPrevious();
    });
    // Main triggers this when the user clicks a notification or a tray
    // menu item — we follow by activating the session in the UI (and leave any
    // Usage/Settings overlay so the session is actually visible).
    const offFocus = api.onFocus(({ id }) => {
      if (!id) return;
      const ui = useUIStore.getState();
      ui.setUsageOpen(false);
      ui.setSettingsOpen(false);
      setActive(id);
    });

    // Tray "New session / Open Usage / Open Settings" → open the view here.
    const offOpenView = window.agentDashboard?.app?.onOpenView((view) => {
      const ui = useUIStore.getState();
      if (view === 'usage') ui.setUsageOpen(true);
      else if (view === 'settings') ui.setSettingsOpen(true);
      else if (view === 'newSession') ui.openNewSession();
    });

    return () => {
      cancelled = true;
      offAdd();
      offUpdate();
      offRemove();
      offFocus();
      offOpenView?.();
    };
  }, [bulkReplace, removeSession, setActive, setPrevious, upsertSession]);
}
