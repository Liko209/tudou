import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { PtyManager } from './pty-manager';
import {
  registerPtyIpc,
  registerSessionIpc,
  registerHookIpc,
  registerPreferencesIpc,
  registerFilesIpc,
  registerUpdaterIpc,
  chatsBaseDir,
  rateLimitTracker,
} from './ipc';
import { SessionRegistry, setChatsBaseDir } from './session-registry';
import { inheritShellPath } from './shell-env';
import { SessionPersistence } from './session-persistence';
import { PreferencesStore } from './preferences';
import { HookServer } from './hook-server';
import { HookInstaller, buildHookScript } from './hook-installer';
import { LifecycleManager } from './lifecycle-manager';
import { initUpdater } from './updater';
import { ClaudeAdapter } from './adapters/claude-adapter';
import { CodexAdapter } from './adapters/codex-adapter';

const isDev = process.env.NODE_ENV === 'development';

// Last-resort crash handlers — never let an unhandled error tear down
// Electron silently. We log loudly so the dev/log audit catches it,
// then let the renderer keep running.
process.on('uncaughtException', (err) => {
   
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
   
  console.error('[main] unhandledRejection:', reason);
});
const ptyManager = new PtyManager();
const sessionPersistence = new SessionPersistence(
  join(app.getPath('userData'), 'sessions.json'),
);
const preferencesStore = new PreferencesStore(
  join(app.getPath('userData'), 'preferences.json'),
);
const hookServer = new HookServer(join(app.getPath('userData'), 'instance.json'));
const hookInstaller = new HookInstaller();
const sessionRegistry = new SessionRegistry(
  ptyManager,
  {
    claude: new ClaudeAdapter(),
    codex: new CodexAdapter(),
  },
  sessionPersistence,
);
hookServer.on((payload) => sessionRegistry.applyHookEvent(payload));
let lifecycle: LifecycleManager | null = null;
let persistenceLoaded = false;
let hookServerStarted = false;

function resolvePreloadPath(): string {
  return join(__dirname, 'preload.js');
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Tudou',
    titleBarStyle: 'hiddenInset',
    // Vertically align the traffic lights with the header buttons + title
    // (both centered in the 48px h-12 top bar). Tuned visually: the lights'
    // positioning box sits lower than the 12px dot suggests, so this is a
    // few px above dead-center math.
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // we need node-pty access from preload-adjacent main; renderer stays isolated
      // Let us play the session sound cues programmatically — Chromium
      // otherwise blocks audio.play() until a user gesture.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Preferred show path — fires after the first non-empty paint, so
  // there's no white flash. But under some launch contexts (Finder /
  // Launchpad on macOS with packaged builds) this event doesn't fire,
  // leaving the window invisible while the dock icon hangs. The
  // post-load fallback below catches that case.
  window.once('ready-to-show', () => window.show());

  // Open external links in the user's browser, never in the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  registerPtyIpc(window, ptyManager);
  registerSessionIpc(window, sessionRegistry, preferencesStore);
  registerHookIpc(hookInstaller, hookServer);

  // Auto-upgrade an existing hook install in place: if the user previously
  // installed the hook but a newer app version added events (e.g.
  // PermissionRequest), top up ~/.claude/settings.json so the new status
  // signals work without the user having to hit "Reinstall" manually. Only
  // touches installs that already opted in (some events present) — never
  // injects hooks for users who never set them up.
  try {
    const status = hookInstaller.getStatus();
    if (!status.fullyInstalled && (status.scriptInstalled || status.registeredEvents.length > 0)) {
      hookInstaller.install(buildHookScript(hookServer.instancePath));
    }
  } catch (err) {
    console.error('[main] hook auto-upgrade failed:', err);
  }
  registerPreferencesIpc(preferencesStore, sessionPersistence);
  registerFilesIpc();
  registerUpdaterIpc();

  if (!lifecycle) {
    lifecycle = new LifecycleManager(window, sessionRegistry, preferencesStore, rateLimitTracker, {
      preloadPath: resolvePreloadPath(),
      load: (pop) => {
        if (isDev) void pop.loadURL('http://localhost:3000/tray');
        else void pop.loadFile(join(__dirname, '..', '..', 'renderer', 'out', 'tray.html'));
      },
    });
  }
  initUpdater(window);

  if (isDev) {
    await window.loadURL('http://localhost:3000');
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    await window.loadFile(join(__dirname, '..', '..', 'renderer', 'out', 'index.html'));
  }

  // Fallback show: by the time loadFile/loadURL resolves the DOM is
  // ready, so if ready-to-show silently skipped we surface the window
  // here. Cheap: isVisible() is a no-op on already-shown windows.
  if (!window.isVisible() && !window.isDestroyed()) {
    window.show();
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

  app.whenReady().then(async () => {
    // Pull the user's interactive shell PATH into process.env BEFORE
    // anything tries to resolve / spawn CLIs. Finder-launched apps
    // otherwise only see launchd's minimal PATH and can't find claude
    // / codex / node / git installed via nvm or brew.
    await inheritShellPath();

    if (!persistenceLoaded) {
      await sessionPersistence.load();
      preferencesStore.load();
      // Tell SessionRegistry where ad-hoc Chat working dirs live so it can
      // pick the right autoName (Chat dirs lead with the CLI name; Project
      // dirs lead with basename(cwd)). Also export to env so the preload
      // layer can give the renderer the same value.
      const chatsDir = chatsBaseDir();
      setChatsBaseDir(chatsDir);
      process.env.AGENT_DASHBOARD_CHATS_DIR = chatsDir;
      persistenceLoaded = true;
    }
    if (!hookServerStarted) {
      try {
        await hookServer.start();
      } catch (err) {
         
        console.error('[main] hook server failed to start:', err);
      }
      hookServerStarted = true;
    }
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

  app.on('will-quit', () => {
    // SessionPersistence writes synchronously on every mutation, so
    // there's nothing to flush here — just tear down the live state.
    lifecycle?.dispose();
    sessionRegistry.disposeAll();
    void hookServer.stop();
  });
}
