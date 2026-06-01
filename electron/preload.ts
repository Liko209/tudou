import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  type CliKind,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtySpawnOptions,
  type SessionDataPushPayload,
  type SessionSpawnRequest,
} from '../shared/ipc-contracts';
import type { HookStatus } from './hook-installer';
import type { Preferences } from './preferences';
import type { FileEntry, FilePreview } from './files-service';
import type { UpdaterState } from './updater';
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

contextBridge.exposeInMainWorld('agentDashboard', {
  version: '0.1.0-ui2',
  pty: ptyApi,
  sessions: sessionApi,
  env: envApi,
  hooks: hooksApi,
  claude: claudeApi,
  preferences: preferencesApi,
  files: filesApi,
  updates: updatesApi,
});

export type PtyApi = typeof ptyApi;
export type SessionApi = typeof sessionApi;
export type EnvApi = typeof envApi;
export type HooksApi = typeof hooksApi;
export type ClaudeApi = typeof claudeApi;
export type PreferencesApi = typeof preferencesApi;
export type FilesApi = typeof filesApi;
export type UpdatesApi = typeof updatesApi;
