import { describe, expect, it } from 'vitest';
import { isUpdateActionable } from '../renderer/lib/stores/updater-store';

describe('isUpdateActionable', () => {
  it('is true for phases with a pending update the user can act on', () => {
    expect(isUpdateActionable('available')).toBe(true);
    expect(isUpdateActionable('downloading')).toBe(true);
    expect(isUpdateActionable('ready')).toBe(true);
  });

  it('is false for non-actionable phases and unknown/undefined', () => {
    expect(isUpdateActionable('idle')).toBe(false);
    expect(isUpdateActionable('checking')).toBe(false);
    expect(isUpdateActionable('up-to-date')).toBe(false);
    expect(isUpdateActionable('error')).toBe(false);
    expect(isUpdateActionable(undefined)).toBe(false);
  });
});
