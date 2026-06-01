import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import chokidar from 'chokidar';
import { tailJsonl } from './jsonl-tail';
import { estimateCost } from './cost-calculator';
import { maskSecrets } from '../secret-masker';
import type { CliAdapter, SpawnArgsInput } from './types';
import type {
  CurrentTool,
  LatestMessage,
  ResumableSession,
  SessionMetrics,
  SessionStatus,
  SessionUpdate,
} from '../../shared/session-types';

const PREVIEW_MAX = 200;
const ROLLOUT_RE = /^rollout-[\d:T-]+-([0-9a-f-]+)\.jsonl$/i;

export interface CodexAdapterOptions {
  /** Base of ~/.codex. Override for tests. */
  codexHome?: string;
}

export class CodexAdapter implements CliAdapter {
  readonly cli = 'codex' as const;

  private readonly codexHome: string;

  constructor(options: CodexAdapterOptions = {}) {
    this.codexHome = options.codexHome ?? join(homedir(), '.codex');
  }

  buildSpawnArgs(input: SpawnArgsInput): string[] {
    if (input.resume && input.continueLast) {
      throw new Error('codex: continueLast and resume are mutually exclusive');
    }
    if (input.resume) return ['resume', input.resume];
    if (input.continueLast) return ['resume', '--last'];
    // Codex does not honor --name/--model/--effort like Claude — Codex picks
    // model based on its own config. Silently ignore those inputs.
    return [];
  }

  async findFileBySessionId(_cwd: string, sessionId: string): Promise<string | null> {
    // Codex spreads rollout files across sessions/YYYY/MM/DD/ and
    // archived_sessions/, but each file's name embeds the session id.
    return findRolloutById(this.codexHome, sessionId);
  }

  async locateSessionFile(
    cwd: string,
    after: Date,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const sessionsDir = join(this.codexHome, 'sessions');
    const sinceMs = after.getTime() - 1000;

    // Fast path: file may already exist.
    {
      const candidates = await collectRolloutFiles(sessionsDir, sinceMs);
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const { path } of candidates) {
        const meta = await readSessionMeta(path);
        if (meta && meta.cwd === cwd) return path;
      }
    }
    if (signal?.aborted) return null;

    // Pre-create today's date dir(s) so fsevents has a known target.
    // chokidar's macOS fsevents backend cannot reliably report new files
    // inside a directory that didn't exist when the watcher attached;
    // pre-creating sidesteps that. mkdir is idempotent — codex won't
    // notice (it does the same mkdir itself when it writes its rollout).
    for (const d of dateDirCandidates(sessionsDir, new Date())) {
      await mkdir(d, { recursive: true });
    }

