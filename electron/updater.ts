// Auto-update via electron-updater (GitHub Releases) for an UNSIGNED app.
//
// Because Tudou isn't code-signed, Squirrel.Mac's quitAndInstall() can't
// atomically swap /Applications/Tudou.app. So we keep Squirrel off and do the
// swap ourselves (manualSwapInstall): download the ZIP, extract with ditto,
// then a detached script rm's the old bundle, mv's the new one in, clears the
// quarantine xattr on the fresh bytes, and reopens. Mirrors the approach
// proven in the Bitrove spike.
//
// First install still needs the user to clear quarantine once
//   xattr -cr /Applications/Tudou.app
// because the DMG came through a browser. Updates after that are quarantine-
// free (downloaded by the app, not a browser) so they apply silently.
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { app, shell, type BrowserWindow } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { IpcChannels } from '../shared/ipc-contracts';

const APP_BUNDLE = 'Tudou.app';

// Squirrel.Mac quitAndInstall() needs a signed app; until then we self-swap.
const QUIT_AND_INSTALL_AVAILABLE = false;

export interface UpdateInfoLite {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null;
}

export type UpdaterState =
  | { phase: 'idle'; currentVersion: string }
  | { phase: 'checking' }
  | { phase: 'up-to-date'; currentVersion: string }
  | { phase: 'available'; info: UpdateInfoLite }
  | { phase: 'downloading'; info: UpdateInfoLite; percent: number }
  | { phase: 'ready'; info: UpdateInfoLite; canAutoInstall: boolean }
  | { phase: 'error'; message: string };

let state: UpdaterState = { phase: 'idle', currentVersion: '' };
let win: BrowserWindow | null = null;
let downloadedFile: string | null = null;
let wired = false;
let installing = false;

/** True once we've begun swapping in an update and are quitting to relaunch.
 *  The lifecycle manager checks this so its Cmd+Q "you have live sessions"
 *  confirm doesn't block the updater's app.quit() (which left the old app
 *  running, so the swap script couldn't relaunch). */
export function isInstalling(): boolean {
  return installing;
}

function setState(next: UpdaterState): void {
  state = next;
  if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.updateState, state);
}

// electron-updater errors stringify the whole HTTP response (headers + stack).
// Keep just the first line, capped — enough to diagnose, won't blow up the UI.
function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const firstLine = raw.split('\n')[0] ?? raw;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

export function getUpdaterState(): UpdaterState {
  return state;
}

function lite(info: UpdateInfo): UpdateInfoLite {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes:
      typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => n.note ?? '').join('\n')
          : null,
  };
}

/**
 * Wire the updater to a window (for state pushes) and register listeners.
 * Safe to call once; no-ops in dev (unpackaged) where there's no feed.
 */
export function initUpdater(window: BrowserWindow): void {
  win = window;
  // Surface the running version immediately so Settings → Updates can show it
  // before any check (works in dev too, where we return early below).
  if (state.phase === 'idle') setState({ phase: 'idle', currentVersion: app.getVersion() });
  if (!app.isPackaged || wired) return;
  wired = true;

  autoUpdater.autoDownload = false; // we drive download on user confirmation
  autoUpdater.autoInstallOnAppQuit = QUIT_AND_INSTALL_AVAILABLE;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => setState({ phase: 'checking' }));
  autoUpdater.on('update-available', (info) => setState({ phase: 'available', info: lite(info) }));
  autoUpdater.on('update-not-available', (info) =>
    setState({ phase: 'up-to-date', currentVersion: info?.version ?? app.getVersion() }),
  );
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const info = state.phase === 'downloading' || state.phase === 'available' ? state.info : { version: '' };
    setState({ phase: 'downloading', info, percent: p.percent ?? 0 });
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloadedFile = (info as unknown as { downloadedFile?: string }).downloadedFile ?? null;
    const haveZip = !!downloadedFile && downloadedFile.endsWith('.zip');
    setState({ phase: 'ready', info: lite(info), canAutoInstall: QUIT_AND_INSTALL_AVAILABLE || haveZip });
  });
  autoUpdater.on('error', (err) => setState({ phase: 'error', message: errText(err) }));

  // Quietly check shortly after launch.
  setTimeout(() => void checkForUpdates(), 3000);
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    setState({ phase: 'up-to-date', currentVersion: app.getVersion() });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    setState({ phase: 'error', message: errText(e) });
  }
}

export async function downloadUpdate(): Promise<void> {
  if (state.phase !== 'available') return;
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    setState({ phase: 'error', message: errText(e) });
  }
}

export async function installUpdate(): Promise<void> {
  if (state.phase !== 'ready') return;
  if (QUIT_AND_INSTALL_AVAILABLE) {
    autoUpdater.quitAndInstall();
    return;
  }
  if (downloadedFile && downloadedFile.endsWith('.zip') && existsSync(downloadedFile)) {
    try {
      await manualSwapInstall(downloadedFile);
      return;
    } catch {
      // fall through to revealing the file
    }
  }
  if (downloadedFile && existsSync(downloadedFile)) shell.showItemInFolder(downloadedFile);
}

function installedAppBundle(): string | null {
  const m = process.execPath.match(/^(.*?\.app)\/Contents\/MacOS\//);
  return m?.[1] ?? null;
}

// Unsigned in-place update: extract the ZIP, then a detached bash script
// swaps the bundle, clears quarantine, and relaunches after we quit.
async function manualSwapInstall(zipPath: string): Promise<void> {
  const target = installedAppBundle();
  if (!target) throw new Error('Could not resolve installed app path (running in dev?)');

  const stamp = `${process.pid.toString(36)}-${Math.floor(process.uptime() * 1000)}`;
  const stageDir = join(tmpdir(), `tudou-update-${stamp}`);
  mkdirSync(stageDir, { recursive: true });

  // ditto preserves the bundle's exec bits / symlinks (unzip can mangle them).
  const extract = spawnSync('/usr/bin/ditto', ['-x', '-k', zipPath, stageDir], { encoding: 'utf8' });
  if (extract.status !== 0) throw new Error(`ditto failed: ${extract.stderr || extract.status}`);

  const newApp = join(stageDir, APP_BUNDLE);
  if (!existsSync(newApp)) throw new Error(`extracted bundle not found at ${newApp}`);

  // Paths passed as positional args (not interpolated) to avoid shell injection.
  const script = `#!/bin/bash
set -e
sleep 1
rm -rf -- "$1"
mv -- "$2" "$1"
xattr -cr "$1" 2>/dev/null || true
open "$1"
rm -rf -- "$3" 2>/dev/null || true
`;
  const scriptPath = join(stageDir, 'swap.sh');
  writeFileSync(scriptPath, script, { mode: 0o755 });

  const child = spawn('/bin/bash', [scriptPath, target, newApp, stageDir], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  // Signal the lifecycle manager to let this quit through unconfirmed, then
  // quit so the detached script can swap the bundle and relaunch.
  installing = true;
  setTimeout(() => app.quit(), 200);
}
