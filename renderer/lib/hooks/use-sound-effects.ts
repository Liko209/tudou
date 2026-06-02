import { useEffect } from 'react';
import { playCue } from '../sound';

/**
 * Plays a sound cue whenever main pushes one. Main owns the decision of WHEN
 * (status transition, prefs, quiet hours, focus / active-session) — the
 * renderer is just the player. Mount once near the app root.
 */
export function useSoundEffects(): void {
  useEffect(() => {
    const api = window.agentDashboard?.sound;
    if (!api) return;
    return api.onPlay(({ kind, id }) => playCue(kind, id));
  }, []);
}
