/**
 * Tiny path helpers usable from the renderer (no Node `path` module).
 */
export function basename(p: string): string {
  if (!p) return '';
  const stripped = p.replace(/\/+$/, '');
  const idx = stripped.lastIndexOf('/');
  return idx >= 0 ? stripped.slice(idx + 1) : stripped;
}

export function dirname(p: string): string {
  if (!p) return '';
  const stripped = p.replace(/\/+$/, '');
  const idx = stripped.lastIndexOf('/');
  return idx > 0 ? stripped.slice(0, idx) : '/';
}

/** Shorten /Users/foo/a/b/c → ~/a/b/c when home matches. */
export function tildify(absPath: string, home: string | null | undefined): string {
  if (!home) return absPath;
  return absPath.startsWith(home + '/') ? '~' + absPath.slice(home.length) : absPath;
}
