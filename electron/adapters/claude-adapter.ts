import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { tailJsonl } from './jsonl-tail';
import { estimateCost } from './cost-calculator';
import type { CliAdapter, SpawnArgsInput } from './types';
import type {
  LatestMessage,
  ResumableSession,
  SessionMetrics,
  SessionStatus,
  SessionUpdate,
} from '../../shared/session-types';

const PREVIEW_MAX = 200;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

export interface ClaudeAdapterOptions {
  /** Base of ~/.claude. Override for tests. */
  claudeHome?: string;
  /** How long locateSessionFile polls before giving up. Default 5000ms. */
  locateTimeoutMs?: number;
  /** Poll interval inside locateSessionFile. Default 200ms. */
  locatePollIntervalMs?: number;
}

export class ClaudeAdapter implements CliAdapter {
  readonly cli = 'claude' as const;

  private readonly claudeHome: string;
  private readonly locateTimeoutMs: number;
  private readonly locatePollIntervalMs: number;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.claudeHome = options.claudeHome ?? join(homedir(), '.claude');
    this.locateTimeoutMs = options.locateTimeoutMs ?? 5000;
    this.locatePollIntervalMs = options.locatePollIntervalMs ?? 200;
  }

  buildSpawnArgs(input: SpawnArgsInput): string[] {
    const args: string[] = [];
    if (input.continueLast && input.resume) {
      throw new Error('claude: continueLast and resume are mutually exclusive');
    }
    if (input.continueLast) args.push('-c');
    if (input.resume) args.push('--resume', input.resume);
    if (input.name) args.push('--name', input.name);
    if (input.model) args.push('--model', input.model);
    if (input.effort) args.push('--effort', input.effort);
    return args;
  }

  async locateSessionFile(
    cwd: string,
    after: Date,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const dir = join(this.claudeHome, 'projects', encodeProjectPath(cwd));
    const deadline = Date.now() + this.locateTimeoutMs;
    const tolerance = 1000; // accept files mtime'd within 1s before `after` to absorb clock skew

    while (Date.now() < deadline) {
      if (signal?.aborted) return null;
      const candidate = await findNewestJsonl(dir, after.getTime() - tolerance);
      if (candidate) return candidate;
      await sleep(this.locatePollIntervalMs);
    }
    return null;
  }

  async *watch(file: string, signal?: AbortSignal): AsyncIterable<SessionUpdate> {
    let cliSessionId: string | null = null;
    let gitBranch: string | null = null;
    const metrics: SessionMetrics = freshMetrics();
    let latestMessage: LatestMessage | null = null;
    let currentTool: SessionUpdate['currentTool'] = null;
    let lastEmittedStatus: SessionStatus | null = null;
    let currentModel: string | null = null;
    const openToolUseIds = new Set<string>();

    const refreshCost = (): void => {
      metrics.estimatedCostUSD = estimateCost(
        currentModel,
        metrics.tokensInput,
        metrics.tokensCached,
        metrics.tokensOutput,
      );
    };

    for await (const raw of tailJsonl(file, { signal })) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;

      const update: SessionUpdate = {};
      let touched = false;

      // Pick up sessionId / gitBranch from any line that has them.
      if (typeof parsed.sessionId === 'string' && parsed.sessionId !== cliSessionId) {
        cliSessionId = parsed.sessionId;
        update.cliSessionId = cliSessionId;
        touched = true;
      }
      if (typeof parsed.gitBranch === 'string' && parsed.gitBranch !== gitBranch) {
        gitBranch = parsed.gitBranch;
        update.gitBranch = gitBranch || null;
        touched = true;
      }

      switch (parsed.type) {
        case 'user': {
          const msg = isRecord(parsed.message) ? parsed.message : null;
          const content = msg?.content;
          const timestamp = typeof parsed.timestamp === 'string'
            ? parsed.timestamp
            : new Date().toISOString();

          if (Array.isArray(content)) {
            // tool_result(s) — close out open tool calls
            for (const block of content) {
              if (
                isRecord(block) &&
                block.type === 'tool_result' &&
                typeof block.tool_use_id === 'string'
              ) {
                openToolUseIds.delete(block.tool_use_id);
              }
            }
            if (openToolUseIds.size === 0 && currentTool !== null) {
              currentTool = null;
              update.currentTool = null;
              touched = true;
            }
            latestMessage = {
              role: 'tool',
              preview: 'tool result',
              timestamp,
            };
          } else if (typeof content === 'string') {
            metrics.messageCount += 1;
            latestMessage = {
              role: 'user',
              preview: truncate(content, PREVIEW_MAX),
              timestamp,
            };
          }

          update.latestMessage = latestMessage;
          update.metrics = { ...metrics };
          touched = true;

          const nextStatus: SessionStatus = openToolUseIds.size > 0 ? 'working' : 'working';
          if (lastEmittedStatus !== nextStatus) {
            update.status = nextStatus;
            lastEmittedStatus = nextStatus;
          }
          break;
        }

        case 'assistant': {
          const msg = isRecord(parsed.message) ? parsed.message : null;
          if (msg && typeof msg.model === 'string') {
            currentModel = msg.model;
          }
          const usage = isRecord(msg?.usage) ? msg.usage : null;
          if (usage) {
            const input = numberFrom(usage.input_tokens);
            const cacheCreate = numberFrom(usage.cache_creation_input_tokens);
            const cacheRead = numberFrom(usage.cache_read_input_tokens);
            const output = numberFrom(usage.output_tokens);
            metrics.tokensInput += input + cacheCreate;
            metrics.tokensCached += cacheRead;
            metrics.tokensOutput += output;
            refreshCost();
          }

          const content = Array.isArray(msg?.content) ? msg.content : [];
          let assistantText: string | null = null;
          for (const block of content) {
            if (!isRecord(block)) continue;
            if (block.type === 'text' && typeof block.text === 'string') {
              assistantText = block.text;
            }
            if (block.type === 'tool_use' && typeof block.id === 'string') {
              openToolUseIds.add(block.id);
              currentTool = {
                name: typeof block.name === 'string' ? block.name : 'unknown',
                description: extractToolDescription(block.input),
                startedAt: typeof parsed.timestamp === 'string'
                  ? parsed.timestamp
                  : new Date().toISOString(),
              };
              update.currentTool = currentTool;
            }
          }

          metrics.messageCount += 1;
          if (assistantText !== null) {
            latestMessage = {
              role: 'assistant',
              preview: truncate(assistantText, PREVIEW_MAX),
              timestamp: typeof parsed.timestamp === 'string'
                ? parsed.timestamp
                : new Date().toISOString(),
            };
            update.latestMessage = latestMessage;
          }

          update.metrics = { ...metrics };

          // Status inference:
          //  - any open tool_use  → working
          //  - assistant text, no open tool → waiting (for user input)
          const nextStatus: SessionStatus =
            openToolUseIds.size > 0 ? 'working' : 'waiting';
          if (lastEmittedStatus !== nextStatus) {
            update.status = nextStatus;
            lastEmittedStatus = nextStatus;
          }
          touched = true;
          break;
        }

        default:
          // mode, permission-mode, file-history-snapshot, ai-title, system,
          // last-prompt, attachment, queue-operation — meta we don't surface
          break;
      }

      if (touched) yield update;
    }
  }

  async listResumable(cwd: string): Promise<ResumableSession[]> {
    const indexPath = join(
      this.claudeHome,
      'projects',
      encodeProjectPath(cwd),
      'sessions-index.json',
    );
    let raw: string;
    try {
      raw = await readFile(indexPath, 'utf8');
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

    const entries = isRecord(parsed) && Array.isArray(parsed.entries) ? parsed.entries : [];
    const results: ResumableSession[] = [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      if (entry.isSidechain === true) continue;
      if (typeof entry.projectPath === 'string' && entry.projectPath !== cwd) continue;
      if (typeof entry.sessionId !== 'string') continue;
      results.push({
        cli: 'claude',
        cliSessionId: entry.sessionId,
        firstPrompt: typeof entry.firstPrompt === 'string' ? entry.firstPrompt : '',
        summary: typeof entry.summary === 'string' ? entry.summary : null,
        messageCount: numberFrom(entry.messageCount),
        modified: typeof entry.modified === 'string' ? entry.modified : '',
        gitBranch: typeof entry.gitBranch === 'string' && entry.gitBranch.length > 0
          ? entry.gitBranch
          : null,
        cwd: typeof entry.projectPath === 'string' ? entry.projectPath : cwd,
      });
    }
    results.sort((a, b) => (a.modified < b.modified ? 1 : -1));
    return results;
  }
}

// ---- helpers ----

export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/\//g, '-');
}

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

function extractToolDescription(input: unknown): string {
  if (!isRecord(input)) return '';
  if (typeof input.description === 'string') return input.description;
  if (typeof input.command === 'string') return input.command;
  if (typeof input.file_path === 'string') return input.file_path;
  return '';
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

async function findNewestJsonl(dir: string, sinceMs: number): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    if (isErrno(e) && e.code === 'ENOENT') return null;
    throw e;
  }
  let best: { path: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!SESSION_ID_RE.test(name)) continue;
    const path = join(dir, name);
    try {
      const st = await stat(path);
      if (st.mtimeMs >= sinceMs && (!best || st.mtimeMs > best.mtimeMs)) {
        best = { path, mtimeMs: st.mtimeMs };
      }
    } catch {
      // skip races where a file vanishes between readdir and stat
    }
  }
  return best?.path ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
