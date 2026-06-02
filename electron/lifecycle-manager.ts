import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  nativeImage,
  powerSaveBlocker,
} from 'electron';
import type { Session, SessionStatus } from '../shared/session-types';
import { IpcChannels } from '../shared/ipc-contracts';
import type { SessionRegistry } from './session-registry';
import type { PreferencesStore } from './preferences';
import { TRAY_ICON_DATA_URL_1X, TRAY_ICON_DATA_URL_2X } from './tray-icon';
import { isInstalling } from './updater';
import { isRelaunching } from './app-control';

// With a real menubar icon present, idle = icon only (no text). Live state
// appends a compact count beside the icon.
const TRAY_LABEL_IDLE = '';
const TRAY_LABEL_LIVE = (waitingCount: number, totalCount: number): string => {
  if (waitingCount > 0) return `● ${waitingCount}`;
  return `${totalCount}`;
};

/** Session is parked on the user: free/your-turn ('waiting') or stuck ('blocked'). */
function needsAttention(status: SessionStatus): boolean {
  return status === 'waiting' || status === 'blocked';
}

/** First non-empty line, whitespace-collapsed and length-capped — keeps a
 *  notification body readable instead of dumping multi-line markdown. */
function oneLine(text: string, max: number): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  const collapsed = line.replace(/\s+/g, ' ');
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/**
 * Coordinates all macOS lifecycle / surface behaviors driven by Session
 * state — Dock badge, menu-bar tray, notifications, power-save blocker,
 * and the Cmd+Q confirm dialog.
 *
 * Observes SessionRegistry events, tracks per-session previous status so
 * we can detect `working → waiting` transitions and fire one notification
 * per transition (not per snapshot update).
 */
