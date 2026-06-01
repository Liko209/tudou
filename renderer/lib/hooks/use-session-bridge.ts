'use client';

import { useEffect } from 'react';
import { useSessionsStore } from '../stores/sessions-store';

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
      if (!session.panelOnly) setActive(session.id);
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
    // menu item — we follow by activating the session in the UI.
    const offFocus = api.onFocus(({ id }) => {
      if (id) setActive(id);
    });

    return () => {
      cancelled = true;
      offAdd();
      offUpdate();
      offRemove();
      offFocus();
    };
  }, [bulkReplace, removeSession, setActive, setPrevious, upsertSession]);
}
