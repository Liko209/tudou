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
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyList: 'pty:list',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
} as const;
