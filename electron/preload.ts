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
import type { ResumableSession, Session } from '../shared/session-types';

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
  write: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionWrite, id, data),
  resize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.sessionResize, id, cols, rows),
  listResumable: (cli: CliKind, cwd: string): Promise<ResumableSession[]> =>
    ipcRenderer.invoke(IpcChannels.sessionListResumable, cli, cwd),
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
  platform: process.platform,
};

contextBridge.exposeInMainWorld('agentDashboard', {
  version: '0.1.0-m6',
  pty: ptyApi,
  sessions: sessionApi,
  env: envApi,
});

export type PtyApi = typeof ptyApi;
export type SessionApi = typeof sessionApi;
export type EnvApi = typeof envApi;
