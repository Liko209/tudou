import type { SoundKind } from '../../shared/ipc-contracts';
import { SOUND_OFF, soundFile } from '../../shared/sound-catalog';

/**
 * Plays the bundled session sound cues. Files live in `public/sounds/` named
 * `<kind>-<id>.wav` and are referenced relative to the document so the URL
 * resolves under both `file://` (packaged, assetPrefix './') and `localhost`
 * (dev). One cached <audio> per file; replaying just rewinds it.
 */
const cache = new Map<string, HTMLAudioElement>();

function audioFor(file: string): HTMLAudioElement {
  let a = cache.get(file);
  if (!a) {
    a = new Audio(new URL(`sounds/${file}`, window.location.href).href);
    a.preload = 'auto';
    cache.set(file, a);
  }
  return a;
}

/** Play the chosen cue. `id === 'off'` (or unknown) is a no-op. */
export function playCue(kind: SoundKind, id: string): void {
  if (typeof window === 'undefined' || !id || id === SOUND_OFF) return;
  try {
    const a = audioFor(soundFile(kind, id));
    a.currentTime = 0;
    // Autoplay may still reject if no gesture has occurred yet — swallow it.
    void a.play().catch(() => {});
  } catch {
    // Audio unsupported / decode error — never let a sound break the UI.
  }
}
