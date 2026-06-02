// Type for the API exposed by electron/preload.ts on window.agentDashboard.
import type {
  PtyApi,
  SessionApi,
  EnvApi,
  HooksApi,
  ClaudeApi,
  AppApi,
  UsageApi,
  PreferencesApi,
  FilesApi,
  UpdatesApi,
  SoundApi,
  TrayApi,
} from '../../electron/preload';

declare global {
  interface Window {
    agentDashboard?: {
      version: string;
      pty: PtyApi;
      sessions: SessionApi;
      env: EnvApi;
      hooks: HooksApi;
      claude: ClaudeApi;
      app: AppApi;
      usage: UsageApi;
      preferences: PreferencesApi;
      files: FilesApi;
      updates: UpdatesApi;
      sound: SoundApi;
      tray: TrayApi;
    };
  }
}

export {};
