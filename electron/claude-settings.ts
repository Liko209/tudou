import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/**
 * Align Claude Code's persisted `theme` to match the dashboard.
 *
 * Claude Code stores its TUI theme as a top-level `theme` key in
 * `~/.claude/settings.json` (set via the `/theme` slash command). It
 * reads this once at startup and uses it to choose between dark and
 * light chrome — there's no CLI flag, env var, or OSC query that
 * influences it. So before we spawn a Claude session, we make sure the
 * file says what we want.
 *
 * Best-effort: any read/parse/write failure is logged and swallowed —
 * we never want a theme mismatch to block spawning a session.
 *
 * Only newly-spawned sessions pick up the change; live ones keep
 * whatever theme they started with until restarted.
 */
export function setClaudeTheme(theme: 'dark' | 'light'): void {
  try {
    let settings: Record<string, unknown> = {};
    let existed = false;
    try {
      const raw = readFileSync(SETTINGS_PATH, 'utf8');
      settings = JSON.parse(raw) as Record<string, unknown>;
      existed = true;
    } catch (err) {
      // ENOENT is fine (we'll create the file); other parse errors
      // mean the file is malformed — bail rather than corrupt it.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn('[claude-settings] cannot parse settings.json:', err);
        return;
      }
    }

    if (settings.theme === theme) return; // no-op

    settings.theme = theme;

    // Atomic write: stage a sibling temp file then rename.
    const dir = dirname(SETTINGS_PATH);
    if (!existed) mkdirSync(dir, { recursive: true });
    const tmp = `${SETTINGS_PATH}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    renameSync(tmp, SETTINGS_PATH);
  } catch (err) {
    console.warn('[claude-settings] failed to set theme:', err);
  }
}
