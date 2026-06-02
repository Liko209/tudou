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

  // Push channels — main → renderer.
  sessionAdd: 'session:add',
  sessionUpdate: 'session:update',
  sessionRemove: 'session:remove',
  sessionData: 'session:data',
  sessionFocus: 'session:focus',
} as const;

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
