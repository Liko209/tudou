import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  screen,
} from 'electron';
import type { Session, SessionStatus } from '../shared/session-types';
import { IpcChannels, type TrayView } from '../shared/ipc-contracts';
import type { SessionRegistry } from './session-registry';
import type { PreferencesStore } from './preferences';
import type { RateLimitTracker } from './statusline-installer';
import { TRAY_ICON_DATA_URL_1X, TRAY_ICON_DATA_URL_2X } from './tray-icon';
import { buildTrayModel, type TrayItem, type TrayModel } from './tray-model';
import { isInstalling } from './updater';
import { isRelaunching } from './app-control';
import { decideSound } from './sound-policy';
import { SOUND_OFF } from '../shared/sound-catalog';

/** Glyph prefix per status for the native menu item rows. */
const STATUS_GLYPH: Partial<Record<SessionStatus, string>> = {
  blocked: '🔔',
  errored: '⚠️',
  working: '●',
  starting: '○',
  waiting: '✓',
};

/** Session is parked on the user: free/your-turn ('waiting') or stuck ('blocked'). */
function needsAttention(status: SessionStatus): boolean {
  return status === 'waiting' || status === 'blocked';
}

// Amber the "needs you" icon is tinted with (warning/amber-500).
const ATTENTION_RGB = { r: 245, g: 158, b: 11 };

/**
 * Build the amber "attention" tray icon by tinting the template silhouette —
 * every non-transparent pixel becomes amber, alpha preserved. Returned as a
 * NON-template image so macOS shows the colour (template images are recolored
 * to the menubar). Best-effort: returns the original on any failure so the tray
 * never breaks. Electron's toBitmap() is BGRA, premultiplied by alpha.
 */