    return new Promise<string | null>((resolve) => {
      if (signal?.aborted) return resolve(null);

      const watcher = chokidar.watch(sessionsDir, {
        ignoreInitial: true,
        awaitWriteFinish: false,
      });

      let settled = false;
      const finish = (result: string | null): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        void watcher.close();
        resolve(result);
      };
      const onAbort = (): void => finish(null);
      signal?.addEventListener('abort', onAbort, { once: true });

      watcher.on('add', async (path: string) => {
        if (!ROLLOUT_RE.test(basename(path))) return;
        // codex writes session_meta as the first line; give the writer a few
        // tries since 'add' can fire before the line is flushed.
        for (let i = 0; i < 5; i++) {
          if (settled) return;
          try {
            const st = await stat(path);
            console.log('[codex-locate] stat mtimeMs', st.mtimeMs, 'sinceMs', sinceMs, 'ok?', st.mtimeMs >= sinceMs);
            if (st.mtimeMs < sinceMs) return;
            const meta = await readSessionMeta(path);
            console.log('[codex-locate] meta', meta, 'expecting cwd', cwd);
            if (meta) {
              if (meta.cwd === cwd) {
                finish(path);
              }
              return;
            }
          } catch (err) {
            console.log('[codex-locate] read err', err);
          }
          await new Promise((r) => setTimeout(r, 80));
        }
      });

      watcher.on('error', () => finish(null));
    });
  }

  async *watch(file: string, signal?: AbortSignal): AsyncIterable<SessionUpdate> {
    let cliSessionId: string | null = null;
    let gitBranch: string | null = null;
    const metrics: SessionMetrics = freshMetrics();
    let latestMessage: LatestMessage | null = null;
    let currentTool: CurrentTool | null = null;
    let lastEmittedStatus: SessionStatus | null = null;
    const openCalls = new Map<string, CurrentTool>();

    for await (const raw of tailJsonl(file, { signal })) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isRecord(parsed) || !isRecord(parsed.payload)) continue;

      const timestamp = typeof parsed.timestamp === 'string'
        ? parsed.timestamp
        : new Date().toISOString();
      const payload = parsed.payload;
      const update: SessionUpdate = {};
      let touched = false;

      switch (parsed.type) {
        case 'session_meta': {
          if (typeof payload.id === 'string' && payload.id !== cliSessionId) {
            cliSessionId = payload.id;
            update.cliSessionId = cliSessionId;
            touched = true;
          }
          break;
        }

        case 'turn_context': {
          // turn_context.payload.cwd is per-turn; doesn't give us git branch
          // directly. Leave gitBranch derivation to the registry which can
          // shell out (`git -C cwd branch --show-current`) on the dashboard side.
          break;
        }

        case 'event_msg': {
          const subType = payload.type;

          if (subType === 'task_started') {
            const next: SessionStatus = 'working';
            if (lastEmittedStatus !== next) {
              update.status = next;
              lastEmittedStatus = next;
              touched = true;
            }
          } else if (subType === 'task_complete') {
            const next: SessionStatus = openCalls.size > 0 ? 'working' : 'waiting';
            if (lastEmittedStatus !== next) {
              update.status = next;
              lastEmittedStatus = next;
              touched = true;
            }
          } else if (subType === 'user_message' && typeof payload.message === 'string') {
            metrics.messageCount += 1;
            latestMessage = {
              role: 'user',
              preview: truncate(payload.message, PREVIEW_MAX),
              timestamp,
            };
            update.latestMessage = latestMessage;
            update.metrics = { ...metrics };
            touched = true;
          } else if (subType === 'agent_message' && typeof payload.message === 'string') {
            metrics.messageCount += 1;
            latestMessage = {
              role: 'assistant',
              preview: truncate(payload.message, PREVIEW_MAX),
              timestamp,
            };
            update.latestMessage = latestMessage;
            update.metrics = { ...metrics };
            touched = true;
          } else if (subType === 'token_count') {
            const info = isRecord(payload.info) ? payload.info : null;
            const usage = info && isRecord(info.total_token_usage) ? info.total_token_usage : null;
            if (usage) {
              metrics.tokensInput = numberFrom(usage.input_tokens);
              metrics.tokensCached = numberFrom(usage.cached_input_tokens);
              metrics.tokensOutput =
                numberFrom(usage.output_tokens) + numberFrom(usage.reasoning_output_tokens);
              // Codex's JSONL doesn't expose model name explicitly; default to
              // gpt-5 for cost + display. Users can override later via settings.
              metrics.estimatedCostUSD = estimateCost(
                'gpt-5',
                metrics.tokensInput,
                metrics.tokensCached,
                metrics.tokensOutput,
              );
              update.model = 'gpt-5';
              // Context-window occupancy: Codex reports the window size and
              // the most recent turn's usage directly. Approximate current
              // occupancy as the last turn's prompt (input + cached).
              const ctxWindow = numberFrom(info?.model_context_window);
              const lastRaw = info?.last_token_usage;
              const last = isRecord(lastRaw) ? lastRaw : null;
              if (ctxWindow > 0 && last) {
                metrics.contextLimit = ctxWindow;
                metrics.contextTokens =
                  numberFrom(last.input_tokens) + numberFrom(last.cached_input_tokens);
              }
              update.metrics = { ...metrics };
              touched = true;
            }
          }
          // thread_name_updated — could feed displayName via a future channel; ignored for now
          break;
        }

        case 'response_item': {
          const subType = payload.type;

          if (subType === 'function_call') {
            const callId = typeof payload.call_id === 'string' ? payload.call_id : null;
            const name = typeof payload.name === 'string' ? payload.name : 'unknown';
            let description = '';
            if (typeof payload.arguments === 'string') {
              try {
                const args = JSON.parse(payload.arguments);
                description = extractCodexToolDescription(args);
              } catch {
                /* ignore malformed JSON */
              }
            }
            const tool: CurrentTool = { name, description, startedAt: timestamp };
            if (callId) openCalls.set(callId, tool);
            currentTool = tool;
            update.currentTool = tool;
            touched = true;
          } else if (subType === 'function_call_output') {
            const callId = typeof payload.call_id === 'string' ? payload.call_id : null;
            if (callId) openCalls.delete(callId);
            if (openCalls.size === 0 && currentTool !== null) {
              currentTool = null;
              update.currentTool = null;
              touched = true;
            }
          }
          // message / reasoning / web_search_call — we already harvest the
          // user-facing text from event_msg.agent_message / user_message,
          // so we don't double-process them here.
          break;
        }

        default:
          break;
      }

      // Codex does not record gitBranch in any line we've seen — keep null.
      // The SessionRegistry derives it from cwd via git when needed.
      void gitBranch;

      if (touched) yield update;
    }
  }

  async listResumable(cwd: string): Promise<ResumableSession[]> {
    const indexPath = join(this.codexHome, 'session_index.jsonl');
    let content: string;
    try {
      content = await readFile(indexPath, 'utf8');
    } catch (e: unknown) {
      if (isErrno(e) && e.code === 'ENOENT') return [];
      throw e;
    }

    const indexEntries: Array<{ id: string; thread_name?: string; updated_at?: string }> = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (isRecord(obj) && typeof obj.id === 'string') {
          indexEntries.push({
            id: obj.id,
            thread_name: typeof obj.thread_name === 'string' ? obj.thread_name : undefined,
            updated_at: typeof obj.updated_at === 'string' ? obj.updated_at : undefined,
          });
        }
      } catch {
        // skip malformed line
      }
    }

    const results: ResumableSession[] = [];
    const seenIds = new Set<string>();
    for (const entry of indexEntries) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      const path = await findRolloutById(this.codexHome, entry.id);
      if (!path) continue;
      const meta = await readSessionMeta(path);
      if (!meta || meta.cwd !== cwd) continue;
      results.push({
        cli: 'codex',
        cliSessionId: entry.id,
        firstPrompt: '',
        summary: entry.thread_name ?? null,
        messageCount: 0, // expensive to compute; left at 0 for now
        modified: entry.updated_at ?? '',
        gitBranch: null,
        cwd: meta.cwd,
      });
    }
    results.sort((a, b) => (a.modified < b.modified ? 1 : -1));
    return results;
  }
}

