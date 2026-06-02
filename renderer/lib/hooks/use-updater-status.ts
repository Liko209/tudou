'use client';

import { useEffect } from 'react';
import { useUpdaterStore } from '../stores/updater-store';

/**
 * Keep the app-wide updater store in sync with the main process: read the
 * current state once, then subscribe to pushes. Mounted once (AppShell) so the
 * top-right update badge works regardless of whether Settings is open.
 */
export function useUpdaterStatus(): void {
  useEffect(() => {
    const api = window.agentDashboard?.updates;
    if (!api) return;
    const set = useUpdaterStore.getState().setState;
    void api.getState().then(set);
    return api.onState(set);
  }, []);
}
