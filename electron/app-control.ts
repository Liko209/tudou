import { app } from 'electron';

// Theme changes apply cleanly only on a fresh launch (the terminal palette is
// baked in at xterm construction). When the user opts to restart, we relaunch
// here — and flag it so the lifecycle manager's "you have live sessions" quit
// confirm doesn't block the intentional quit (mirrors updater.isInstalling).

let relaunching = false;

/** True once a deliberate relaunch is underway — lets it quit unconfirmed. */
export function isRelaunching(): boolean {
  return relaunching;
}

/** Relaunch the app: queue a fresh instance, then quit the current one. */
export function relaunchApp(): void {
  relaunching = true;
  app.relaunch();
  app.quit();
}
