// Type for the API exposed by electron/preload.ts on window.agentDashboard.
import type { PtyApi } from '../../electron/preload';

declare global {
  interface Window {
    agentDashboard?: {
      version: string;
      pty: PtyApi;
    };
  }
}

export {};
