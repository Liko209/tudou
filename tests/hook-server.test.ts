import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HookServer } from '../electron/hook-server';

const ROOT = join(tmpdir(), `hook-server-tests-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

async function freshServer(): Promise<HookServer> {
  const instancePath = join(ROOT, `instance-${Date.now()}-${Math.random()}.json`);
  const server = new HookServer(instancePath);
  await server.start();
  return server;
}

describe('HookServer', () => {
  it('binds on 127.0.0.1 with a fresh random port + token + instance file', async () => {
    const server = await freshServer();
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.token).toMatch(/^[0-9a-f]{48}$/);
      const meta = JSON.parse(await readFile(server.instancePath, 'utf8'));
      expect(meta.pid).toBe(process.pid);
      expect(meta.port).toBe(server.port);
      expect(meta.token).toBe(server.token);
      expect(typeof meta.startedAt).toBe('string');
    } finally {
      await server.stop();
    }
  });

  it('routes /hook with the right Authorization through to listeners', async () => {
    const server = await freshServer();
    const received: unknown[] = [];
    server.on((p) => received.push(p));
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/hook`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${server.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: 'abc',
          hook_event_name: 'Stop',
          cwd: '/x',
        }),
      });
      expect(res.status).toBe(204);
      expect(received).toEqual([
        { session_id: 'abc', hook_event_name: 'Stop', cwd: '/x' },
      ]);
    } finally {
      await server.stop();
    }
  });

  it('rejects /hook without the correct bearer token (403)', async () => {
    const server = await freshServer();
    const received: unknown[] = [];
    server.on((p) => received.push(p));
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/hook`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
        body: '{}',
      });
      expect(res.status).toBe(403);
      expect(received).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  it('returns 404 for non-/hook paths', async () => {
    const server = await freshServer();
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/something-else`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${server.token}` },
      });
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('removes the instance file on stop', async () => {
    const server = await freshServer();
    const path = server.instancePath;
    await server.stop();
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('drops malformed JSON without crashing', async () => {
    const server = await freshServer();
    const received: unknown[] = [];
    server.on((p) => received.push(p));
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/hook`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${server.token}` },
        body: 'not json',
      });
      expect(res.status).toBe(204);
      expect(received).toEqual([]);
    } finally {
      await server.stop();
    }
  });
});
