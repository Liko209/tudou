import { describe, it, expect } from 'vitest';
import { soundKindFor, decideSound, type SoundDecisionInput } from '../electron/sound-policy';

// A session change that, by itself, would want a sound: alert cue, all enabled,
// not quiet hours, app in the background. Individual tests override one field.
const base: SoundDecisionInput = {
  status: 'blocked',
  soundComplete: true,
  soundAlert: true,
  isQuietHours: false,
  isForeground: false,
  isActiveSession: false,
};

describe('soundKindFor', () => {
  it('maps waiting → complete', () => {
    expect(soundKindFor('waiting')).toBe('complete');
  });
  it('maps blocked and errored → alert', () => {
    expect(soundKindFor('blocked')).toBe('alert');
    expect(soundKindFor('errored')).toBe('alert');
  });
  it('maps transient/working states → null (no sound)', () => {
    expect(soundKindFor('working')).toBeNull();
    expect(soundKindFor('starting')).toBeNull();
    expect(soundKindFor('exited')).toBeNull();
  });
});

describe('decideSound', () => {
  it('plays the complete cue when a session finishes (waiting)', () => {
    expect(decideSound({ ...base, status: 'waiting' })).toBe('complete');
  });

  it('plays the alert cue when a session is blocked', () => {
    expect(decideSound({ ...base, status: 'blocked' })).toBe('alert');
  });

  it('respects the per-cue toggles independently', () => {
    expect(decideSound({ ...base, status: 'waiting', soundComplete: false })).toBeNull();
    // alert still plays even with the complete cue off
    expect(decideSound({ ...base, status: 'blocked', soundComplete: false })).toBe('alert');
    expect(decideSound({ ...base, status: 'blocked', soundAlert: false })).toBeNull();
  });

  it('stays silent during quiet hours', () => {
    expect(decideSound({ ...base, isQuietHours: true })).toBeNull();
  });

  it('stays silent only when the ACTIVE session changes while focused', () => {
    // Foreground + the session you are watching → silent (you can see it).
    expect(decideSound({ ...base, isForeground: true, isActiveSession: true })).toBeNull();
    // Foreground but a different (background) session → still plays.
    expect(decideSound({ ...base, isForeground: true, isActiveSession: false })).toBe('alert');
    // App unfocused → plays regardless of which session.
    expect(decideSound({ ...base, isForeground: false, isActiveSession: true })).toBe('alert');
  });

  it('never plays for a non-attention status even if everything is enabled', () => {
    expect(decideSound({ ...base, status: 'working' })).toBeNull();
  });
});
