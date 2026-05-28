import { dialog, ipcMain, type BrowserWindow } from 'electron';
import {
  IpcChannels,
  type CliKind,
  type PtySpawnOptions,
  type SessionDataPushPayload,
  type SessionSpawnRequest,
} from '../shared/ipc-contracts';
import type { PtyManager } from './pty-manager';
import type { SessionRegistry } from './session-registry';
import { resolveCliPath } from './cli-resolver';
import type { Session } from '../shared/session-types';

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

/**
 * High-level Session IPC. Registers session:spawn/list/kill handlers and
 * forwards SessionRegistry events out to the renderer.
 */
export function registerSessionIpc(
  window: BrowserWindow,
  registry: SessionRegistry,
): void {
  ipcMain.handle(IpcChannels.sessionList, (): Session[] => registry.list());

  ipcMain.handle(
    IpcChannels.sessionSpawn,
    async (_e, request: SessionSpawnRequest): Promise<Session> => {
      const shellPath = await resolveCliPath(request.cli);
      if (!shellPath) {
        throw new Error(
          `Cannot launch ${request.cli}: binary not found on PATH. Run \`which ${request.cli}\` in a shell to confirm.`,
        );
      }
      const { session } = registry.spawn({
        cli: request.cli,
        cwd: request.cwd,
        cols: request.cols,
        rows: request.rows,
        shellPath,
        spawnArgs: request.spawnArgs,
      });
      return session;
    },
  );

  ipcMain.handle(IpcChannels.sessionKill, (_e, id: string, signal?: string) => {
    registry.kill(id, signal);
  });

  ipcMain.handle(IpcChannels.sessionForget, (_e, id: string) => {
    registry.forget(id);
  });

  ipcMain.handle(IpcChannels.sessionWrite, (_e, id: string, data: string) => {
    registry.write(id, data);
  });

  ipcMain.handle(IpcChannels.sessionResize, (_e, id: string, cols: number, rows: number) => {
    registry.resize(id, cols, rows);
  });

  ipcMain.handle(
    IpcChannels.sessionListResumable,
    async (_e, cli: CliKind, cwd: string) => registry.listResumable(cli, cwd),
  );

  ipcMain.handle(IpcChannels.cliResolvePath, (_e, name: string) => resolveCliPath(name));

  ipcMain.handle(IpcChannels.dialogPickDirectory, async (_e, opts?: { defaultPath?: string }) => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose working directory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: opts?.defaultPath,
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  const onAdd = (s: Session): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.sessionAdd, s);
  };
  const onUpdate = (s: Session): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.sessionUpdate, s);
  };
  const onRemove = (payload: { id: string }): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.sessionRemove, payload);
  };
  const onData = (payload: SessionDataPushPayload): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.sessionData, payload);
  };

  registry.on('add', onAdd);
  registry.on('update', onUpdate);
  registry.on('remove', onRemove);
  registry.on('data', onData);

  window.on('closed', () => {
    registry.off('add', onAdd);
    registry.off('update', onUpdate);
    registry.off('remove', onRemove);
    registry.off('data', onData);
  });
}
