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
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionListResumable: 'session:list-resumable',
  sessionListPrevious: 'session:list-previous',
  sessionDismissPrevious: 'session:dismiss-previous',
  sessionDismissAllPrevious: 'session:dismiss-all-previous',
  cliResolvePath: 'cli:resolve-path',
  dialogPickDirectory: 'dialog:pick-directory',

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
  cwd: string;
  cols: number;
  rows: number;
  spawnArgs?: {
    resume?: string;
    continueLast?: boolean;
    name?: string;
    model?: string;
    effort?: string;
  };
}
