'use client';

import { useEffect, useState } from 'react';

/**
 * Keep `open`'s children mounted during a close animation.
 *
 * When `open` flips true, returns true immediately so the child mounts
 * before the enter transition runs. When `open` flips false, holds true
 * for `durationMs` so the leave transition has time to play before
 * unmount — the wrapper itself animates width/height to 0 via CSS in
 * parallel. Keep the duration in sync with the CSS transition.
 */
export function useAnimatedMount(open: boolean, durationMs = 200): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(t);
  }, [open, durationMs]);
  return mounted;
}
