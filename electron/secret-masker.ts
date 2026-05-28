/**
 * Pattern-based secret masking for `latestMessage.preview` strings.
 *
 * The goal is conservative: we'd rather miss a few exotic tokens than
 * mask normal text. Patterns target high-confidence shapes — recognised
 * provider prefixes plus a high-entropy generic fallback — and replace
 * the secret with a short literal tag so the user still sees something
 * meaningful in the sidebar.
 *
 * This runs over what's already a 200-char preview, so it's hot enough
 * to keep the regex list short.
 */

interface MaskPattern {
  /** Stable name, used as the replacement label. */
  name: string;
  pattern: RegExp;
}

const PATTERNS: MaskPattern[] = [
  // More-specific Anthropic prefix must run before the generic OpenAI one,
  // otherwise `sk-ant-…` would get tagged OPENAI_KEY.
  { name: 'ANTHROPIC_KEY', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'OPENAI_KEY', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  // GitHub Personal Access Tokens.
  { name: 'GITHUB_TOKEN', pattern: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: 'GITHUB_OAUTH', pattern: /\bgho_[A-Za-z0-9]{36,}\b/g },
  { name: 'GITHUB_APP', pattern: /\b(ghs|ghu)_[A-Za-z0-9]{36,}\b/g },
  // AWS access keys / secrets.
  { name: 'AWS_KEY_ID', pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  { name: 'AWS_TEMP_KEY', pattern: /\bASIA[A-Z0-9]{16}\b/g },
  // Slack tokens.
  { name: 'SLACK_TOKEN', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  // Stripe live secret keys.
  { name: 'STRIPE_KEY', pattern: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  // Google API keys (39 char prefix-y).
  { name: 'GOOGLE_API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // JWT-shaped (three base64url chunks separated by dots).
  {
    name: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
];

/**
 * Replace any high-confidence secret occurrences with a short `[name]`
 * placeholder. Returns the input unchanged when nothing matches.
 */
export function maskSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { name, pattern } of PATTERNS) {
    out = out.replace(pattern, `[${name}]`);
  }
  return out;
}
