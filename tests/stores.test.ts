/**
 * Zustand store tests.
 * These run in Node — Zustand has no DOM dependency.
 * The store modules live under renderer/lib/stores/ for ergonomic
 * imports in renderer components.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  useSessionsStore,
  selectActiveSession,
  groupSessionsByCwd,
  sortSessionsByActivity,
} from '../renderer/lib/stores/sessions-store';
import { useUIStore } from '../renderer/lib/stores/ui-store';
import { buildMockSessions } from '../renderer/lib/mock-sessions';

beforeEach(() => {
  useSessionsStore.setState({ sessions: {}, activeId: null });
  useUIStore.setState({
    leftCollapsed: false,
    panels: {},
    newSessionOpen: false,
    hookModalOpen: false,
    settingsOpen: false,
  });
});

describe('sessionsStore', () => {
  it('upsertSession adds a session by id', () => {
    const sessions = buildMockSessions();
    useSessionsStore.getState().upsertSession(sessions[0]!);
    expect(Object.keys(useSessionsStore.getState().sessions)).toEqual(['mock-1']);
  });

  it('upsertSession is idempotent and overwrites', () => {
    const sessions = buildMockSessions();
    useSessionsStore.getState().upsertSession(sessions[0]!);
    useSessionsStore.getState().upsertSession({
      ...sessions[0]!,
      displayName: 'renamed',
    });
    expect(useSessionsStore.getState().sessions['mock-1']?.displayName).toBe('renamed');
  });

  it('applyUpdate merges partial fields without clobbering others', () => {
    const [s] = buildMockSessions();
    useSessionsStore.getState().upsertSession(s!);
    useSessionsStore.getState().applyUpdate(s!.id, { status: 'blocked' });
    const after = useSessionsStore.getState().sessions[s!.id]!;
    expect(after.status).toBe('blocked');
    expect(after.cwd).toBe(s!.cwd); // unrelated fields preserved
  });

  it('applyUpdate ignores unknown id silently', () => {
    expect(() =>
      useSessionsStore.getState().applyUpdate('does-not-exist', { status: 'blocked' }),
    ).not.toThrow();
  });

  it('removeSession deletes and clears activeId if it matched', () => {
    const sessions = buildMockSessions();
    useSessionsStore.getState().bulkReplace(sessions);
    useSessionsStore.getState().setActive('mock-2');
    useSessionsStore.getState().removeSession('mock-2');
    expect(useSessionsStore.getState().sessions['mock-2']).toBeUndefined();
    expect(useSessionsStore.getState().activeId).toBeNull();
  });

  it('removeSession does not change activeId when a different session is removed', () => {
    const sessions = buildMockSessions();
    useSessionsStore.getState().bulkReplace(sessions);
    useSessionsStore.getState().setActive('mock-1');
    useSessionsStore.getState().removeSession('mock-2');
    expect(useSessionsStore.getState().activeId).toBe('mock-1');
  });

  it('selectActiveSession returns the active session or null', () => {
    const sessions = buildMockSessions();
    useSessionsStore.getState().bulkReplace(sessions);
    expect(selectActiveSession(useSessionsStore.getState())).toBeNull();
    useSessionsStore.getState().setActive('mock-3');
    expect(selectActiveSession(useSessionsStore.getState())?.id).toBe('mock-3');
  });

  it('sortSessionsByActivity returns sessions sorted by lastActivityAt desc', () => {
    const sessions = buildMockSessions();
    useSessionsStore.getState().bulkReplace(sessions);
    const sorted = sortSessionsByActivity(useSessionsStore.getState().sessions);
    // mock-1 and mock-3 have the most recent activity (now); mock-5 is oldest
    const ids = sorted.map((s) => s.id);
    expect(ids[ids.length - 1]).toBe('mock-5');
  });

  it('groupSessionsByCwd groups sessions by cwd', () => {
    const sessions = buildMockSessions();
    useSessionsStore.getState().bulkReplace(sessions);
    const groups = groupSessionsByCwd(useSessionsStore.getState().sessions);
    const cwds = groups.map((g) => g.cwd);
    // 4 distinct cwds in the mock data (agent-dashboard appears twice)
    expect(cwds).toContain('/Users/fixture/workspace/agent-dashboard');
    const dashboard = groups.find((g) => g.cwd === '/Users/fixture/workspace/agent-dashboard');
    expect(dashboard?.items.length).toBe(2);
  });
});

describe('uiStore', () => {
  it('toggleLeft flips left sidebar collapse', () => {
    useUIStore.getState().toggleLeft();
    expect(useUIStore.getState().leftCollapsed).toBe(true);
    useUIStore.getState().toggleLeft();
    expect(useUIStore.getState().leftCollapsed).toBe(false);
  });

  it('dock panel state is per-session (keyed on the active session)', () => {
    const [a] = buildMockSessions();
    useSessionsStore.setState({ sessions: { [a!.id]: a! }, activeId: a!.id });

    useUIStore.getState().setRightPanelOpen(true);
    expect(useUIStore.getState().panels[a!.id]?.rightOpen).toBe(true);
    useUIStore.getState().setBottomPanelOpen(true);
    expect(useUIStore.getState().panels[a!.id]?.bottomOpen).toBe(true);
    useUIStore.getState().setRightPanelOpen(false);
    expect(useUIStore.getState().panels[a!.id]?.rightOpen).toBe(false);
  });

  it('panel actions no-op when there is no active session', () => {
    useSessionsStore.setState({ sessions: {}, activeId: null });
    useUIStore.getState().setRightPanelOpen(true);
    expect(useUIStore.getState().panels).toEqual({});
  });

  it('prunePanels drops state for sessions no longer present', () => {
    useUIStore.setState({
      panels: {
        keep: { rightOpen: true, rightKind: 'terminal', bottomOpen: false, bottomKind: null },
        gone: { rightOpen: true, rightKind: 'files', bottomOpen: false, bottomKind: null },
      },
    });
    useUIStore.getState().prunePanels(['keep']);
    const panels = useUIStore.getState().panels;
    expect(Object.keys(panels)).toEqual(['keep']);
  });

  it('setNewSessionOpen toggles modal state', () => {
    useUIStore.getState().setNewSessionOpen(true);
    expect(useUIStore.getState().newSessionOpen).toBe(true);
    useUIStore.getState().setNewSessionOpen(false);
    expect(useUIStore.getState().newSessionOpen).toBe(false);
  });
});
