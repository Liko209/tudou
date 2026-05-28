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

const TRAY_LABEL_IDLE = 'AD';
const TRAY_LABEL_LIVE = (waitingCount: number, totalCount: number): string => {
  if (waitingCount > 0) return `● ${waitingCount}`;
  return `${TRAY_LABEL_IDLE} · ${totalCount}`;
};

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
  ) {
    registry.on('add', (s) => this.onAdd(s));
    registry.on('update', (s) => this.onUpdate(s));
    registry.on('remove', ({ id }) => this.onRemove(id));

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

    // working → waiting is the "wake the user up" transition.
    if (prev && prev !== 'waiting' && session.status === 'waiting') {
      this.notifyWaiting(session);
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
    const waiting = sessions.filter((s) => s.status === 'waiting');
    const working = sessions.filter((s) => s.status === 'working');

    // Dock badge: just the waiting count (empty when 0).
    if (app.dock) {
      app.dock.setBadge(waiting.length > 0 ? String(waiting.length) : '');
    }

    // Tray title + menu reflect live state.
    if (this.tray) {
      this.tray.setTitle(
        sessions.length === 0 ? TRAY_LABEL_IDLE : TRAY_LABEL_LIVE(waiting.length, sessions.length),
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

  private notifyWaiting(session: Session): void {
    // System notification fires every time. On macOS the notification
    // already plays its banner sound unless silent: true; we play it
    // only when the user isn't actively looking at our window.
    const isForeground = this.window.isFocused() && !this.window.isMinimized();
    const notification = new Notification({
      title: `${session.displayName} needs your input`,
      body: session.latestMessage?.preview ?? 'Waiting for input',
      silent: isForeground,
    });
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
    // Empty NativeImage + setTitle lets us avoid shipping a PNG asset for
    // M6 — macOS shows just the text label in the menubar. We'll swap in
    // a proper template icon during M9 polish.
    const icon = nativeImage.createEmpty();
    const tray = new Tray(icon);
    tray.setIgnoreDoubleClickEvents(true);
    tray.on('click', () => {
      if (this.window.isDestroyed()) return;
      if (this.window.isVisible() && this.window.isFocused()) {
        this.window.hide();
      } else {
        this.focusSession('');
      }
    });
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
    if (this.quitConfirmed) return;
    const live = this.registry
      .list()
      .filter((s) => s.status === 'working' || s.status === 'waiting');
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
