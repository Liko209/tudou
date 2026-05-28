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
}

export class ClaudeAdapter implements CliAdapter {
  readonly cli = 'claude' as const;

  private readonly claudeHome: string;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.claudeHome = options.claudeHome ?? join(homedir(), '.claude');
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

  async findFileBySessionId(cwd: string, sessionId: string): Promise<string | null> {
    const path = join(
      this.claudeHome,
      'projects',
      encodeProjectPath(cwd),
      `${sessionId}.jsonl`,
    );
    try {
      await stat(path);
      return path;
    } catch {
      return null;
    }
  }

  async locateSessionFile(
    cwd: string,
    after: Date,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const dir = join(this.claudeHome, 'projects', encodeProjectPath(cwd));
    const sinceMs = after.getTime() - 1000; // 1s tolerance for clock skew

    // Fast path: file may already exist (e.g. resume scenario).
    const existing = await findNewestJsonl(dir, sinceMs);
    if (existing) return existing;
    if (signal?.aborted) return null;

    // Ensure the directory exists so chokidar can attach immediately —
    // claude lazily creates the project dir on first message.
    await mkdir(dir, { recursive: true });

    return waitForNewJsonl({
      dir,
      sinceMs,
      filter: (name) => SESSION_ID_RE.test(name),
      signal,
    });
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
    const projectDir = join(this.claudeHome, 'projects', encodeProjectPath(cwd));
    const indexPath = join(projectDir, 'sessions-index.json');

    // Preferred path: claude wrote sessions-index.json with rich metadata.
    let raw: string | null = null;
    try {
      raw = await readFile(indexPath, 'utf8');
    } catch (e: unknown) {
      if (!(isErrno(e) && e.code === 'ENOENT')) throw e;
    }

    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return scanProjectDirForSessions(projectDir, cwd);
      }
      const entries = isRecord(parsed) && Array.isArray(parsed.entries) ? parsed.entries : [];
      const candidates: Array<{ entry: Record<string, unknown>; path: string }> = [];
      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        if (entry.isSidechain === true) continue;
        if (typeof entry.projectPath === 'string' && entry.projectPath !== cwd) continue;
        if (typeof entry.sessionId !== 'string') continue;
        // Always derive from projectDir + sessionId — the index's
        // `fullPath` field is denormalized and goes stale if the project
        // dir was ever renamed/moved.
        const path = join(projectDir, `${entry.sessionId}.jsonl`);
        candidates.push({ entry, path });
      }

      // Filter out ghost entries — Claude's index keeps records that point
      // to jsonl files the user (or claude itself) has since deleted; trying
      // to --resume one of those errors out with "No conversation found".
      const liveChecks = await Promise.all(
        candidates.map(async ({ entry, path }) => {
          try {
            await stat(path);
            return entry;
          } catch {
            return null;
          }
        }),
      );

      const results: ResumableSession[] = [];
      for (const entry of liveChecks) {
        if (!entry) continue;
        results.push({
          cli: 'claude',
          cliSessionId: entry.sessionId as string,
          firstPrompt: typeof entry.firstPrompt === 'string' ? entry.firstPrompt : '',
          summary: typeof entry.summary === 'string' ? entry.summary : null,
          messageCount: numberFrom(entry.messageCount),
          modified: typeof entry.modified === 'string' ? entry.modified : '',
          gitBranch:
            typeof entry.gitBranch === 'string' && entry.gitBranch.length > 0
              ? entry.gitBranch
              : null,
          cwd: typeof entry.projectPath === 'string' ? entry.projectPath : cwd,
        });
      }
      results.sort((a, b) => (a.modified < b.modified ? 1 : -1));
      return results;
    }

    // Fallback: most older projects don't have sessions-index.json. Scan
    // the project dir for *.jsonl files and reconstruct minimal metadata.
    return scanProjectDirForSessions(projectDir, cwd);
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

/**
 * Reconstruct a resumable session list by scanning the project dir directly.
 * Used when claude hasn't written sessions-index.json (older projects). We
 * peek the first user message line of each jsonl for `firstPrompt`.
 */
async function scanProjectDirForSessions(
  projectDir: string,
  cwd: string,
): Promise<ResumableSession[]> {
  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch (e) {
    if (isErrno(e) && e.code === 'ENOENT') return [];
    throw e;
  }

  const jsonlNames = entries.filter((n) => SESSION_ID_RE.test(n));
  const results = await Promise.all(
    jsonlNames.map(async (name): Promise<ResumableSession | null> => {
      const path = join(projectDir, name);
      const sessionId = name.replace(/\.jsonl$/, '');
      try {
        const st = await stat(path);
        if (!st.isFile() || st.size === 0) return null;
        const firstPrompt = (await peekFirstUserPrompt(path)) ?? '';
        return {
          cli: 'claude',
          cliSessionId: sessionId,
          firstPrompt,
          summary: null,
          messageCount: 0, // not worth scanning the whole file just for this
          modified: st.mtime.toISOString(),
          gitBranch: null,
          cwd,
        };
      } catch {
        return null;
      }
    }),
  );

  return results
    .filter((r): r is ResumableSession => r !== null)
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

/**
 * Stream-read a Claude JSONL until the first `type:"user"` line with
 * string content, return its content (truncated). Cap at 1MB.
 */
async function peekFirstUserPrompt(file: string): Promise<string | null> {
  const MAX = 1024 * 1024;
  let buffer = '';
  try {
    const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 16384 });
    for await (const chunk of stream) {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const parsed = JSON.parse(line);
          if (
            isRecord(parsed) &&
            parsed.type === 'user' &&
            isRecord(parsed.message) &&
            typeof parsed.message.content === 'string' &&
            parsed.message.content.length > 0
          ) {
            stream.destroy();
            const text = parsed.message.content as string;
            return text.length > 120 ? text.slice(0, 119) + '…' : text;
          }
        } catch {
          // skip malformed line
        }
      }
      if (buffer.length > MAX) {
        stream.destroy();
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
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

/**
 * Wait for a new file matching `filter` to appear under `dir` (created
 * after `sinceMs`). Returns the path on match, or null when the abort
 * signal fires. Uses chokidar — no polling, near-zero idle cost.
 */
export interface WaitForNewJsonlOptions {
  dir: string;
  sinceMs: number;
  filter: (name: string) => boolean;
  signal?: AbortSignal;
}

export function waitForNewJsonl(options: WaitForNewJsonlOptions): Promise<string | null> {
  const { dir, sinceMs, filter, signal } = options;
  return new Promise<string | null>((resolve) => {
    if (signal?.aborted) return resolve(null);

    const watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      depth: 0,
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

    watcher.on('add', (path: string) => {
      if (!filter(basename(path))) return;
      void stat(path)
        .then((st) => {
          if (st.mtimeMs >= sinceMs) finish(path);
        })
        .catch(() => {
          /* file vanished — ignore */
        });
    });

    watcher.on('error', () => finish(null));
  });
}
