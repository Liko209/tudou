'use client';

import { useEffect } from 'react';
import { useUIStore } from '../stores/ui-store';

/**
 * Applies the chosen theme class to <html> so CSS variables in globals.css
 * resolve to the dark or light palette, and mirrors it into
 * `~/.claude/settings.json` so future Claude spawns/resumes match.
 *
 * Only Dark / Light — the live "follow system" option was removed: it forced
 * the terminal palette to hot-swap mid-session, which could leave a running
 * TUI repainted into a garbled state. The dashboard chrome still updates
 * instantly when the user switches, but a clean, fully-consistent result (the
 * xterm palette in particular) needs a relaunch — Settings prompts for that.
 */
export function useTheme(): void {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('theme-light', 'theme-dark');
    html.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
    void window.agentDashboard?.claude?.setTheme(theme);
  }, [theme]);
}
