import type { SoundKind } from './ipc-contracts';

/**
 * The bundled sound cues the user can choose from, per kind. `id` maps to the
 * file `public/sounds/<kind>-<id>.wav` (see scripts/gen-sounds.mjs). Keep this
 * list, the generator, and the shipped files in lockstep.
 */
export interface SoundOption {
  id: string;
  label: string;
}

export const SOUND_OPTIONS: Record<SoundKind, SoundOption[]> = {
  complete: [
    { id: 'chime', label: 'Chime' },
    { id: 'soft', label: 'Soft' },
    { id: 'marimba', label: 'Marimba' },
    { id: 'arp', label: 'Arpeggio' },
    { id: 'bell', label: 'Bell' },
  ],
  alert: [
    { id: 'double', label: 'Double ping' },
    { id: 'triple', label: 'Triple' },
    { id: 'knock', label: 'Knock' },
    { id: 'pingpong', label: 'Ping-pong' },
  ],
};

/** Sentinel id meaning "no sound for this cue". */
export const SOUND_OFF = 'off';

/** Default selection per kind (the originals the cue shipped with). */
export const DEFAULT_SOUND_ID: Record<SoundKind, string> = {
  complete: 'chime',
  alert: 'double',
};

/** The audio filename (under public/sounds/) for a kind + chosen id. */
export function soundFile(kind: SoundKind, id: string): string {
  return `${kind}-${id}.wav`;
}

/** True if `id` is a real, playable option for this kind (not 'off'/unknown). */
export function isPlayableSound(kind: SoundKind, id: string): boolean {
  return SOUND_OPTIONS[kind].some((o) => o.id === id);
}

/** Normalize a stored value to a valid selection ('off' or a known id). */
export function normalizeSoundId(kind: SoundKind, id: unknown): string {
  if (id === SOUND_OFF) return SOUND_OFF;
  if (typeof id === 'string' && isPlayableSound(kind, id)) return id;
  return DEFAULT_SOUND_ID[kind];
}