function makeAttentionIcon(base: Electron.NativeImage): Electron.NativeImage {
  const tint = (buf: Buffer): void => {
    for (let i = 0; i < buf.length; i += 4) {
      const f = (buf[i + 3] ?? 0) / 255; // premultiply by alpha
      buf[i] = Math.round(ATTENTION_RGB.b * f); // B
      buf[i + 1] = Math.round(ATTENTION_RGB.g * f); // G
      buf[i + 2] = Math.round(ATTENTION_RGB.r * f); // R
    }
  };
  try {
    const { width, height } = base.getSize();
    const b1 = base.toBitmap();
    tint(b1);
    const img = nativeImage.createFromBitmap(b1, { width, height });
    try {
      const b2 = base.toBitmap({ scaleFactor: 2 });
      tint(b2);
      img.addRepresentation({ scaleFactor: 2, width: width * 2, height: height * 2, buffer: b2 });
    } catch {
      // no @2x rep — 1x is fine
    }
    return img;
  } catch {
    return base;
  }
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
/** How the popover window is created — supplied by main (knows dev vs packaged). */
export interface PopoverConfig {
  preloadPath: string;
  /** Load the `tray/` route into the popover (dev URL vs packaged file). */
  load: (win: BrowserWindow) => void;
}

export class LifecycleManager {
  private tray: Tray | null = null;
  private idleIcon: Electron.NativeImage | null = null;
  private attentionIcon: Electron.NativeImage | null = null;
  private currentVariant: 'idle' | 'attention' | null = null;
  private popover: BrowserWindow | null = null;
  private popoverLastHideAt = 0;
  private powerSaveBlockerId: number | null = null;
  private prevStatus = new Map<string, SessionStatus>();
  /** Whether the user has already confirmed Cmd+Q this session. */
  private quitConfirmed = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly registry: SessionRegistry,
    private readonly preferences: PreferencesStore,
    private readonly rateLimits?: RateLimitTracker,
    private readonly popoverConfig?: PopoverConfig,
  ) {
    // Popover → main actions (drive the main window, dismiss the popover).
    ipcMain.handle(IpcChannels.trayFocusSession, (_e, id: string) => {
      this.focusSession(id);
      this.hidePopover();
    });
    ipcMain.handle(IpcChannels.trayOpenView, (_e, view: TrayView) => {
      this.openView(view);
      this.hidePopover();
    });
    ipcMain.handle(IpcChannels.trayClosePopover, () => this.hidePopover());

    registry.on('add', (s) => this.onAdd(s));
    registry.on('update', (s) => this.onUpdate(s));
    registry.on('remove', ({ id }) => this.onRemove(id));
    // Hook-confirmed end-of-turn / needs-permission — the only moments we
    // want a notification. (Status flicker between tool calls does not.)
    registry.on('attention', (s) => this.notify(s));

    app.on('before-quit', (e) => this.onBeforeQuit(e));

    // The "Show/Hide window" menu label depends on window visibility, which can
    // change with no session event — refresh the tray on those transitions too.
    const onWindowChange = (): void => this.refreshTray();
    this.window.on('show', onWindowChange);
    this.window.on('hide', onWindowChange);
    this.window.on('minimize', onWindowChange);
    this.window.on('restore', onWindowChange);
    this.window.on('focus', onWindowChange);
    this.window.on('blur', onWindowChange);

    this.installTray();
    this.refreshAll();
  }

  dispose(): void {
    if (this.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.powerSaveBlockerId = null;
    }
    if (this.popover && !this.popover.isDestroyed()) {
      this.popover.destroy();
      this.popover = null;
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
    const prefs = this.preferences.get();
    const model = buildTrayModel(sessions);

    // Dock badge: count of sessions NEEDING YOU (blocked) — not every idle one.
    // A finished/'waiting' session is your turn but not urgent; the badge is
    // reserved for "something is stuck waiting on your decision".
    if (app.dock) {
      const show = prefs.notifications.dockBadge && model.interventionCount > 0;
      app.dock.setBadge(show ? String(model.interventionCount) : '');
    }

    this.updateTray(model);

    // PowerSaveBlocker on while anything is working (model thinking, tool
    // running). Off otherwise so the user's mac can sleep when truly idle.
    const shouldBlock = model.counts.working > 0;
    if (shouldBlock && this.powerSaveBlockerId === null) {
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!shouldBlock && this.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.powerSaveBlockerId = null;
    }
  }

  /** Recompute + repaint just the tray (icon, title, tooltip, menu). Cheap;
   *  called on window show/hide so the Show/Hide label never goes stale. */
  private refreshTray(): void {
    if (!this.tray) return;
    this.updateTray(buildTrayModel(this.registry.list()));
  }

  private updateTray(model: TrayModel): void {
    if (!this.tray) return;
    const prefs = this.preferences.get();

    // Icon: amber attention variant when a session needs you, else the quiet
    // template icon. Only swap when the variant actually changes.
    if (this.currentVariant !== model.iconVariant) {
      const icon = model.iconVariant === 'attention' ? this.attentionIcon : this.idleIcon;
      if (icon) this.tray.setImage(icon);
      this.currentVariant = model.iconVariant;
    }

    // Number beside the icon = sessions needing you (blocked), if enabled.
    const showCount = prefs.notifications.tray && model.interventionCount > 0;
    this.tray.setTitle(showCount ? String(model.interventionCount) : '');
    this.tray.setToolTip(model.tooltip);
  }

  // ---- companion popover ----

  private ensurePopover(): BrowserWindow | null {
    if (!this.popoverConfig) return null;
    if (this.popover && !this.popover.isDestroyed()) return this.popover;
    const pop = new BrowserWindow({
      width: 360,
      height: 480,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      transparent: true,
      backgroundColor: '#00000000',
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      hasShadow: true,
      webPreferences: {
        preload: this.popoverConfig.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    pop.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    pop.on('blur', () => this.hidePopover());
    pop.on('closed', () => {
      this.popover = null;
    });
    this.popoverConfig.load(pop);
    this.popover = pop;
    return pop;
  }

  private togglePopover(): void {
    const pop = this.ensurePopover();
    if (!pop) return;
    if (pop.isVisible()) {
      this.hidePopover();
      return;
    }
    // If the popover just hid via blur (because the user clicked the tray while
    // it was open), don't immediately re-open on the same click.
    if (Date.now() - this.popoverLastHideAt < 250) return;
    this.positionPopover(pop);
    pop.show();
    pop.focus();
  }

  private hidePopover(): void {
    if (this.popover && !this.popover.isDestroyed() && this.popover.isVisible()) {
      this.popover.hide();
      this.popoverLastHideAt = Date.now();
    }
  }

  /** Center the popover under the tray icon, clamped to the display work area. */
  private positionPopover(pop: BrowserWindow): void {
    if (!this.tray) return;
    const t = this.tray.getBounds();
    const w = pop.getBounds();
    const wa = screen.getDisplayNearestPoint({ x: t.x, y: t.y }).workArea;
    let x = Math.round(t.x + t.width / 2 - w.width / 2);
    x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w.width - 8));
    const y = Math.round(t.y + t.height + 6);
    pop.setPosition(x, y, false);
  }

  private notify(session: Session): void {
    const prefs = this.preferences.get();
    const quiet = this.preferences.isQuietHoursNow();
    const isForeground = this.window.isFocused() && !this.window.isMinimized();

    // Sound cue — decided independently of the visual banner toggle below, so
    // the user can keep sounds on with banners off (or vice versa). A cue id of
    // SOUND_OFF means that cue is disabled.
    const completeId = prefs.notifications.soundCompleteId;
    const alertId = prefs.notifications.soundAlertId;
    const soundKind = decideSound({
      status: session.status,
      soundComplete: completeId !== SOUND_OFF,
      soundAlert: alertId !== SOUND_OFF,
      isQuietHours: quiet,
      isForeground,
      isActiveSession: this.registry.activeSession === session.id,
    });
    if (soundKind && !this.window.isDestroyed()) {
      const id = soundKind === 'complete' ? completeId : alertId;
      this.window.webContents.send(IpcChannels.soundPlay, { kind: soundKind, id });
    }

    // Visual banner — gated by its own toggle.
    if (!prefs.notifications.systemNotification) return;
    if (quiet) return;

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

    // Always silent — sound is handled by our own cue above (decideSound),
    // so the OS notification never double-beeps.
    const notification = new Notification({ title, body, silent: true });
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
    this.idleIcon = icon;
    this.attentionIcon = makeAttentionIcon(icon);

    const tray = new Tray(icon);
    this.currentVariant = 'idle';
    tray.setToolTip('Tudou');
    tray.setIgnoreDoubleClickEvents(true);
    // Click model: left-click opens the popover panel (if configured),
    // right-click / ctrl-click opens the classic menu. No permanent context
    // menu, so left-click stays ours; the menu is built fresh on each popup
    // (always current — and the Show/Hide label never goes stale).
    tray.on('click', () => {
      if (this.popoverConfig) this.togglePopover();
      else this.popUpMenu();
    });
    tray.on('right-click', () => this.popUpMenu());
    this.tray = tray;
  }

  private popUpMenu(): void {
    this.tray?.popUpContextMenu(this.buildTrayMenu(buildTrayModel(this.registry.list())));
  }

  private buildTrayMenu(model: TrayModel): Menu {
    const { total } = model.counts;
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: `Tudou — ${total} session${total === 1 ? '' : 's'}`, enabled: false },
      { type: 'separator' },
    ];

    const rl = this.rateLimitSummary();
    if (rl) items.push({ label: rl, enabled: false }, { type: 'separator' });

    for (const group of model.groups) {
      items.push({ label: group.title, enabled: false });
      for (const it of group.items) items.push(this.sessionMenuItem(it));
      items.push({ type: 'separator' });
    }

    const prefs = this.preferences.get();
    items.push(
      { label: 'New session', click: () => this.openView('newSession') },
      { label: 'Open Usage', click: () => this.openView('usage') },
      { label: 'Open Settings', click: () => this.openView('settings') },
      { type: 'separator' },
      {
        label: 'Quiet hours',
        type: 'checkbox',
        checked: prefs.quietHours.enabled,
        click: () => this.toggleQuietHours(),
      },
      {
        label: 'Notification banners',
        type: 'checkbox',
        checked: prefs.notifications.systemNotification,
        click: () => this.toggleBanners(),
      },
      { type: 'separator' },
      { label: this.window.isVisible() ? 'Hide window' : 'Show window', click: () => this.toggleWindow() },
      { label: 'Quit Tudou', click: () => app.quit() },
    );

    return Menu.buildFromTemplate(items);
  }

  private toggleQuietHours(): void {
    const p = this.preferences.get();
    this.preferences.setAll({ ...p, quietHours: { ...p.quietHours, enabled: !p.quietHours.enabled } });
    this.refreshAll();
  }

  private toggleBanners(): void {
    const p = this.preferences.get();
    this.preferences.setAll({
      ...p,
      notifications: { ...p.notifications, systemNotification: !p.notifications.systemNotification },
    });
    this.refreshAll();
  }

  /** One clickable session row (macOS shows `sublabel` as dimmed detail). */
  private sessionMenuItem(it: TrayItem): Electron.MenuItemConstructorOptions {
    const glyph = STATUS_GLYPH[it.status] ?? '';
    return {
      label: `${glyph}  ${it.name}`,
      sublabel: it.sublabel,
      click: () => this.focusSession(it.id),
    };
  }

  /** Compact "5h 15% · weekly 3%" line, or null when unavailable / not enabled. */
  private rateLimitSummary(): string | null {
    const data = this.rateLimits?.read();
    if (!data) return null;
    const parts: string[] = [];
    if (data.fiveHour) parts.push(`5h ${Math.round(data.fiveHour.usedPercentage)}%`);
    if (data.sevenDay) parts.push(`weekly ${Math.round(data.sevenDay.usedPercentage)}%`);
    return parts.length ? `Rate limits — ${parts.join(' · ')}` : null;
  }

  private toggleWindow(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isVisible() && this.window.isFocused()) {
      this.window.hide();
    } else {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
    }
  }

  /** Raise the window and ask the renderer to open a top-level view. */
  private openView(view: TrayView): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    this.window.webContents.send(IpcChannels.uiOpen, view);
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
