import { describe, expect, it } from 'vitest';
import { sanitizeSpawnEnv } from '../electron/env-sanitizer';

describe('sanitizeSpawnEnv', () => {
  it('preserves harmless env vars (PATH, HOME, etc.)', () => {
    const out = sanitizeSpawnEnv({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
    });
    expect(out).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
    });
  });

  it('strips Claude Code env vars', () => {
    const out = sanitizeSpawnEnv({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: 'abc-123',
      CLAUDE_PLUGIN_DATA: '/some/path',
      CLAUDE_PROJECT_DIR: '/work',
      CLAUDE_EFFORT: 'xhigh',
    });
    expect(out).toEqual({ PATH: '/usr/bin' });
  });

  it('strips Codex companion env vars (the bug we hit)', () => {
    const out = sanitizeSpawnEnv({
      PATH: '/usr/bin',
      CODEX_COMPANION_SESSION_ID: 'b6223bf4-...',
      CODEX_PLUGIN_FOO: 'bar',
    });
    expect(out).toEqual({ PATH: '/usr/bin' });
  });

  it('drops undefined values (NodeJS.ProcessEnv allows undefined)', () => {
    const out = sanitizeSpawnEnv({
      PATH: '/usr/bin',
      MAYBE_UNSET: undefined,
    });
    expect(out).toEqual({ PATH: '/usr/bin' });
    expect('MAYBE_UNSET' in out).toBe(false);
  });

  it('merges extraEnv (user proxy / custom vars) on top of the base env', () => {
    const out = sanitizeSpawnEnv(
      { PATH: '/usr/bin' },
      { extraEnv: { HTTPS_PROXY: 'http://p:1', ANTHROPIC_BASE_URL: 'https://x' } },
    );
    expect(out).toEqual({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://p:1',
      ANTHROPIC_BASE_URL: 'https://x',
    });
  });

  it('extraEnv overrides an inherited value of the same key', () => {
    const out = sanitizeSpawnEnv(
      { HTTPS_PROXY: 'http://inherited:1' },
      { extraEnv: { HTTPS_PROXY: 'http://user:2' } },
    );
    expect(out.HTTPS_PROXY).toBe('http://user:2');
  });

  it('extraEnv is applied after theme (both coexist)', () => {
    const out = sanitizeSpawnEnv(
      { PATH: '/x' },
      { theme: 'dark', extraEnv: { HTTPS_PROXY: 'http://p:1' } },
    );
    expect(out.COLORFGBG).toBe('15;0');
    expect(out.HTTPS_PROXY).toBe('http://p:1');
  });
});
