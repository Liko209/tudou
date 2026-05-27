import { homedir } from 'node:os';
import { join } from 'node:path';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { tailJsonl } from './jsonl-tail';
import { estimateCost } from './cost-calculator';
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
  locateTimeoutMs?: number;
  locatePollIntervalMs?: number;
}

export class CodexAdapter implements CliAdapter {
  readonly cli = 'codex' as const;

  private readonly codexHome: string;
  private readonly locateTimeoutMs: number;
  private readonly locatePollIntervalMs: number;

  constructor(options: CodexAdapterOptions = {}) {
    this.codexHome = options.codexHome ?? join(homedir(), '.codex');
    this.locateTimeoutMs = options.locateTimeoutMs ?? 5000;
    this.locatePollIntervalMs = options.locatePollIntervalMs ?? 200;
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

  async locateSessionFile(
    cwd: string,
    after: Date,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const sessionsDir = join(this.codexHome, 'sessions');
    const deadline = Date.now() + this.locateTimeoutMs;
    const sinceMs = after.getTime() - 1000; // 1s tolerance for clock skew

    while (Date.now() < deadline) {
      if (signal?.aborted) return null;
      const candidates = await collectRolloutFiles(sessionsDir, sinceMs);
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const { path } of candidates) {
        const meta = await readSessionMeta(path);
        if (meta && meta.cwd === cwd) return path;
      }
      await sleep(this.locatePollIntervalMs);
    }
    return null;
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
              // gpt-5 for cost. Users can override later via dashboard settings.
              metrics.estimatedCostUSD = estimateCost(
                'gpt-5',
                metrics.tokensInput,
                metrics.tokensCached,
                metrics.tokensOutput,
              );
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
  const flat = text.replace(/\s+/g, ' ').trim();
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
  let fh;
  try {
    fh = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    // Read first 16KB — session_meta is always the first line, well under that
    const buf = Buffer.alloc(16 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.slice(0, bytesRead).toString('utf8');
    const newlineIdx = head.indexOf('\n');
    if (newlineIdx < 0) return null;
    const firstLine = head.slice(0, newlineIdx);
    const parsed = JSON.parse(firstLine);
    if (!isRecord(parsed) || parsed.type !== 'session_meta') return null;
    const payload = isRecord(parsed.payload) ? parsed.payload : null;
    if (!payload || typeof payload.id !== 'string' || typeof payload.cwd !== 'string') {
      return null;
    }
    return { id: payload.id, cwd: payload.cwd };
  } catch {
    return null;
  } finally {
    await fh.close();
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
