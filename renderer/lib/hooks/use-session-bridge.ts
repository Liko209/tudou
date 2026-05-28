'use client';

import { useEffect } from 'react';
import { useSessionsStore } from '../stores/sessions-store';

/**
 * Mount once at app root. Loads the current Session snapshot from main and
 * subscribes to add / update / remove push events, keeping the Zustand
 * store in sync. Returns nothing — components read state from the store.
 */
export function useSessionBridge(): void {
  const upsertSession = useSessionsStore((s) => s.upsertSession);
  const removeSession = useSessionsStore((s) => s.removeSession);
  const bulkReplace = useSessionsStore((s) => s.bulkReplace);
  const setActive = useSessionsStore((s) => s.setActive);

  useEffect(() => {
    const api = window.agentDashboard?.sessions;
    if (!api) return;

    let cancelled = false;

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

    const offAdd = api.onAdd((session) => {
      upsertSession(session);
      // Auto-focus newly spawned session.
      setActive(session.id);
    });
    const offUpdate = api.onUpdate((session) => upsertSession(session));
    const offRemove = api.onRemove(({ id }) => removeSession(id));
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
  }, [bulkReplace, removeSession, setActive, upsertSession]);
}
