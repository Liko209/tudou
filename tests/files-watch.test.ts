import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchFile } from '../electron/files-service';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'files-watch-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function waitUntil(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('watchFile', () => {
  it('fires onChange when the watched file is modified', async () => {
    const file = join(dir, 'note.txt');
    writeFileSync(file, 'one');
    let fired = 0;
    const dispose = watchFile(file, () => {
      fired += 1;
    });
    try {
      // Let chokidar attach before the first edit.
      await new Promise((r) => setTimeout(r, 300));
      writeFileSync(file, 'two');
      await waitUntil(() => fired > 0);
      expect(fired).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it('stops firing after dispose', async () => {
    const file = join(dir, 'note.txt');
    writeFileSync(file, 'one');
    let fired = 0;
    const dispose = watchFile(file, () => {
      fired += 1;
    });
    await new Promise((r) => setTimeout(r, 300));
    dispose();
    const seen = fired;
    writeFileSync(file, 'after-dispose');
    await new Promise((r) => setTimeout(r, 500));
    expect(fired).toBe(seen);
  });
});
