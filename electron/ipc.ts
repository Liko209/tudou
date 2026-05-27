import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannels, type PtySpawnOptions } from '../shared/ipc-contracts';
import type { PtyManager } from './pty-manager';

/**
 * Wires the PtyManager into Electron's IPC and pushes data/exit
 * events out to a renderer window.
 *
 * Single-window for now (M1 spike). Multi-window broadcast comes with M4.
 */
export function registerPtyIpc(window: BrowserWindow, ptyManager: PtyManager): void {
  ipcMain.handle(IpcChannels.ptySpawn, (_e, opts: PtySpawnOptions) => ptyManager.spawn(opts));

  ipcMain.handle(IpcChannels.ptyWrite, (_e, id: string, data: string) => {
    ptyManager.write(id, data);
  });

  ipcMain.handle(IpcChannels.ptyResize, (_e, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows);
  });

  ipcMain.handle(IpcChannels.ptyKill, (_e, id: string, signal?: string) => {
    ptyManager.kill(id, signal);
  });

  ipcMain.handle(IpcChannels.ptyList, () => ptyManager.list());

  const onData = (event: { id: string; data: string }): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.ptyData, event);
  };
  const onExit = (event: { id: string; exitCode: number; signal: number | null }): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.ptyExit, event);
  };

  ptyManager.on('data', onData);
  ptyManager.on('exit', onExit);

  window.on('closed', () => {
    ptyManager.off('data', onData);
    ptyManager.off('exit', onExit);
  });
}
