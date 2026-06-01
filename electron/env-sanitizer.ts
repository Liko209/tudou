/**
 * Strip env vars that would make a spawned AI CLI think it's nested
 * inside another AI agent. The dashboard's Electron main inherits its
 * parent process env at launch — if the user started us from a shell
 * that itself was launched by Claude Code (or Codex Desktop), those
 * tools' "I'm wrapping you" env vars leak in and cause the spawned CLI
 * to run in some companion / wrapped mode instead of standalone (e.g.
 * codex with CODEX_COMPANION_SESSION_ID set goes via broker socket and
 * never writes ~/.codex/sessions/*.jsonl, which breaks our adapter).
 */
const STRIP_PREFIXES = [
  // Claude Code injects these into every subprocess it spawns.
  'CLAUDECODE',
  'CLAUDE_CODE_',
  'CLAUDE_PLUGIN_',
  'CLAUDE_PROJECT_',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_',
  'ANTHROPIC_CODE_',
  // Codex Desktop / Codex companion plugin.
  'CODEX_COMPANION_',
  'CODEX_PLUGIN_',
];

export interface SanitizeOptions {
  /**
   * Active dashboard theme. When set, injects `COLORFGBG` so TUIs that
   * sniff the host terminal's color scheme (Claude Code, fzf, vim, …)
   * render their own chrome to match — avoiding dark reverse-video
   * banners on a light dashboard background. The values are the de-facto
   * convention iTerm2 / urxvt use: `fg;bg` as ANSI color indices.
   */
  theme?: 'dark' | 'light';
}

export function sanitizeSpawnEnv(
  env: NodeJS.ProcessEnv,
  opts: SanitizeOptions = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (STRIP_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) continue;
    out[key] = value;
  }
  if (opts.theme === 'light') {
    out.COLORFGBG = '0;15'; // black fg on white bg
  } else if (opts.theme === 'dark') {
    out.COLORFGBG = '15;0'; // white fg on black bg
  }
  return out;
}
