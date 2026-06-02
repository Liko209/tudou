import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  type CliKind,
  type PtyDataEvent,
  type PtyExitEvent,
  type ProxyTestRequest,
  type ProxyTestResult,
  type PtySpawnOptions,
  type SessionDataPushPayload,
  type SessionSpawnRequest,
  type SoundPlayPayload,
  type TrayView,
} from '../shared/ipc-contracts';
import type { HookStatus } from './hook-installer';
import type { Preferences } from './preferences';
import type { FileEntry, FilePreview } from './files-service';
import type { UpdaterState } from './updater';
import type { UsageHistory, RateLimits } from '../shared/usage-types';
import type { RateLimitStatus } from './statusline-installer';

export interface RateLimitState {
  status: RateLimitStatus;
  data: RateLimits | null;
}
import type { PreviousSession, ResumableSession, Session } from '../shared/session-types';

const ptyApi = {
  spawn: (opts: PtySpawnOptions): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.ptySpawn, opts),

  write: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.ptyWrite, id, data),

  resize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.ptyResize, id, cols, rows),

  kill: (id: string, signal?: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.ptyKill, id, signal),

  list: (): Promise<string[]> => ipcRenderer.invoke(IpcChannels.ptyList),

  onData(callback: (event: PtyDataEvent) => void): () => void {
    const handler = (_e: unknown, payload: PtyDataEvent): void => callback(payload);
    ipcRenderer.on(IpcChannels.ptyData, handler);
    return () => {
      ipcRenderer.off(IpcChannels.ptyData, handler);
    };
  },

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    const handler = (_e: unknown, payload: PtyExitEvent): void => callback(payload);
    ipcRenderer.on(IpcChannels.ptyExit, handler);
    return () => {
      ipcRenderer.off(IpcChannels.ptyExit, handler);
    };
  },
};

const sessionApi = {
  list: (): Promise<Session[]> => ipcRenderer.invoke(IpcChannels.sessionList),
  spawn: (req: SessionSpawnRequest): Promise<Session> =>
    ipcRenderer.invoke(IpcChannels.sessionSpawn, req),
  kill: (id: string, signal?: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionKill, id, signal),
  forget: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.sessionForget, id),
  release: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.sessionRelease, id),
  rename: (id: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionRename, id, title),
  write: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionWrite, id, data),
  resize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionResize, id, cols, rows),
  getScrollback: (id: string): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.sessionScrollback, id),
  listResumable: (cli: CliKind, cwd: string): Promise<ResumableSession[]> =>
    ipcRenderer.invoke(IpcChannels.sessionListResumable, cli, cwd),
  listPrevious: (): Promise<PreviousSession[]> =>
    ipcRenderer.invoke(IpcChannels.sessionListPrevious),
  dismissPrevious: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionDismissPrevious, id),
  dismissAllPrevious: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionDismissAllPrevious),
  resolveCliPath: (name: CliKind | string): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.cliResolvePath, name),
  pickDirectory: (opts?: { defaultPath?: string }): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.dialogPickDirectory, opts),
  /** Tell main which session the user is viewing (drives sound-cue suppression). */
  setActive: (id: string | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionSetActive, id),

  onAdd(callback: (session: Session) => void): () => void {
    const h = (_e: unknown, s: Session): void => callback(s);
    ipcRenderer.on(IpcChannels.sessionAdd, h);
    return () => {
      ipcRenderer.off(IpcChannels.sessionAdd, h);
    };
  },
  onUpdate(callback: (session: Session) => void): () => void {
    const h = (_e: unknown, s: Session): void => callback(s);
    ipcRenderer.on(IpcChannels.sessionUpdate, h);
    return () => {
      ipcRenderer.off(IpcChannels.sessionUpdate, h);
    };
  },
  onRemove(callback: (payload: { id: string }) => void): () => void {
    const h = (_e: unknown, p: { id: string }): void => callback(p);
    ipcRenderer.on(IpcChannels.sessionRemove, h);
    return () => {
      ipcRenderer.off(IpcChannels.sessionRemove, h);
    };
  },
  onData(callback: (payload: SessionDataPushPayload) => void): () => void {
    const h = (_e: unknown, p: SessionDataPushPayload): void => callback(p);
    ipcRenderer.on(IpcChannels.sessionData, h);
    return () => {
      ipcRenderer.off(IpcChannels.sessionData, h);
    };
  },
  onFocus(callback: (payload: { id: string }) => void): () => void {
    const h = (_e: unknown, p: { id: string }): void => callback(p);
    ipcRenderer.on(IpcChannels.sessionFocus, h);
    return () => {
      ipcRenderer.off(IpcChannels.sessionFocus, h);
    };
  },
};

const envApi = {
  homedir: (): string => process.env.HOME ?? '/',
  shell: (): string => process.env.SHELL || '/bin/zsh',
  platform: process.platform,
  /**
   * Root for ad-hoc Chat working dirs. Renderer treats any session whose
   * cwd starts with this as a Chat (vs a Project session).
   * Falls back to a sane macOS default if main hasn't injected the env.
   */
  chatsBaseDir: (): string =>
    process.env.AGENT_DASHBOARD_CHATS_DIR ??
    `${process.env.HOME ?? '/'}/Library/Application Support/agent-dashboard/chats`,
};

