import type { Session } from '../../shared/session-types';

/**
 * Dev-only seed data so the UI has something to render before real
 * SessionRegistry wiring lands (M4). Each session covers a different
 * status to validate styling.
 */
export function buildMockSessions(): Session[] {
  const now = new Date();
  const minutesAgo = (m: number): string => new Date(now.getTime() - m * 60_000).toISOString();

  return [
    {
      id: 'mock-1',
      cli: 'claude',
      cliSessionId: '11111111-2222-3333-4444-555555555555',
      cwd: '/Users/fixture/workspace/agent-dashboard',
      gitBranch: 'main',
      displayName: 'agent-dashboard · 14:32',
      status: 'working',
      statusConfidence: 'low',
      startedAt: minutesAgo(15),
      lastActivityAt: minutesAgo(0),
      metrics: {
        tokensInput: 24500,
        tokensCached: 158000,
        tokensOutput: 3200,
        estimatedCostUSD: 0.85,
        messageCount: 12,
      },
      latestMessage: {
        role: 'assistant',
        preview: 'Writing the PtyManager class with full lifecycle handling...',
        timestamp: minutesAgo(0),
      },
      currentTool: { name: 'Edit', description: 'electron/pty-manager.ts', startedAt: minutesAgo(0) },
      ptyExitCode: null,
    },
    {
      id: 'mock-2',
      cli: 'claude',
      cliSessionId: '22222222-3333-4444-5555-666666666666',
      cwd: '/Users/fixture/workspace/diggr-app',
      gitBranch: 'feat/onboarding-v2',
      displayName: 'diggr-app · 11:08',
      status: 'waiting',
      statusConfidence: 'high',
      startedAt: minutesAgo(120),
      lastActivityAt: minutesAgo(3),
      metrics: {
        tokensInput: 8200,
        tokensCached: 45000,
        tokensOutput: 1100,
        estimatedCostUSD: 0.22,
        messageCount: 6,
      },
      latestMessage: {
        role: 'assistant',
        preview: 'Should I also migrate the unit tests, or leave them on the old API for now?',
        timestamp: minutesAgo(3),
      },
      currentTool: null,
      ptyExitCode: null,
    },
    {
      id: 'mock-3',
      cli: 'codex',
      cliSessionId: '019eeeee-0000-7000-8000-aaaaaaaaaaaa',
      cwd: '/Users/fixture/workspace/agent-dashboard',
      gitBranch: 'main',
      displayName: 'agent-dashboard · 13:45',
      status: 'working',
      statusConfidence: 'low',
      startedAt: minutesAgo(8),
      lastActivityAt: minutesAgo(0),
      metrics: {
        tokensInput: 12000,
        tokensCached: 1800,
        tokensOutput: 2400,
        estimatedCostUSD: 0.04,
        messageCount: 5,
      },
      latestMessage: {
        role: 'assistant',
        preview: 'Reading the spec to figure out how the resume flow should reconcile with sessions.json...',
        timestamp: minutesAgo(0),
      },
      currentTool: { name: 'shell', description: 'cat docs/design.md', startedAt: minutesAgo(0) },
      ptyExitCode: null,
    },
    {
      id: 'mock-4',
      cli: 'claude',
      cliSessionId: '44444444-5555-6666-7777-888888888888',
      cwd: '/Users/fixture/workspace/no-humans',
      gitBranch: null,
      displayName: 'no-humans · 10:00',
      status: 'idle',
      statusConfidence: 'high',
      startedAt: minutesAgo(240),
      lastActivityAt: minutesAgo(30),
      metrics: {
        tokensInput: 1200,
        tokensCached: 0,
        tokensOutput: 400,
        estimatedCostUSD: 0.05,
        messageCount: 2,
      },
      latestMessage: null,
      currentTool: null,
      ptyExitCode: null,
    },
    {
      id: 'mock-5',
      cli: 'codex',
      cliSessionId: '019eeeee-0000-7000-8000-cccccccccccc',
      cwd: '/Users/fixture/workspace/scratch',
      gitBranch: 'main',
      displayName: 'scratch · 09:15',
      status: 'errored',
      statusConfidence: 'high',
      startedAt: minutesAgo(180),
      lastActivityAt: minutesAgo(60),
      metrics: {
        tokensInput: 0,
        tokensCached: 0,
        tokensOutput: 0,
        estimatedCostUSD: null,
        messageCount: 0,
      },
      latestMessage: {
        role: 'tool',
        preview: 'Process exited unexpectedly: ENOENT (cwd disappeared)',
        timestamp: minutesAgo(60),
      },
      currentTool: null,
      ptyExitCode: 1,
    },
  ];
}
