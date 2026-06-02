import { create } from 'zustand';
import type { UpdaterState } from '../../../electron/updater';

export type { UpdaterState };

interface UpdaterStore {
  /** Latest updater state pushed from main, or null before the first read. */
  state: UpdaterState | null;
  setState: (s: UpdaterState) => void;
}

/**
 * Holds the auto-updater state app-wide so surfaces outside Settings (the
 * top-right "update available" badge) can react to it. Fed by
 * use-updater-status, which subscribes to the main-process push.
 */
export const useUpdaterStore = create<UpdaterStore>((set) => ({
  state: null,
  setState: (s) => set({ state: s }),
}));

/**
 * Phases where a pending update is waiting on the user — drives the header
 * badge. We never auto-download, so `available` is the common trigger;
 * `downloading`/`ready` keep the badge up once the user starts an update.
 */
export function isUpdateActionable(phase: UpdaterState['phase'] | undefined): boolean {
  return phase === 'available' || phase === 'downloading' || phase === 'ready';
}
