import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageHistory, SessionUsage } from '../shared/usage-types';
import {
  finalizeHistory,
  foldClaudeLine,
  mergeAccumulator,
  newAccumulator,
  type UsageAccumulator,
} from './usage-history';

// Scans Claude Code's per-project JSONL transcripts for historical token usage.
// Parsing every transcript on each call would be slow, so per-file accumulators
// are cached by (mtime, size) — unchanged files are reused, only new/edited
// files are re-parsed, and the cached parts are merged each call.

interface CachedFile {
  mtimeMs: number;
  size: number;
  acc: UsageAccumulator;
}

const fileCache = new Map<string, CachedFile>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Parse one JSONL file into its own accumulator. */
async function parseFile(path: string, fallbackProject: string): Promise<UsageAccumulator> {
  const acc = newAccumulator();
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return acc; // unreadable → empty contribution
  }
  let lastUserText = '';
  for (const line of text.split('\n')) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // skip partial/corrupt lines
    }
    if (isRecord(parsed) && parsed.type === 'user') {
      const t = userTextFrom(parsed);
      if (t) lastUserText = t; // the prompt that triggers the following turn(s)
    }
    const project =
      isRecord(parsed) && typeof parsed.cwd === 'string' && parsed.cwd ? parsed.cwd : fallbackProject;
    foldClaudeLine(acc, parsed, project, lastUserText);
  }
  return acc;
}

/** Extract the user's prompt text from a `type:'user'` line (ignoring
 *  tool_result blocks, which are tool output, not the user's words). */
function userTextFrom(parsed: Record<string, unknown>): string {
  const msg = isRecord(parsed.message) ? parsed.message : null;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join(' ');
}

/**
 * Scan the project transcripts under `~/.claude/projects` and return
 * aggregated historical usage.
 * `claudeHome` defaults to ~/.claude (overridable for tests). Cached by file
 * mtime+size so repeat calls only re-parse changed transcripts.
 */
export async function scanClaudeUsage(claudeHome = join(homedir(), '.claude')): Promise<UsageHistory> {
  const projectsDir = join(claudeHome, 'projects');
  const total = newAccumulator();

  let projectDirs: string[] = [];
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // No projects dir (fresh install / Claude never run) → empty history.
    return finalizeHistory(total, new Date().toISOString());
  }

  const seen = new Set<string>();
  const sessions: SessionUsage[] = [];
  for (const dirName of projectDirs) {
    const dir = join(projectsDir, dirName);
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(dir, file);
      seen.add(path);
      let st;
      try {
        st = await stat(path);
      } catch {
        continue;
      }
      const cached = fileCache.get(path);
      let acc: UsageAccumulator;
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        acc = cached.acc;
      } else {
        acc = await parseFile(path, dirName);
        fileCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, acc });
      }
      mergeAccumulator(total, acc);
      // Each transcript file is one session — summarize it for the costliest list.
      if (acc.totals.messages > 0) {
        sessions.push(sessionFromFile(file.replace(/\.jsonl$/, ''), acc));
      }
    }
  }

  // Drop cache entries for files that no longer exist (deleted transcripts).
  for (const key of fileCache.keys()) {
    if (!seen.has(key)) fileCache.delete(key);
  }

  const history = finalizeHistory(total, new Date().toISOString());
  history.sessionCount = sessions.length;
  history.sessions = sessions.sort((a, b) => b.costUSD - a.costUSD).slice(0, 8);
  return history;
}

/** Derive a per-session summary from one transcript file's accumulator. */
function sessionFromFile(id: string, acc: UsageAccumulator): SessionUsage {
  // Dominant project (by cost) and most recent day in the file.
  let project = '';
  let topCost = -1;
  for (const [p, t] of acc.byProject) {
    if (t.costUSD > topCost) {
      topCost = t.costUSD;
      project = p;
    }
  }
  let date = '';
  for (const d of acc.byDay.keys()) if (d > date) date = d;
  return { id, project, date, ...acc.totals };
}

/** Test hook: clear the per-file cache. */
export function _clearUsageCache(): void {
  fileCache.clear();
}
