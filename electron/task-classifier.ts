// Deterministic task-category classification (no LLM). Each assistant turn is
// bucketed from the tools it used, the shell commands it ran, and the keywords
// in the user prompt that triggered it. Inspired by CodeBurn's 13 categories.

export const TASK_CATEGORIES = [
  'Coding',
  'Debugging',
  'Feature Dev',
  'Refactoring',
  'Testing',
  'Exploration',
  'Planning',
  'Delegation',
  'Git Ops',
  'Build/Deploy',
  'Brainstorming',
  'Conversation',
  'General',
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

const has = (s: string, words: string[]): boolean => words.some((w) => s.includes(w));

export interface ClassifyInput {
  /** tool_use names in the assistant turn. */
  tools: string[];
  /** Concatenated Bash command strings from the turn (lowercased internally). */
  bash: string;
  /** The user prompt text that triggered the turn (best-effort). */
  userText: string;
}

/**
 * Classify one assistant turn into a single task category. Precedence: what was
 * actually run in the shell (strongest) → delegation/planning tools → edits
 * refined by prompt intent → read-only exploration → text-only by prompt.
 */
export function classifyTask({ tools, bash, userText }: ClassifyInput): TaskCategory {
  const b = bash.toLowerCase();
  const u = userText.toLowerCase();
  const t = new Set(tools);
  const hasEdit = t.has('Edit') || t.has('Write') || t.has('MultiEdit') || t.has('NotebookEdit');
  const hasRead = t.has('Read') || t.has('Grep') || t.has('Glob') || t.has('LS');

  if (b) {
    if (has(b, ['pytest', 'vitest', 'jest', ' go test', 'cargo test', 'npm test', 'npm run test', 'mocha', 'rspec', 'phpunit', 'playwright']))
      return 'Testing';
    if (has(b, ['git commit', 'git push', 'git rebase', 'git merge', 'git checkout', 'git cherry', 'git add', 'git pull', 'git stash']))
      return 'Git Ops';
    if (has(b, ['npm run build', 'yarn build', 'pnpm build', 'docker build', 'cargo build', 'make ', 'terraform', 'kubectl', 'vercel', 'npm publish', 'deploy']))
      return 'Build/Deploy';
  }

  if (t.has('Task')) return 'Delegation';
  if (t.has('TodoWrite') && !hasEdit) return 'Planning';

  if (hasEdit) {
    if (has(u, ['add ', 'create ', 'implement', 'build a', 'new feature', 'support for', 'introduce'])) return 'Feature Dev';
    if (has(u, ['refactor', 'clean up', 'cleanup', 'rename', 'restructure', 'extract', 'simplify', 'reorganize', 'dedupe'])) return 'Refactoring';
    if (has(u, ['fix', 'bug', 'error', 'crash', 'broken', 'not working', "doesn't work", 'issue', 'fail', 'regression'])) return 'Debugging';
    return 'Coding';
  }

  if (hasRead) return 'Exploration';

  if (has(u, ['plan', 'design', 'architecture', 'approach', 'how should', 'strategy', 'spec'])) return 'Planning';
  if (has(u, ['idea', 'brainstorm', 'option', 'alternative', 'what if', 'trade-off', 'tradeoff', 'should we', 'consider'])) return 'Brainstorming';
  if (has(u, ['fix', 'bug', 'error', 'why ', "isn't", 'broken'])) return 'Debugging';
  if (u) return 'Conversation';
  return 'General';
}
