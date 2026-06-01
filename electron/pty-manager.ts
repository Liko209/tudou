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
 * Cap on per-PTY scrollback retained for renderer-reload restore.
 * 256 KB is ~3 000 lines of typical CLI output — enough to repopulate
 * a fresh xterm with recent context after a ⌘R without holding more
 * memory than necessary for long-running sessions.
 */
const SCROLLBACK_CAP_CHARS = 256 * 1024;

/**
 * Owns all PTY child processes for the dashboard.
 *
 * Pure logic — no Electron IPC here. The IPC layer (electron/ipc.ts)
 * adapts this manager to ipcMain/ipcRenderer so the manager stays
 * unit-testable under plain Node.
 */
export class PtyManager extends EventEmitter<PtyManagerEvents> {
  private sessions = new Map<string, pty.IPty>();
  /**
   * Per-PTY ring of recent raw output bytes. Used to repopulate a
   * fresh xterm after the renderer reloads (⌘R) — the PTY in main
   * survives the reload but the renderer's xterm starts blank,
   * losing all visible scrollback. We replay this buffer on reconnect.
   */
  private buffers = new Map<string, string>();

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

    this.buffers.set(id, '');

    proc.onData((data) => {
      const prev = this.buffers.get(id) ?? '';
      const next = prev + data;
      this.buffers.set(
        id,
        next.length > SCROLLBACK_CAP_CHARS
          ? next.slice(next.length - SCROLLBACK_CAP_CHARS)
          : next,
      );
      this.emit('data', { id, data });
    });
    proc.onExit(({ exitCode, signal }) => {
      this.emit('exit', { id, exitCode, signal: signal ?? null });
      this.sessions.delete(id);
      this.buffers.delete(id);
    });

    this.sessions.set(id, proc);
    return id;
  }

  /** Snapshot of recent PTY output for renderer-reload restore. */
  getBuffer(id: string): string {
    return this.buffers.get(id) ?? '';
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
    this.buffers.clear();
  }
}
