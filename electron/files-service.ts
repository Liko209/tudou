import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import chokidar from 'chokidar';

export interface FileEntry {
  name: string;
  /** Full absolute path. */
  path: string;
  kind: 'file' | 'dir';
}

const MAX_PREVIEW_BYTES = 512 * 1024; // 512 KB cap on preview reads

const IGNORE_NAMES = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  '.next',
  'dist',
  'out',
  '.cache',
  '.turbo',
  '__pycache__',
]);

/**
 * List immediate children of `dir`. Filters out the obvious noise
 * (.git, node_modules, build outputs) so the panel stays useful
 * without overwhelming the user.
 */
export async function listDir(dir: string): Promise<FileEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: FileEntry[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.env.example') continue;
    if (IGNORE_NAMES.has(ent.name)) continue;
    let kind: 'file' | 'dir';
    if (ent.isDirectory()) kind = 'dir';
    else if (ent.isFile()) kind = 'file';
    else continue; // skip symlinks, sockets, etc.
    out.push({ name: ent.name, path: join(dir, ent.name), kind });
  }
  // Folders first, then files; alphabetical within each.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export interface FilePreview {
  path: string;
  /** UTF-8 text content, capped. */
  content: string;
  /** True iff we hit the size cap and content is truncated. */
  truncated: boolean;
  /** True iff the file looks binary; content will be empty in that case. */
  binary: boolean;
  size: number;
}

export async function readPreview(path: string): Promise<FilePreview> {
  const st = await stat(path);
  if (!st.isFile()) {
    throw new Error(`Not a regular file: ${path}`);
  }
  const wantBytes = Math.min(st.size, MAX_PREVIEW_BYTES);
  const buf = Buffer.alloc(wantBytes);
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'r');
  try {
    await fh.read(buf, 0, wantBytes, 0);
  } finally {
    await fh.close();
  }

  // Heuristic binary detection: any NUL byte in the first 4 KB.
  const sniff = buf.subarray(0, Math.min(buf.length, 4096));
  const binary = sniff.includes(0);

  return {
    path,
    content: binary ? '' : buf.toString('utf8'),
    truncated: st.size > wantBytes,
    binary,
    size: st.size,
  };
}

/**
 * Watch a single file and invoke `onChange` when it's modified or recreated.
 * Returns a dispose fn that stops the watcher. Uses chokidar (already used for
 * JSONL watching) with awaitWriteFinish so a multi-write save / atomic rename
 * fires once after the bytes settle, not mid-write. Editors and agents that
 * save via temp-file + rename are covered by the `add` event.
 */
export function watchFile(path: string, onChange: () => void): () => void {
  const watcher = chokidar.watch(path, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  const handler = (): void => onChange();
  watcher.on('change', handler);
  watcher.on('add', handler); // re-created after a delete / atomic rename
  return () => {
    void watcher.close();
  };
}

// Read function not exported separately; consumers use readPreview.
void readFile;
