/**
 * Resolve the *effective* theme (dark or light) at call time, by reading
 * the class `useTheme()` has applied to <html>. Use when handing the
 * theme to main for env-var injection — the store may say 'system', but
 * what matters to a spawning subprocess is the concrete colour scheme
 * the user is actually looking at right now.
 */
export function resolveActiveTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('theme-light') ? 'light' : 'dark';
}
