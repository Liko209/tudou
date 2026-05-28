/**
 * Detects "you need to log in" CLI startup messages by pattern-matching
 * the early PTY output. False positives mark a session as broken when
 * it's actually fine, so patterns are deliberately conservative —
 * specific phrases used by Claude Code and Codex on auth failure.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;?]*[A-Za-z]/g;

const LOGIN_PATTERNS: RegExp[] = [
  // Generic
  /not\s+signed\s+in/i,
  /please\s+(sign|log)\s+in/i,
  /authentication\s+(?:is\s+)?required/i,
  /invalid\s+refresh\s+token/i,

  // Claude Code
  /run\s+`?claude\s+(?:login|auth)`?/i,
  /\bclaude\s+\/?login\b/i,

  // Codex
  /\bcodex\s+(?:auth\s+)?login\b/i,
  /to\s+sign\s+in.{0,40}run/i,

  // OAuth device flow indicators
  /enter\s+the\s+code/i,
  /device[- ]code/i,
];

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/**
 * Look for known login-prompt phrases in `buffer`. Returns the matched
 * pattern's source on hit (useful for logs) or null.
 */
export function detectLoginPrompt(buffer: string): string | null {
  const flat = stripAnsi(buffer);
  for (const re of LOGIN_PATTERNS) {
    if (re.test(flat)) return re.source;
  }
  return null;
}
