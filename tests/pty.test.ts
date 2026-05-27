import { describe, expect, it } from 'vitest';
import * as pty from 'node-pty';

describe('node-pty integration', () => {
  it('spawns bash and captures stdout', async () => {
    const term = pty.spawn('/bin/bash', ['-c', 'echo agent-dashboard-pty-ok'], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });

    const output = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timeout = setTimeout(() => reject(new Error('pty timeout')), 3000);
      term.onData((data) => {
        buf += data;
      });
      term.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (exitCode === 0) resolve(buf);
        else reject(new Error(`non-zero exit: ${exitCode}`));
      });
    });

    expect(output).toContain('agent-dashboard-pty-ok');
  });

  it('forwards stdin writes to the child process', async () => {
    const term = pty.spawn('/bin/bash', [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });

    const output = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timeout = setTimeout(() => reject(new Error('stdin pty timeout')), 3000);
      term.onData((data) => {
        buf += data;
        if (buf.includes('round-trip-marker')) {
          clearTimeout(timeout);
          term.kill();
        }
      });
      term.onExit(() => resolve(buf));
      term.write('echo round-trip-marker\n');
    });

    expect(output).toContain('round-trip-marker');
  });
});
