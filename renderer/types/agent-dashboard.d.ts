// Type for the API exposed by electron/preload.ts on window.agentDashboard.
import type { PtyApi, SessionApi, EnvApi, HooksApi, PreferencesApi } from '../../electron/preload';

declare global {
  interface Window {
    agentDashboard?: {
      version: string;
      pty: PtyApi;
      sessions: SessionApi;
      env: EnvApi;
      hooks: HooksApi;
      preferences: PreferencesApi;
    };
  }
}

export {};
