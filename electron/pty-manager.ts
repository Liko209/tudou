import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  PtyDataEvent,
  PtyExitEvent,
  PtySpawnOptions,
} from '../shared/ipc-contracts';

interface PtyManagerEvents {
  data: [PtyDataEvent];
  exit: [PtyExitEvent];
}

/**
 * Owns all PTY child processes for the dashboard.
 *
 * Pure logic — no Electron IPC here. The IPC layer (electron/ipc.ts)
 * adapts this manager to ipcMain/ipcRenderer so the manager stays
 * unit-testable under plain Node.
 */
export class PtyManager extends EventEmitter<PtyManagerEvents> {
  private sessions = new Map<string, pty.IPty>();

  spawn(opts: PtySpawnOptions): string {
    const id = randomUUID();
    // When `env` is provided we treat it as authoritative — callers
    // (SessionRegistry) are expected to construct a clean env via
    // env-sanitizer rather than relying on process.env passthrough,
    // which leaks Claude Code / Codex Desktop "I wrap you" env vars
    // into spawned CLIs.
    const proc = pty.spawn(opts.shell, opts.args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env ?? (process.env as Record<string, string>),
    });

    proc.onData((data) => this.emit('data', { id, data }));
    proc.onExit(({ exitCode, signal }) => {
      this.emit('exit', { id, exitCode, signal: signal ?? null });
      this.sessions.delete(id);
    });

    this.sessions.set(id, proc);
    return id;
  }

  write(id: string, data: string): void {
    const proc = this.sessions.get(id);
    if (!proc) throw new Error(`unknown pty session: ${id}`);
    proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.sessions.get(id);
    if (!proc) throw new Error(`unknown pty session: ${id}`);
    proc.resize(cols, rows);
  }

  kill(id: string, signal?: string): void {
    const proc = this.sessions.get(id);
    if (!proc) return;
    proc.kill(signal);
  }

  list(): string[] {
    return Array.from(this.sessions.keys());
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  disposeAll(): void {
    for (const proc of this.sessions.values()) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }
}
