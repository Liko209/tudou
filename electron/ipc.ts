import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import type { HookInstaller, HookStatus } from './hook-installer';
import { buildHookScript } from './hook-installer';
import type { HookServer } from './hook-server';
import type { PreferencesStore, Preferences } from './preferences';
import type { SessionPersistence } from './session-persistence';
import { listDir, readPreview } from './files-service';
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
  preferences: PreferencesStore,
): void {
  ipcMain.handle(IpcChannels.sessionList, (): Session[] => registry.list());

  ipcMain.handle(
    IpcChannels.sessionSpawn,
    async (_e, request: SessionSpawnRequest): Promise<Session> => {
      // User-configured override wins; otherwise probe the shell.
      const override = preferences.cliPathOverride(request.cli);
      const shellPath = override ?? (await resolveCliPath(request.cli));
      if (!shellPath) {
        throw new Error(
          `Cannot launch ${request.cli}: binary not found on PATH. Run \`which ${request.cli}\` in a shell to confirm, or set a custom path in Settings.`,
        );
      }

      // Ad-hoc chat: allocate a hidden per-chat working dir so the chat
      // is isolated from any real project and won't pollute the user's
      // $HOME with claude/codex project metadata.
      let cwd = request.cwd ?? '';
      if (request.chat) {
        cwd = join(chatsBaseDir(), randomUUID());
        mkdirSync(cwd, { recursive: true });
      }
      if (!cwd) {
        throw new Error('sessionSpawn: cwd is required when chat=false');
      }

      const { session } = registry.spawn({
        cli: request.cli,
        cwd,
        cols: request.cols,
        rows: request.rows,
        shellPath,
        spawnArgs: request.spawnArgs,
        panelOnly: request.panelOnly,
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

  ipcMain.handle(IpcChannels.sessionListPrevious, () => registry.listPrevious());
  ipcMain.handle(IpcChannels.sessionDismissPrevious, (_e, id: string) => {
    registry.dismissPrevious(id);
  });
  ipcMain.handle(IpcChannels.sessionDismissAllPrevious, () => {
    registry.dismissAllPrevious();
  });

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

/** Resolve the directory where ad-hoc chats live. */
export function chatsBaseDir(): string {
  return join(app.getPath('userData'), 'chats');
}

/** Hook installer / status IPC. */
export function registerHookIpc(installer: HookInstaller, hookServer: HookServer): void {
  ipcMain.handle(IpcChannels.hookGetStatus, (): HookStatus => installer.getStatus());
  ipcMain.handle(IpcChannels.hookInstall, () => {
    installer.install(buildHookScript(hookServer.instancePath));
    return installer.getStatus();
  });
  ipcMain.handle(IpcChannels.hookUninstall, () => {
    installer.uninstall();
    return installer.getStatus();
  });
  ipcMain.handle(IpcChannels.hookGetManualSnippet, () =>
    installer.getManualSettingsSnippet(hookServer.instancePath),
  );
}

/** Preferences + dashboard data management IPC. */
export function registerPreferencesIpc(
  preferences: PreferencesStore,
  sessionPersistence: SessionPersistence,
): void {
  ipcMain.handle(IpcChannels.preferencesGet, (): Preferences => preferences.get());
  ipcMain.handle(IpcChannels.preferencesSet, (_e, next: Preferences): Preferences =>
    preferences.setAll(next),
  );
  ipcMain.handle(IpcChannels.preferencesReset, (): Preferences => preferences.reset());
  ipcMain.handle(IpcChannels.preferencesClearSessions, () => {
    // Drop every persisted session record (the user is asking for a
    // clean slate; live sessions in memory are untouched).
    for (const rec of sessionPersistence.list()) {
      sessionPersistence.remove(rec.id);
    }
  });
}

/** Files panel — read-only fs access scoped through the main process. */
export function registerFilesIpc(): void {
  ipcMain.handle(IpcChannels.filesList, (_e, dir: string) => listDir(dir));
  ipcMain.handle(IpcChannels.filesPreview, (_e, path: string) => readPreview(path));
}
