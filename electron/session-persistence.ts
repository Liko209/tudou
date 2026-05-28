import { readFile } from 'node:fs/promises';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CliKind } from '../shared/ipc-contracts';

/**
 * The slice of a Session that survives a dashboard restart. Live state
 * (status, metrics, latestMessage) is rebuilt from the CLI's own JSONL
 * on resume — we don't duplicate it here.
 */
export interface PersistedSession {
  /** Dashboard-internal UUID. New on every spawn, even for resumes. */
  id: string;
  cli: CliKind;
  /** CLI-native session id; null until the adapter discovers it. */
  cliSessionId: string | null;
  cwd: string;
  displayName: string;
  startedAt: string;
  /** ISO timestamp used for 30-day GC at load time. */
  lastSeenAt: string;
}

interface PersistedFile {
  version: 1;
  sessions: PersistedSession[];
}

const SCHEMA_VERSION = 1;
const GC_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Atomic JSON store for PersistedSession records. Writes synchronously
 * on every mutation — sessions are infrequent, JSON is tiny, and we
 * absolutely cannot rely on `before-quit` hooks firing (SIGTERM from
 * `npm run dev` Ctrl+C bypasses them; Electron crashes do too). Sync
 * writes make every mutation immediately durable.
 */
export class SessionPersistence {
  private records = new Map<string, PersistedSession>();

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Load the on-disk store into memory, applying GC. Returns the kept
   * records (after GC) in their original insertion order.
   */
  async load(): Promise<PersistedSession[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (e: unknown) {
      if (isErrno(e) && e.code === 'ENOENT') return [];
      throw e;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!isPersistedFile(parsed)) return [];

    const cutoff = this.now().getTime() - GC_THRESHOLD_MS;
    const kept: PersistedSession[] = [];
    let dropped = 0;
    for (const s of parsed.sessions) {
      if (!isValidSession(s)) {
        dropped += 1;
        continue;
      }
      const seen = Date.parse(s.lastSeenAt);
      if (Number.isFinite(seen) && seen < cutoff) {
        dropped += 1;
        continue;
      }
      this.records.set(s.id, s);
      kept.push(s);
    }
    if (dropped > 0) this.writeNow();
    return kept;
  }

  list(): PersistedSession[] {
    return [...this.records.values()];
  }

  get(id: string): PersistedSession | null {
    return this.records.get(id) ?? null;
  }

  /** Insert or update one record. Persisted immediately. */
  upsert(session: Omit<PersistedSession, 'lastSeenAt'> & { lastSeenAt?: string }): void {
    const lastSeenAt = session.lastSeenAt ?? this.now().toISOString();
    this.records.set(session.id, { ...session, lastSeenAt });
    this.writeNow();
  }

  /** Patch fields on an existing record (no-op if id unknown). */
  patch(id: string, patch: Partial<Omit<PersistedSession, 'id'>>): void {
    const existing = this.records.get(id);
    if (!existing) return;
    const next: PersistedSession = {
      ...existing,
      ...patch,
      lastSeenAt: patch.lastSeenAt ?? this.now().toISOString(),
    };
    this.records.set(id, next);
    this.writeNow();
  }

  remove(id: string): void {
    if (this.records.delete(id)) this.writeNow();
  }

  /** Remove any record matching the CLI + cliSessionId. */
  removeByCliSessionId(cli: CliKind, cliSessionId: string): void {
    let removedAny = false;
    for (const [id, rec] of this.records) {
      if (rec.cli === cli && rec.cliSessionId === cliSessionId) {
        this.records.delete(id);
        removedAny = true;
      }
    }
    if (removedAny) this.writeNow();
  }

  private writeNow(): void {
    const file: PersistedFile = {
      version: SCHEMA_VERSION,
      sessions: [...this.records.values()],
    };
    const tmpPath = `${this.filePath}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(tmpPath, JSON.stringify(file, null, 2), { mode: 0o600 });
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Don't crash the dashboard on a transient write failure — log
      // and continue. The next mutation will retry.
       
      console.error('[session-persistence] write failed:', err);
    }
  }
}

// ---- helpers ----

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPersistedFile(v: unknown): v is PersistedFile {
  return isRecord(v) && v.version === SCHEMA_VERSION && Array.isArray(v.sessions);
}

function isValidSession(v: unknown): v is PersistedSession {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    (v.cli === 'claude' || v.cli === 'codex') &&
    (v.cliSessionId === null || typeof v.cliSessionId === 'string') &&
    typeof v.cwd === 'string' &&
    typeof v.displayName === 'string' &&
    typeof v.startedAt === 'string' &&
    typeof v.lastSeenAt === 'string'
  );
}
