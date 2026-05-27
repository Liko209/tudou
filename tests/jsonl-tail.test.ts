import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tailJsonl } from '../electron/adapters/jsonl-tail';

const FIXTURE_DIR = join(tmpdir(), `tail-tests-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

beforeAll(async () => {
  await mkdir(FIXTURE_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
});

async function collectUntil(
  iter: AsyncIterable<string>,
  predicate: (lines: string[]) => boolean,
  timeoutMs = 3000,
): Promise<string[]> {
  const lines: string[] = [];
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`collectUntil timed out (got ${lines.length} lines)`)), timeoutMs),
  );
  const consumer = (async () => {
    for await (const line of iter) {
      lines.push(line);
      if (predicate(lines)) return lines;
    }
    return lines;
  })();
  return Promise.race([consumer, timeout]);
}

describe('tailJsonl', () => {
  it('yields existing lines from a pre-populated file', async () => {
    const path = join(FIXTURE_DIR, 'existing.jsonl');
    await writeFile(path, 'alpha\nbeta\ngamma\n');
    const ctrl = new AbortController();
    const lines = await collectUntil(
      tailJsonl(path, { signal: ctrl.signal, pollInterval: 50 }),
      (l) => l.length === 3,
    );
    ctrl.abort();
    expect(lines).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('yields appended lines after the iterator starts', async () => {
    const path = join(FIXTURE_DIR, 'append.jsonl');
    await writeFile(path, 'first\n');
    const ctrl = new AbortController();
    const consumer = collectUntil(
      tailJsonl(path, { signal: ctrl.signal, pollInterval: 50 }),
      (l) => l.length === 3,
    );
    await new Promise((r) => setTimeout(r, 150));
    await appendFile(path, 'second\n');
    await new Promise((r) => setTimeout(r, 150));
    await appendFile(path, 'third\n');
    const lines = await consumer;
    ctrl.abort();
    expect(lines).toEqual(['first', 'second', 'third']);
  });

  it('holds a partial trailing line until a newline arrives', async () => {
    const path = join(FIXTURE_DIR, 'partial.jsonl');
    await writeFile(path, 'first\n');
    const ctrl = new AbortController();
    const consumer = collectUntil(
      tailJsonl(path, { signal: ctrl.signal, pollInterval: 50 }),
      (l) => l.length === 2,
    );
    await new Promise((r) => setTimeout(r, 150));
    await appendFile(path, 'second-partial');
    await new Promise((r) => setTimeout(r, 200));
    await appendFile(path, '-completed\n');
    const lines = await consumer;
    ctrl.abort();
    expect(lines).toEqual(['first', 'second-partial-completed']);
  });

  it('waits for the file to appear if it does not exist yet', async () => {
    const path = join(FIXTURE_DIR, 'late.jsonl');
    const ctrl = new AbortController();
    const consumer = collectUntil(
      tailJsonl(path, { signal: ctrl.signal, pollInterval: 50 }),
      (l) => l.length === 1,
    );
    await new Promise((r) => setTimeout(r, 150));
    await writeFile(path, 'finally\n');
    const lines = await consumer;
    ctrl.abort();
    expect(lines).toEqual(['finally']);
  });

  it('stops cleanly on abort signal', async () => {
    const path = join(FIXTURE_DIR, 'abort.jsonl');
    await writeFile(path, 'one\n');
    const ctrl = new AbortController();
    const allLines: string[] = [];
    const consumer = (async () => {
      for await (const line of tailJsonl(path, { signal: ctrl.signal, pollInterval: 50 })) {
        allLines.push(line);
      }
    })();
    await new Promise((r) => setTimeout(r, 150));
    ctrl.abort();
    await consumer;
    expect(allLines).toEqual(['one']);
  });

  it('skips empty lines (no spurious empty yields between LFs)', async () => {
    const path = join(FIXTURE_DIR, 'empties.jsonl');
    await writeFile(path, 'a\n\n\nb\n');
    const ctrl = new AbortController();
    const lines = await collectUntil(
      tailJsonl(path, { signal: ctrl.signal, pollInterval: 50 }),
      (l) => l.length === 2,
    );
    ctrl.abort();
    expect(lines).toEqual(['a', 'b']);
  });
});
