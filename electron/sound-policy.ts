import type { SessionStatus } from '../shared/session-types';
import type { SoundKind } from '../shared/ipc-contracts';

/**
 * Pure sound-cue policy, split out of LifecycleManager so it's trivially
 * unit-testable (LifecycleManager itself drags in the whole electron app /
 * Tray surface). `notify()` is a thin caller around {@link decideSound}.
 */

/** Which cue a status change warrants, or null if it warrants none. */
export function soundKindFor(status: SessionStatus): SoundKind | null {
  if (status === 'waiting') return 'complete'; // turn finished → your turn
  if (status === 'blocked' || status === 'errored') return 'alert'; // needs you
  return null;
}

export interface SoundDecisionInput {
  status: SessionStatus;
  /** Per-cue toggles from preferences. */
  soundComplete: boolean;
  soundAlert: boolean;
  /** Inside the daily quiet-hours window? */
  isQuietHours: boolean;
  /** Is the app window focused right now? */
  isForeground: boolean;
  /** Is the changed session the one the user is currently viewing? */
  isActiveSession: boolean;
}

/**
 * Decide which sound (if any) to play for a session status change. Returns the
 * cue kind to play, or null to stay silent. Silent when: the status isn't an
 * attention state, that cue is disabled, we're in quiet hours, or the user is
 * already looking at this exact session (focused + active) so a sound is moot.
 */
export function decideSound(input: SoundDecisionInput): SoundKind | null {
  const kind = soundKindFor(input.status);
  if (!kind) return null;
  const enabled = kind === 'complete' ? input.soundComplete : input.soundAlert;
  if (!enabled) return null;
  if (input.isQuietHours) return null;
  if (input.isForeground && input.isActiveSession) return null;
  return kind;
}
