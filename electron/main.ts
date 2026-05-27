import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { PtyManager } from './pty-manager';
import { registerPtyIpc } from './ipc';

const isDev = process.env.NODE_ENV === 'development';
const ptyManager = new PtyManager();

function resolvePreloadPath(): string {
  return join(__dirname, 'preload.js');
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Agent Dashboard',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // we need node-pty access from preload-adjacent main; renderer stays isolated
    },
  });

  window.once('ready-to-show', () => window.show());

  // Open external links in the user's browser, never in the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  registerPtyIpc(window, ptyManager);

  if (isDev) {
    await window.loadURL('http://localhost:3000');
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    await window.loadFile(join(__dirname, '..', '..', 'renderer', 'out', 'index.html'));
  }

  return window;
}

// Enforce single instance — second launch focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [first] = BrowserWindow.getAllWindows();
    if (first) {
      if (first.isMinimized()) first.restore();
      first.focus();
    }
  });

  app.whenReady().then(() => {
    void createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  });

  // macOS: keep app alive when all windows close (subscribing without quitting
  // is enough — Electron only auto-quits when no listener is registered).
  // Other platforms still exit on last-window-closed.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    ptyManager.disposeAll();
  });
}