// ---- helpers ----

function freshMetrics(): SessionMetrics {
  return {
    tokensInput: 0,
    tokensOutput: 0,
    tokensCached: 0,
    estimatedCostUSD: null,
    messageCount: 0,
  };
}

function truncate(text: string, max: number): string {
  const masked = maskSecrets(text);
  const flat = masked.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberFrom(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

function extractCodexToolDescription(args: unknown): string {
  if (!isRecord(args)) return '';
  if (typeof args.command === 'string') return args.command;
  if (Array.isArray(args.command)) return args.command.filter((c) => typeof c === 'string').join(' ');
  if (typeof args.cmd === 'string') return args.cmd;
  if (typeof args.file_path === 'string') return args.file_path;
  if (typeof args.description === 'string') return args.description;
  return '';
}

async function readSessionMeta(file: string): Promise<{ id: string; cwd: string } | null> {
  // Stream-read until first \n. Codex's session_meta line bundles the
  // full base_instructions system prompt, which routinely exceeds 20KB —
  // a fixed-size read buffer can't keep up. Cap at 1MB as a sanity guard.
  const MAX_LINE = 1024 * 1024;
  let firstLine = '';
  try {
    const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 16384 });
    for await (const chunk of stream) {
      firstLine += chunk;
      const nl = firstLine.indexOf('\n');
      if (nl >= 0) {
        firstLine = firstLine.slice(0, nl);
        stream.destroy();
        break;
      }
      if (firstLine.length > MAX_LINE) {
        stream.destroy();
        return null;
      }
    }
  } catch {
    return null;
  }
  if (!firstLine) return null;
  try {
    const parsed = JSON.parse(firstLine);
    if (!isRecord(parsed) || parsed.type !== 'session_meta') return null;
    const payload = isRecord(parsed.payload) ? parsed.payload : null;
    if (!payload || typeof payload.id !== 'string' || typeof payload.cwd !== 'string') {
      return null;
    }
    return { id: payload.id, cwd: payload.cwd };
  } catch {
    return null;
  }
}

async function collectRolloutFiles(
  root: string,
  sinceMs: number,
): Promise<Array<{ path: string; mtimeMs: number }>> {
  const results: Array<{ path: string; mtimeMs: number }> = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (isErrno(e) && e.code === 'ENOENT') return;
      throw e;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile() && ROLLOUT_RE.test(ent.name)) {
        try {
          const st = await stat(full);
          if (st.mtimeMs >= sinceMs) {
            results.push({ path: full, mtimeMs: st.mtimeMs });
          }
        } catch {
          // file vanished between readdir and stat — skip
        }
      }
    }
  }
  await walk(root);
  return results;
}

async function findRolloutById(codexHome: string, id: string): Promise<string | null> {
  const roots = [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')];
  for (const root of roots) {
    const found = await searchTreeForId(root, id);
    if (found) return found;
  }
  return null;
}

/**
 * Today's `YYYY/MM/DD` subdirectory under sessionsDir, both in UTC and in
 * local time. Deduplicated — for most timezones they're the same; near
 * midnight UTC they differ and we return both so we cover whichever date
 * codex chooses.
 */
function dateDirCandidates(sessionsDir: string, now: Date): string[] {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const utc = join(
    sessionsDir,
    String(now.getUTCFullYear()),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
  );
  const local = join(
    sessionsDir,
    String(now.getFullYear()),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  );
  return utc === local ? [utc] : [utc, local];
}

async function searchTreeForId(dir: string, id: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (isErrno(e) && e.code === 'ENOENT') return null;
    throw e;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      const found = await searchTreeForId(full, id);
      if (found) return found;
    } else if (ent.isFile() && ent.name.includes(id) && ent.name.endsWith('.jsonl')) {
      return full;
    }
  }
  return null;
}
