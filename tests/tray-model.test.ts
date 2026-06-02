import { describe, it, expect } from 'vitest';
import { buildTrayModel, interventionCount } from '../electron/tray-model';
import type { Session, SessionStatus } from '../shared/session-types';

function sess(over: Partial<Session> & { status: SessionStatus; id: string }): Session {
  return {
    cli: 'claude',
    cliSessionId: null,
    cwd: '/Users/me/work/proj',
    gitBranch: null,
    displayName: 'proj · 10:00',
    title: null,
    status: over.status,
    statusConfidence: 'high',
    startedAt: '2026-01-01T00:00:00Z',
    lastActivityAt: '2026-01-01T00:00:00Z',
    metrics: {
      tokensInput: 0,
      tokensOutput: 0,
      tokensCached: 0,
      estimatedCostUSD: null,
      messageCount: 0,
    },
    latestMessage: null,
    currentTool: null,
    ptyExitCode: null,
    ...over,
  };
}

describe('interventionCount', () => {
  it('counts only blocked sessions (not waiting/working)', () => {
    const list = [
      sess({ id: 'a', status: 'blocked' }),
      sess({ id: 'b', status: 'waiting' }),
      sess({ id: 'c', status: 'working' }),
      sess({ id: 'd', status: 'blocked' }),
    ];
    expect(interventionCount(list)).toBe(2);
  });
  it('is 0 when nothing is blocked, even with many waiting', () => {
    expect(interventionCount([sess({ id: 'a', status: 'waiting' }), sess({ id: 'b', status: 'waiting' })])).toBe(0);
  });
});

describe('buildTrayModel', () => {
  it('icon + badge reflect blocked, not waiting', () => {
    const m = buildTrayModel([
      sess({ id: 'a', status: 'waiting' }),
      sess({ id: 'b', status: 'waiting' }),
      sess({ id: 'c', status: 'working' }),
    ]);
    expect(m.iconVariant).toBe('idle'); // nothing blocked → quiet icon
    expect(m.interventionCount).toBe(0);

    const m2 = buildTrayModel([sess({ id: 'a', status: 'blocked' }), sess({ id: 'b', status: 'waiting' })]);
    expect(m2.iconVariant).toBe('attention');
    expect(m2.interventionCount).toBe(1); // the blocked one, not the waiting one
  });

  it('groups sessions by status with counts', () => {
    const m = buildTrayModel([
      sess({ id: 'a', status: 'blocked' }),
      sess({ id: 'b', status: 'working' }),
      sess({ id: 'c', status: 'starting' }),
      sess({ id: 'd', status: 'waiting' }),
      sess({ id: 'e', status: 'errored' }),
    ]);
    const keys = m.groups.map((g) => g.key);
    expect(keys).toEqual(['blocked', 'errored', 'working', 'idle']);
    // starting folds into the working group
    expect(m.groups.find((g) => g.key === 'working')?.items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(m.counts).toEqual({ blocked: 1, errored: 1, working: 1, waiting: 1, total: 5 });
  });

  it('uses title over displayName and shows the current tool for working sessions', () => {
    const m = buildTrayModel([
      sess({
        id: 'a',
        status: 'working',
        title: 'fix auth',
        cwd: '/Users/me/work/agent-dashboard',
        currentTool: { name: 'Edit', startedAt: '2026-01-01T00:00:00Z' } as Session['currentTool'],
      }),
    ]);
    const item = m.groups[0].items[0];
    expect(item.name).toBe('fix auth');
    expect(item.sublabel).toBe('agent-dashboard · Edit');
  });

  it('blocked items read "waiting on you"', () => {
    const m = buildTrayModel([sess({ id: 'a', status: 'blocked', cwd: '/x/demo' })]);
    expect(m.groups[0].items[0].sublabel).toBe('demo · waiting on you');
  });

  it('empty + tooltip copy', () => {
    expect(buildTrayModel([]).tooltip).toBe('Tudou — no sessions');
    expect(buildTrayModel([sess({ id: 'a', status: 'blocked' })]).tooltip).toBe('Tudou — 1 needs you');
    const m = buildTrayModel([
      sess({ id: 'a', status: 'blocked' }),
      sess({ id: 'b', status: 'blocked' }),
      sess({ id: 'c', status: 'working' }),
      sess({ id: 'd', status: 'waiting' }),
    ]);
    expect(m.tooltip).toBe('Tudou — 2 need you · 1 working · 1 idle');
  });
});
