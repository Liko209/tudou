'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number toward `target`, re-aiming smoothly whenever `target`
 * changes — including the rapid-fire stream of updates a session resume
 * produces (the adapter replays the whole transcript and cumulative totals
 * climb from 0). Each change tweens from the *current* displayed value, so
 * hundreds of updates chain into one continuous roll instead of restarting.
 *
 * rAF-based and client-only; initial render shows `target` (no SSR mismatch,
 * no first-paint flash), animating only once the value actually moves.
 */
export function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    if (from === target) return;
    let start: number | null = null;
    const step = (now: number): void => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const value = from + (target - from) * eased;
      displayRef.current = value;
      setDisplay(value);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}
