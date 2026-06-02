// IPC contracts shared between Electron main and renderer processes.

export type CliKind = 'claude' | 'codex'; // gemini Phase 2

export interface PtySpawnOptions {
  /** Absolute path to the executable to spawn (resolve via login-shell probe). */
  shell: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface PtyDataEvent {
  id: string;
  data: string;
}

export interface PtyExitEvent {
  id: string;
  exitCode: number;
  signal: number | null;
}

export const IpcChannels = {
  // Low-level PTY stream (used by xterm component for write/data/resize).
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyList: 'pty:list',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',

  // High-level Session orchestration (M4+).
  sessionList: 'session:list',
  sessionSpawn: 'session:spawn',
  sessionKill: 'session:kill',
  sessionForget: 'session:forget',
  sessionRelease: 'session:release',
  sessionRename: 'session:rename',
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionScrollback: 'session:scrollback',
  sessionListResumable: 'session:list-resumable',
  sessionListPrevious: 'session:list-previous',
  sessionDismissPrevious: 'session:dismiss-previous',
  sessionDismissAllPrevious: 'session:dismiss-all-previous',
  cliResolvePath: 'cli:resolve-path',
  dialogPickDirectory: 'dialog:pick-directory',

  /** Relaunch the app (e.g. to apply a theme change cleanly). */
  appRelaunch: 'app:relaunch',

  /** Scan CLI JSONL transcripts for aggregated historical usage. */
  usageGetHistory: 'usage:get-history',
  /** Read the captured rate-limit snapshot + tracker status. */
  usageGetRateLimits: 'usage:get-rate-limits',
  /** Enable/disable the opt-in rate-limit statusLine capture. */
  usageToggleRateLimits: 'usage:toggle-rate-limits',

  // Hook installer (M7)
  /** Sync ~/.claude/settings.json `theme` to match the dashboard. */
  claudeSetTheme: 'claude:set-theme',

  hookGetStatus: 'hook:get-status',
  hookInstall: 'hook:install',
  hookUninstall: 'hook:uninstall',
  hookGetManualSnippet: 'hook:get-manual-snippet',

  // Preferences / Settings (M9 F9.4)
  preferencesGet: 'preferences:get',
  preferencesSet: 'preferences:set',
  preferencesReset: 'preferences:reset',
  preferencesClearSessions: 'preferences:clear-sessions',

  /** Test reachability through a proxy URL (used by the Network settings). */
  networkTestProxy: 'network:test-proxy',

  // Files panel (P3)
  filesList: 'files:list',
  filesPreview: 'files:preview',

  // Auto-update (electron-updater → GitHub Releases)
  updateGetState: 'update:get-state',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  /** Push channel — main → renderer when the updater state changes. */
  updateState: 'update:state',

  /** Renderer → main: report which session the user is currently viewing, so
   *  main can suppress the sound cue for the session you're already watching. */
  sessionSetActive: 'session:set-active',

  // Companion popover (the menu-bar mini panel) → main.
  /** Focus a session in the main window (raises it) + close the popover. */
  trayFocusSession: 'tray:focus-session',
  /** Open a top-level view in the main window + close the popover. */
  trayOpenView: 'tray:open-view',
  /** Close (hide) the popover. */
  trayClosePopover: 'tray:close-popover',

  // Push channels — main → renderer.
  sessionAdd: 'session:add',
  sessionUpdate: 'session:update',
  sessionRemove: 'session:remove',
  sessionData: 'session:data',
  sessionFocus: 'session:focus',
  /** Push channel — main → renderer: play a short sound cue. */
  soundPlay: 'sound:play',
  /** Push channel — main → renderer: open a top-level view (from the tray). */
  uiOpen: 'ui:open',
} as const;

/** Sound cue kinds played on session state changes. */
export type SoundKind = 'complete' | 'alert';

/** Top-level views the tray can ask the renderer to open. */
export type TrayView = 'usage' | 'settings' | 'newSession';

/** Payload for the `soundPlay` push — which cue, and which chosen sound file. */
export interface SoundPlayPayload {
  kind: SoundKind;
  /** Catalog id (see shared/sound-catalog); resolves to `<kind>-<id>.wav`. */
  id: string;
}

export interface SessionDataPushPayload {
  sessionId: string;
  data: string;
}

export interface SessionSpawnRequest {
  cli: CliKind;
  /**
   * Working dir for the CLI. Required when `chat` is false (project mode);
   * ignored when `chat` is true (main generates a hidden per-chat dir).
   */
  cwd?: string;
  /**
   * Treat this spawn as an ad-hoc "chat" not tied to any project.
   * Main allocates a unique hidden working dir for it.
   */
  chat?: boolean;
  /**
   * Mark as a panel-only session (Side chat). Excluded from the sidebar.
   */
  panelOnly?: boolean;
  cols: number;
  rows: number;
  /**
   * Active dashboard theme at spawn time. Used to set COLORFGBG in the
   * child env so TUIs (Claude Code, Codex CLI) draw their own UI chrome
   * in the matching mode and don't end up rendering dark reverse-video
   * bars on a light dashboard background.
   */
  theme?: 'dark' | 'light';
  spawnArgs?: {
    resume?: string;
    continueLast?: boolean;
    name?: string;
    model?: string;
    effort?: string;
  };
}

/** Renderer → main: probe whether a proxy URL can reach the network. */
export interface ProxyTestRequest {
  url: string;
}

/** Result of a proxy connectivity probe. */
export interface ProxyTestResult {
  /** True when the probe got an HTTP response through the proxy. */
  ok: boolean;
  /** HTTP status code from the probe target, when reachable. */
  status?: number;
  /** Round-trip time in milliseconds, when reachable. */
  ms?: number;
  /** Human-readable failure reason when `ok` is false. */
  error?: string;
}
