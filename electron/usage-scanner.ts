import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageHistory } from '../shared/usage-types';
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
  for (const line of text.split('\n')) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // skip partial/corrupt lines
    }
    const project =
      isRecord(parsed) && typeof parsed.cwd === 'string' && parsed.cwd ? parsed.cwd : fallbackProject;
    foldClaudeLine(acc, parsed, project);
  }
  return acc;
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
    }
  }

  // Drop cache entries for files that no longer exist (deleted transcripts).
  for (const key of fileCache.keys()) {
    if (!seen.has(key)) fileCache.delete(key);
  }

  return finalizeHistory(total, new Date().toISOString());
}

/** Test hook: clear the per-file cache. */
export function _clearUsageCache(): void {
  fileCache.clear();
}