export class LifecycleManager {
  private tray: Tray | null = null;
  private powerSaveBlockerId: number | null = null;
  private prevStatus = new Map<string, SessionStatus>();
  /** Whether the user has already confirmed Cmd+Q this session. */
  private quitConfirmed = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly registry: SessionRegistry,
    private readonly preferences: PreferencesStore,
  ) {
    registry.on('add', (s) => this.onAdd(s));
    registry.on('update', (s) => this.onUpdate(s));
    registry.on('remove', ({ id }) => this.onRemove(id));
    // Hook-confirmed end-of-turn / needs-permission — the only moments we
    // want a notification. (Status flicker between tool calls does not.)
    registry.on('attention', (s) => this.notify(s));

    app.on('before-quit', (e) => this.onBeforeQuit(e));

    this.installTray();
    this.refreshAll();
  }

  dispose(): void {
    if (this.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.powerSaveBlockerId = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  // ---- registry handlers ----

  private onAdd(session: Session): void {
    this.prevStatus.set(session.id, session.status);
    this.refreshAll();
  }

  private onUpdate(session: Session): void {
    const prev = this.prevStatus.get(session.id);
    this.prevStatus.set(session.id, session.status);

    // Errors warrant a notification regardless of hooks (they come from the
    // PTY/adapter, not the hook pipeline).
    if (prev && prev !== 'errored' && session.status === 'errored') {
      this.notify(session);
    }
    // Entering a needs-you state (free/your-turn or blocked) is the "wake the
    // user up" transition — but ONLY trust it for sessions without the hook
    // pipeline. When hooks are wired the adapter's status flickers between
    // tool calls; the `attention` event (Stop/Notification) is authoritative
    // and handles notifications instead.
    else if (
      prev &&
      !needsAttention(prev) &&
      needsAttention(session.status) &&
      !this.registry.isHookActive(session.id)
    ) {
      this.notify(session);
    }
    this.refreshAll();
  }

  private onRemove(id: string): void {
    this.prevStatus.delete(id);
    this.refreshAll();
  }

  // ---- side effects ----

  private refreshAll(): void {
    const sessions = this.registry.list();
    const waiting = sessions.filter((s) => needsAttention(s.status));
    const working = sessions.filter((s) => s.status === 'working');
    const prefs = this.preferences.get();

    // Dock badge: count of sessions waiting on the user (empty when 0/disabled).
    if (app.dock) {
      const show = prefs.notifications.dockBadge && waiting.length > 0;
      app.dock.setBadge(show ? String(waiting.length) : '');
    }

    // Tray title + menu reflect live state (always shown if pref allows;
    // disabling the tray entirely is a separate destroy/install action
    // we don't bother with at runtime — title goes to "AD" so it's
    // visually quiet).
    if (this.tray) {
      const showCount = prefs.notifications.tray;
      this.tray.setTitle(
        showCount && sessions.length > 0
          ? TRAY_LABEL_LIVE(waiting.length, sessions.length)
          : TRAY_LABEL_IDLE,
      );
      this.tray.setContextMenu(this.buildTrayMenu(sessions, waiting));
    }

    // PowerSaveBlocker on while anything is working (model thinking, tool
    // running). Off otherwise so the user's mac can sleep when truly idle.
    const shouldBlock = working.length > 0;
    if (shouldBlock && this.powerSaveBlockerId === null) {
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!shouldBlock && this.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.powerSaveBlockerId = null;
    }
  }

  private notify(session: Session): void {
    const prefs = this.preferences.get();
    if (!prefs.notifications.systemNotification) return;
    if (this.preferences.isQuietHoursNow()) return;

    // Status-based copy — no raw transcript/markdown in the body. The user
    // just needs to know WHICH session and WHAT happened.
    const name = session.title || session.displayName;
    let title: string;
    let body: string;
    switch (session.status) {
      case 'blocked':
        title = `${name} needs your decision`;
        body = 'Waiting on a permission or a choice.';
        break;
      case 'errored':
        title = `${name} ran into a problem`;
        body = session.latestMessage?.preview
          ? oneLine(session.latestMessage.preview, 140)
          : 'The session errored.';
        break;
      case 'waiting':
      default:
        title = `${name} finished`;
        body = 'Ready for your next message.';
        break;
    }

    const isForeground = this.window.isFocused() && !this.window.isMinimized();
    const wantSound = prefs.notifications.sound && !isForeground;
    const notification = new Notification({ title, body, silent: !wantSound });
    notification.on('click', () => this.focusSession(session.id));
    notification.show();
  }

  private focusSession(sessionId: string): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    this.window.webContents.send(IpcChannels.sessionFocus, { id: sessionId });
  }

  private installTray(): void {
    // Monochrome template icon (the logo's potato silhouette), embedded as
    // base64 so it survives packaging without a separate asset path
    // (build/ isn't bundled). setTemplateImage(true) lets macOS recolor it
    // to match the menubar, like every other well-behaved menubar icon.
    // @2x representation keeps it crisp on Retina.
    const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL_1X);
    icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_DATA_URL_2X });
    icon.setTemplateImage(true);
    const tray = new Tray(icon);
    tray.setToolTip('Agent Dashboard');
    tray.setIgnoreDoubleClickEvents(true);
    // No click handler: a click just opens the dropdown menu (set below /
    // refreshed on each sync). Toggling the window on raw clicks was
    // confusing — show/hide now lives explicitly in the menu instead.
    tray.setContextMenu(this.buildTrayMenu([], []));
    this.tray = tray;
  }

  private buildTrayMenu(sessions: Session[], waiting: Session[]): Menu {
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: `Agent Dashboard · ${sessions.length} session${sessions.length === 1 ? '' : 's'}`,
        enabled: false,
      },
      { type: 'separator' },
    ];

    if (waiting.length > 0) {
      items.push({
        label: `Waiting for input (${waiting.length})`,
        enabled: false,
      });
      for (const s of waiting) {
        items.push({
          label: `  ${s.displayName}`,
          click: () => this.focusSession(s.id),
        });
      }
      items.push({ type: 'separator' });
    }

    items.push({
      label: this.window.isVisible() ? 'Hide window' : 'Show window',
      click: () => {
        if (this.window.isDestroyed()) return;
        if (this.window.isVisible() && this.window.isFocused()) {
          this.window.hide();
        } else {
          if (this.window.isMinimized()) this.window.restore();
          this.window.show();
          this.window.focus();
        }
      },
    });
    items.push({ label: 'Quit Agent Dashboard', click: () => app.quit() });

    return Menu.buildFromTemplate(items);
  }

  // ---- quit confirm ----

  private onBeforeQuit(e: Electron.Event): void {
    // An update install quits intentionally to relaunch — never block it with
    // the "you have live sessions" confirm, or the swap script can't restart.
    if (this.quitConfirmed || isInstalling() || isRelaunching()) return;
    const live = this.registry
      .list()
      .filter((s) => s.status === 'working' || needsAttention(s.status));
    if (live.length === 0) return;

    e.preventDefault();
    void this.showQuitConfirm(live);
  }

  private async showQuitConfirm(live: Session[]): Promise<void> {
    const detail = live
      .map((s) => `• ${s.displayName} — ${s.cli} (${s.status})`)
      .join('\n');

    const result = await dialog.showMessageBox(this.window, {
      type: 'warning',
      title: 'Quit Agent Dashboard?',
      message: `${live.length} session${live.length === 1 ? '' : 's'} still running.`,
      detail,
      buttons: ['Cancel', 'Quit Anyway'],
      defaultId: 0,
      cancelId: 0,
    });

    if (result.response === 1) {
      this.quitConfirmed = true;
      app.quit();
    }
  }
}