const claudeApi = {
  /**
   * Mirror the dashboard's effective theme into ~/.claude/settings.json
   * so any *future* Claude spawn (or resume) launches with matching
   * chrome. Already-running Claude processes don't re-read settings.
   */
  setTheme: (theme: 'dark' | 'light'): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.claudeSetTheme, theme),
};

const appApi = {
  /** Relaunch the app — used to apply a theme change cleanly. */
  relaunch: (): Promise<void> => ipcRenderer.invoke(IpcChannels.appRelaunch),
  /** Subscribe to "open this view" pushes from the tray. Returns an unsubscribe. */
  onOpenView(callback: (view: TrayView) => void): () => void {
    const h = (_e: unknown, v: TrayView): void => callback(v);
    ipcRenderer.on(IpcChannels.uiOpen, h);
    return () => {
      ipcRenderer.off(IpcChannels.uiOpen, h);
    };
  },
};

const usageApi = {
  /** Aggregated historical usage scanned from CLI JSONL transcripts. */
  getHistory: (): Promise<UsageHistory> => ipcRenderer.invoke(IpcChannels.usageGetHistory),
  /** Captured rate-limit snapshot + tracker status. */
  getRateLimits: (): Promise<RateLimitState> => ipcRenderer.invoke(IpcChannels.usageGetRateLimits),
  /** Enable/disable the opt-in rate-limit statusLine capture. */
  toggleRateLimits: (enable: boolean): Promise<RateLimitState> =>
    ipcRenderer.invoke(IpcChannels.usageToggleRateLimits, enable),
};

const hooksApi = {
  getStatus: (): Promise<HookStatus> => ipcRenderer.invoke(IpcChannels.hookGetStatus),
  install: (): Promise<HookStatus> => ipcRenderer.invoke(IpcChannels.hookInstall),
  uninstall: (): Promise<HookStatus> => ipcRenderer.invoke(IpcChannels.hookUninstall),
  getManualSnippet: (): Promise<string> => ipcRenderer.invoke(IpcChannels.hookGetManualSnippet),
};

const preferencesApi = {
  get: (): Promise<Preferences> => ipcRenderer.invoke(IpcChannels.preferencesGet),
  set: (next: Preferences): Promise<Preferences> =>
    ipcRenderer.invoke(IpcChannels.preferencesSet, next),
  reset: (): Promise<Preferences> => ipcRenderer.invoke(IpcChannels.preferencesReset),
  clearSessions: (): Promise<void> => ipcRenderer.invoke(IpcChannels.preferencesClearSessions),
};

const networkApi = {
  testProxy: (req: ProxyTestRequest): Promise<ProxyTestResult> =>
    ipcRenderer.invoke(IpcChannels.networkTestProxy, req),
};

const filesApi = {
  list: (dir: string): Promise<FileEntry[]> => ipcRenderer.invoke(IpcChannels.filesList, dir),
  preview: (path: string): Promise<FilePreview> =>
    ipcRenderer.invoke(IpcChannels.filesPreview, path),
};

const updatesApi = {
  getState: (): Promise<UpdaterState> => ipcRenderer.invoke(IpcChannels.updateGetState),
  check: (): Promise<void> => ipcRenderer.invoke(IpcChannels.updateCheck),
  download: (): Promise<void> => ipcRenderer.invoke(IpcChannels.updateDownload),
  install: (): Promise<void> => ipcRenderer.invoke(IpcChannels.updateInstall),
  onState(callback: (state: UpdaterState) => void): () => void {
    const h = (_e: unknown, s: UpdaterState): void => callback(s);
    ipcRenderer.on(IpcChannels.updateState, h);
    return () => {
      ipcRenderer.off(IpcChannels.updateState, h);
    };
  },
};

const soundApi = {
  /** Subscribe to "play this cue now" pushes from main. Returns an unsubscribe. */
  onPlay(callback: (payload: SoundPlayPayload) => void): () => void {
    const h = (_e: unknown, p: SoundPlayPayload): void => callback(p);
    ipcRenderer.on(IpcChannels.soundPlay, h);
    return () => {
      ipcRenderer.off(IpcChannels.soundPlay, h);
    };
  },
};

// Used by the menu-bar companion popover (the `tray/` route) to drive the main
// window and dismiss itself.
const trayApi = {
  focusSession: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.trayFocusSession, id),
  openView: (view: TrayView): Promise<void> => ipcRenderer.invoke(IpcChannels.trayOpenView, view),
  close: (): Promise<void> => ipcRenderer.invoke(IpcChannels.trayClosePopover),
};

contextBridge.exposeInMainWorld('agentDashboard', {
  version: '0.1.0-ui2',
  pty: ptyApi,
  sessions: sessionApi,
  env: envApi,
  hooks: hooksApi,
  claude: claudeApi,
  app: appApi,
  usage: usageApi,
  preferences: preferencesApi,
  network: networkApi,
  files: filesApi,
  updates: updatesApi,
  sound: soundApi,
  tray: trayApi,
});

export type PtyApi = typeof ptyApi;
export type SessionApi = typeof sessionApi;
export type EnvApi = typeof envApi;
export type HooksApi = typeof hooksApi;
export type ClaudeApi = typeof claudeApi;
export type AppApi = typeof appApi;
export type UsageApi = typeof usageApi;
export type PreferencesApi = typeof preferencesApi;
export type NetworkApi = typeof networkApi;
export type FilesApi = typeof filesApi;
export type UpdatesApi = typeof updatesApi;
export type SoundApi = typeof soundApi;
export type TrayApi = typeof trayApi;
