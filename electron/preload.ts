import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtySpawnOptions,
} from '../shared/ipc-contracts';

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

contextBridge.exposeInMainWorld('agentDashboard', {
  version: '0.1.0-m1',
  pty: ptyApi,
});

export type PtyApi = typeof ptyApi;
