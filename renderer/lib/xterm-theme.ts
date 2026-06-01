import type { ITheme } from '@xterm/xterm';

/**
 * Resolve the xterm color theme for the *current* document state.
 *
 * Two responsibilities:
 *  1. Pull the base canvas/ink/cursor colors from CSS variables so the
 *     terminal matches the rest of the dashboard.
 *  2. Remap the 16-color ANSI palette per theme. Many TUIs (Claude Code
 *     included) emit `bg=black`/`bg=brightBlack` to draw their own chrome,
 *     which on a light dashboard reads as ugly dark bands. In light mode
 *     we substitute those slots with light grays so chrome blends in;
 *     foreground "black" stays dark so text is still readable.
 */
export function getXtermTheme(): ITheme {
  if (typeof window === 'undefined') return {};
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const v = (name: string): string => `rgb(${style.getPropertyValue(`--${name}`).trim()})`;
  const accentRaw = style.getPropertyValue('--accent').trim();

  const isLight = root.classList.contains('theme-light');

  const base: ITheme = {
    background: v('canvas'),
    foreground: v('ink'),
    cursor: v('accent'),
    cursorAccent: v('canvas'),
    selectionBackground: `rgba(${accentRaw} / 0.3)`,
  };

  // ANSI palette overrides.
  //
  // Dark mode: VS Code Dark+ flavoured — black truly black, brights brighter.
  // Light mode: black/brightBlack mapped to light grays so background chrome
  // disappears; foreground colors stay vivid for syntax/diff highlights.
  if (isLight) {
    return {
      ...base,
      black: '#e5e7eb',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#111827',
      brightBlack: '#d1d5db',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#eab308',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#030712',
    };
  }
  return {
    ...base,
    black: '#1c2128',
    red: '#f47174',
    green: '#7ee787',
    yellow: '#e3b341',
    blue: '#79c0ff',
    magenta: '#d2a8ff',
    cyan: '#56d4dd',
    white: '#c9d1d9',
    brightBlack: '#484f58',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#a5d6ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  };
}
