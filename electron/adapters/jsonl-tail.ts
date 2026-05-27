import { open, stat } from 'node:fs/promises';
import { watchFile, unwatchFile, type StatsListener } from 'node:fs';

export interface TailOptions {
  /** Abort to stop iteration cleanly. */
  signal?: AbortSignal;
  /** Polling interval in ms. Default 100. */
  pollInterval?: number;
}

/**
 * Async-iterates lines as they are appended to a JSONL file.
 *
 * - Yields all existing lines first, then waits for appends.
 * - Holds partial trailing content until a newline arrives.
 * - Skips empty lines.
 * - Recovers from truncation (size shrinks) by resetting to offset 0.
 * - Stops cleanly on AbortSignal; the file does not need to exist at start.
 *
 * Uses fs.watchFile (polling under the hood) for reliable file-level
 * change detection — fs.watch on macOS reports directory mtime which is
 * brittle for tail-style consumers.
 */
export async function* tailJsonl(
  path: string,
  options: TailOptions = {},
): AsyncIterableIterator<string> {
  const pollInterval = options.pollInterval ?? 100;

  let buffer = '';
  let offset = 0;
  let done = false;
  const pending: string[] = [];
  let resolveNext: (() => void) | null = null;

  const wakeConsumer = (): void => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  const readNew = async (): Promise<void> => {
    let st;
    try {
      st = await stat(path);
    } catch (e: unknown) {
      if (isErrno(e) && e.code === 'ENOENT') return; // file not yet created
      throw e;
    }

    if (st.size < offset) {
      // truncated / rotated — restart from the beginning
      offset = 0;
      buffer = '';
    }
    if (st.size === offset) return;

    const fh = await open(path, 'r');
    try {
      const len = st.size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      offset = st.size;
      buffer += buf.toString('utf8');

      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) pending.push(line);
        nl = buffer.indexOf('\n');
      }
    } finally {
      await fh.close();
    }
  };

  const listener: StatsListener = () => {
    void readNew()
      .catch(() => {
        /* swallow transient stat errors; will retry next tick */
      })
      .finally(wakeConsumer);
  };
  watchFile(path, { interval: pollInterval, persistent: false }, listener);

  const onAbort = (): void => {
    done = true;
    wakeConsumer();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await readNew();
    while (!done) {
      while (pending.length > 0) {
        yield pending.shift()!;
        if (done) return;
      }
      if (done) return;
      await new Promise<void>((resolve) => {
        // Re-check after registering, to avoid losing a wake fired between
        // the last pending drain and this await.
        if (pending.length > 0 || done) {
          resolve();
          return;
        }
        resolveNext = resolve;
      });
    }
    while (pending.length > 0) yield pending.shift()!;
  } finally {
    unwatchFile(path, listener);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}
