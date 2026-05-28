// Type for the API exposed by electron/preload.ts on window.agentDashboard.
import type { PtyApi, SessionApi, EnvApi } from '../../electron/preload';

declare global {
  interface Window {
    agentDashboard?: {
      version: string;
      pty: PtyApi;
      sessions: SessionApi;
      env: EnvApi;
    };
  }
}

export {};
