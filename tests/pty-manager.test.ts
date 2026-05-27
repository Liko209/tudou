import { describe, expect, it } from 'vitest';
import { PtyManager } from '../electron/pty-manager';

const baseOpts = {
  shell: '/bin/bash',
  cwd: process.cwd(),
  cols: 80,
  rows: 24,
};

describe('PtyManager', () => {
  it('spawn returns a uuid and the session shows up in list()', () => {
    const mgr = new PtyManager();
    const id = mgr.spawn({ ...baseOpts, args: ['-c', 'sleep 1'] });
    try {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(mgr.list()).toContain(id);
      expect(mgr.has(id)).toBe(true);
    } finally {
      mgr.disposeAll();
    }
  });

  it('emits data events with the correct id and content', async () => {
    const mgr = new PtyManager();
    const dataReceived = new Promise<{ id: string; data: string }>((resolve) => {
      const buf: string[] = [];
      mgr.on('data', (event) => {
        buf.push(event.data);
        if (buf.join('').includes('manager-data-marker')) {
          resolve({ id: event.id, data: buf.join('') });
        }
      });
    });

    const id = mgr.spawn({ ...baseOpts, args: ['-c', 'echo manager-data-marker'] });
    const result = await dataReceived;

    expect(result.id).toBe(id);
    expect(result.data).toContain('manager-data-marker');
    mgr.disposeAll();
  });

  it('emits exit event and removes the session from list', async () => {
    const mgr = new PtyManager();
    const exitReceived = new Promise<{ id: string; exitCode: number }>((resolve) => {
      mgr.on('exit', (event) => resolve({ id: event.id, exitCode: event.exitCode }));
    });

    const id = mgr.spawn({ ...baseOpts, args: ['-c', 'exit 0'] });
    const result = await exitReceived;

    expect(result.id).toBe(id);
    expect(result.exitCode).toBe(0);
    expect(mgr.list()).not.toContain(id);
    mgr.disposeAll();
  });

  it('write forwards data to the child process', async () => {
    const mgr = new PtyManager();
    const sawMarker = new Promise<void>((resolve) => {
      let buf = '';
      mgr.on('data', (event) => {
        buf += event.data;
        if (buf.includes('write-roundtrip')) resolve();
      });
    });

    const id = mgr.spawn({ ...baseOpts, args: [] });
    mgr.write(id, 'echo write-roundtrip\n');
    await sawMarker;
    mgr.disposeAll();
  });

  it('write to unknown id throws', () => {
    const mgr = new PtyManager();
    expect(() => mgr.write('does-not-exist', 'hi')).toThrow(/unknown pty session/);
    mgr.disposeAll();
  });

  it('kill removes the session', async () => {
    const mgr = new PtyManager();
    const exitReceived = new Promise<void>((resolve) => {
      mgr.on('exit', () => resolve());
    });
    const id = mgr.spawn({ ...baseOpts, args: ['-c', 'sleep 60'] });
    mgr.kill(id);
    await exitReceived;
    expect(mgr.list()).not.toContain(id);
    mgr.disposeAll();
  });
});
