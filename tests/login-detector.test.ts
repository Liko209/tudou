import { describe, expect, it } from 'vitest';
import { detectLoginPrompt, stripAnsi } from '../electron/login-detector';

describe('stripAnsi', () => {
  it('removes basic SGR sequences', () => {
    expect(stripAnsi('[31mred[0m text')).toBe('red text');
  });
  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain')).toBe('plain');
  });
});

describe('detectLoginPrompt', () => {
  it('matches generic "not signed in"', () => {
    expect(detectLoginPrompt('You are not signed in. Please run something.')).toBeTruthy();
  });

  it('matches "please log in"', () => {
    expect(detectLoginPrompt('Please log in to continue.')).toBeTruthy();
  });

  it('matches Claude "run claude login"', () => {
    expect(detectLoginPrompt('To continue, run `claude login`.')).toBeTruthy();
  });

  it('matches Codex "codex auth login"', () => {
    expect(detectLoginPrompt('Run codex auth login to authenticate.')).toBeTruthy();
  });

  it('matches "invalid refresh token"', () => {
    expect(detectLoginPrompt('OAuth error: invalid refresh token')).toBeTruthy();
  });

  it('matches OAuth device-code prompts', () => {
    expect(detectLoginPrompt('Enter the code shown on the screen')).toBeTruthy();
    expect(detectLoginPrompt('device code: ABCD-1234')).toBeTruthy();
  });

  it('ignores normal CLI banners / unrelated output', () => {
    expect(detectLoginPrompt('Claude Code (v2.1.152)')).toBeNull();
    expect(detectLoginPrompt('model: claude-opus-4-7')).toBeNull();
    expect(detectLoginPrompt('Welcome back!')).toBeNull();
  });

  it('still matches when output has color codes mixed in', () => {
    const ansi = '[31mError: [0mPlease sign in to continue';
    expect(detectLoginPrompt(ansi)).toBeTruthy();
  });
});
