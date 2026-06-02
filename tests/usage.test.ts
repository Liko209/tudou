import { describe, expect, it } from 'vitest';
import type { Session, SessionStatus } from '../shared/session-types';
import { summarizeUsage } from '../renderer/lib/usage';

let seq = 0;
function mk(overrides: Partial<Session> & { metrics?: Partial<Session['metrics']> }): Session {
  const { metrics, ...rest } = overrides;
  seq += 1;
  return {
    id: `s${seq}`,
    cli: 'claude',
    cliSessionId: null,
    cwd: '/tmp/proj',
    gitBranch: null,
    displayName: `s${seq}`,
    title: null,
    status: 'working',
    statusConfidence: 'high',
    startedAt: new Date(0).toISOString(),
    lastActivityAt: new Date(0).toISOString(),
    latestMessage: null,
    currentTool: null,
    ptyExitCode: null,
    ...rest,
    metrics: {
      tokensInput: 0,
      tokensOutput: 0,
      tokensCached: 0,
      estimatedCostUSD: null,
      messageCount: 0,
      ...metrics,
    },
  };
}

describe('summarizeUsage', () => {
  it('sums tokens and cost; null cost counts as 0 but is flagged', () => {
    const s = summarizeUsage([
      mk({ model: 'claude-opus-4-7', metrics: { tokensInput: 100, tokensOutput: 10, tokensCached: 50, estimatedCostUSD: 1.5 } }),
      mk({ model: 'claude-opus-4-7', metrics: { tokensInput: 200, tokensOutput: 20, tokensCached: 0, estimatedCostUSD: null } }),
    ]);
    expect(s.tokensInput).toBe(300);
    expect(s.tokensOutput).toBe(30);
    expect(s.tokensCached).toBe(50);
    expect(s.totalTokens).toBe(380);
    expect(s.totalCostUSD).toBeCloseTo(1.5);
    expect(s.hasCostData).toBe(true);
    expect(s.sessionCount).toBe(2);
  });

  it('hasCostData is false when no session reports a cost', () => {
    const s = summarizeUsage([mk({ metrics: { estimatedCostUSD: null } })]);
    expect(s.hasCostData).toBe(false);
    expect(s.totalCostUSD).toBe(0);
  });

  it('counts sessions by status across all six states', () => {
    const statuses: SessionStatus[] = ['working', 'working', 'waiting', 'blocked'];
    const s = summarizeUsage(statuses.map((status) => mk({ status })));
    expect(s.statusCounts.working).toBe(2);
    expect(s.statusCounts.waiting).toBe(1);
    expect(s.statusCounts.blocked).toBe(1);
    expect(s.statusCounts.errored).toBe(0);
    expect(s.statusCounts.exited).toBe(0);
    expect(s.statusCounts.starting).toBe(0);
  });

  it('groups by model, sorted by tokens desc, with unknown fallback', () => {
    const s = summarizeUsage([
      mk({ model: 'claude-sonnet-4-6', metrics: { tokensInput: 100, estimatedCostUSD: 0.3 } }),
      mk({ model: 'claude-opus-4-7', metrics: { tokensInput: 1000, estimatedCostUSD: 5 } }),
      mk({ model: 'claude-opus-4-7', metrics: { tokensOutput: 500, estimatedCostUSD: 2 } }),
      mk({ model: null, metrics: { tokensInput: 10 } }),
    ]);
    expect(s.byModel.map((m) => m.model)).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6', 'unknown']);
    const opus = s.byModel[0]!;
    expect(opus.sessions).toBe(2);
    expect(opus.tokens).toBe(1500);
    expect(opus.costUSD).toBeCloseTo(7);
  });

  it('handles an empty session list', () => {
    const s = summarizeUsage([]);
    expect(s.sessionCount).toBe(0);
    expect(s.totalTokens).toBe(0);
    expect(s.totalCostUSD).toBe(0);
    expect(s.hasCostData).toBe(false);
    expect(s.byModel).toEqual([]);
    expect(s.statusCounts.working).toBe(0);
  });
});
