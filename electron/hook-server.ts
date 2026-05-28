import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Payload as Claude Code passes it to hook commands via stdin.
 * Only fields we currently care about are typed; extras pass through.
 */
export interface ClaudeHookPayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  // … claude passes more — transcript_path, etc. — we ignore them
}

export type HookListener = (payload: ClaudeHookPayload) => void;

/**
 * Local 127.0.0.1 HTTP server that receives hook events from the
 * dashboard's shell-script hook. Token-authenticated; ignores anything
 * without the matching bearer.
 *
 * Owns the on-disk instance.json so the hook script can discover the
 * port + token without IPC.
 */
export class HookServer {
  private server: Server | null = null;
  private listeners = new Set<HookListener>();
  private _port = 0;
  private _token = '';

  constructor(private readonly instanceFilePath: string) {}

  get port(): number {
    return this._port;
  }
  get token(): string {
    return this._token;
  }
  get instancePath(): string {
    return this.instanceFilePath;
  }

  on(callback: HookListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Start listening + write the instance.json. Idempotent. */
  async start(): Promise<{ port: number; token: string }> {
    if (this.server) return { port: this._port, token: this._token };
    this._token = randomBytes(24).toString('hex');

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr !== 'object' || !addr) {
          reject(new Error('hook-server: failed to bind 127.0.0.1'));
          return;
        }
        this._port = addr.port;
        this.server = server;
        this.writeInstanceFile();
        resolve({ port: this._port, token: this._token });
      });
    });
  }

  async stop(): Promise<void> {
    this.removeInstanceFile();
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  // ---- private ----

  private writeInstanceFile(): void {
    const payload = {
      pid: process.pid,
      port: this._port,
      token: this._token,
      startedAt: new Date().toISOString(),
    };
    try {
      mkdirSync(dirname(this.instanceFilePath), { recursive: true });
      writeFileSync(this.instanceFilePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    } catch (err) {
      // Don't crash the server on FS errors — hook just won't be discoverable.
       
      console.error('[hook-server] failed to write instance file:', err);
    }
  }

  private removeInstanceFile(): void {
    try {
      rmSync(this.instanceFilePath, { force: true });
    } catch {
      // Ignore — file may already be gone.
    }
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${this._token}`) {
      res.writeHead(403).end();
      return;
    }

    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        // Defensive: hook payloads should be tiny; reject anything wild.
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object') {
          for (const listener of this.listeners) {
            try {
              listener(parsed);
            } catch {
              // listener errors must not crash the server
            }
          }
        }
      } catch {
        // bad JSON — silently drop
      }
      res.writeHead(204).end();
    });
    req.on('error', () => {
      try {
        res.writeHead(400).end();
      } catch {
        /* response may already be sent */
      }
    });
  }
}
