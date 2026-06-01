'use client';

import { useEffect, useRef } from 'react';
import { useSessionsStore } from '../stores/sessions-store';
import { useUIStore } from '../stores/ui-store';

/**
 * Applies the chosen theme class to <html> so CSS variables in
 * globals.css resolve to the dark or light palette. The 'system' option
 * watches `prefers-color-scheme` and updates live when the OS toggles.
 *
 * Side-effect: pushes the resolved theme to main, which mirrors it
 * into `~/.claude/settings.json` so any future Claude spawn / dormant
 * resume launches with matching TUI chrome. Already-running Claude
 * sessions keep their startup theme until restarted — settings.json
 * is read once at process boot, not watched.
 */
export function useTheme(): void {
  const theme = useUIStore((s) => s.theme);
  const showToast = useUIStore((s) => s.showToast);
  // Skip the toast on initial application (first paint after launch);
  // only notify when the user / OS actually flips the theme.
  const lastResolved = useRef<'dark' | 'light' | null>(null);

  useEffect(() => {
    const html = document.documentElement;

    const apply = (resolved: 'dark' | 'light'): void => {
      html.classList.remove('theme-light', 'theme-dark');
      html.classList.add(resolved === 'light' ? 'theme-light' : 'theme-dark');
      void window.agentDashboard?.claude?.setTheme(resolved);

      const prev = lastResolved.current;
      lastResolved.current = resolved;
      if (prev === null || prev === resolved) return;

      // Read sessions via getState so this closure stays decoupled
      // from the effect's dep list — sessions change every keystroke.
      const live = Object.values(useSessionsStore.getState().sessions).filter(
        (s) =>
          s.cli === 'claude' &&
          s.status !== 'exited' &&
          s.status !== 'errored',
      ).length;
      if (live > 0) {
        showToast(
          `${live} Claude session${live > 1 ? 's' : ''} still on the old theme — close & resume from the sidebar to update.`,
        );
      }
    };

    if (theme === 'dark' || theme === 'light') {
      apply(theme);
      return;
    }

    // system: react to OS scheme changes
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const fromMql = (): void => apply(mql.matches ? 'light' : 'dark');
    fromMql();
    mql.addEventListener('change', fromMql);
    return () => mql.removeEventListener('change', fromMql);
  }, [theme]);
}
