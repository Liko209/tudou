import { create } from 'zustand';
import type { Session, SessionUpdate } from '../../../shared/session-types';

interface SessionsState {
  sessions: Record<string, Session>;
  activeId: string | null;

  upsertSession: (session: Session) => void;
  applyUpdate: (id: string, update: SessionUpdate) => void;
  removeSession: (id: string) => void;
  setActive: (id: string | null) => void;
  bulkReplace: (sessions: Session[]) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: {},
  activeId: null,

  upsertSession: (session) =>
    set((state) => ({ sessions: { ...state.sessions, [session.id]: session } })),

  applyUpdate: (id, update) =>
    set((state) => {
      const current = state.sessions[id];
      if (!current) return state;
      const next: Session = {
        ...current,
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.cliSessionId !== undefined
          ? { cliSessionId: update.cliSessionId }
          : {}),
        ...(update.gitBranch !== undefined ? { gitBranch: update.gitBranch } : {}),
        ...(update.metrics !== undefined ? { metrics: update.metrics } : {}),
        ...(update.latestMessage !== undefined
          ? { latestMessage: update.latestMessage }
          : {}),
        ...(update.currentTool !== undefined ? { currentTool: update.currentTool } : {}),
        lastActivityAt: new Date().toISOString(),
      };
      return { sessions: { ...state.sessions, [id]: next } };
    }),

  removeSession: (id) =>
    set((state) => {
      if (!state.sessions[id]) return state;
      const next = { ...state.sessions };
      delete next[id];
      return {
        sessions: next,
        activeId: state.activeId === id ? null : state.activeId,
      };
    }),

  setActive: (id) => set({ activeId: id }),

  bulkReplace: (sessions) =>
    set({
      sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
    }),
}));

/**
 * Selector that returns a stable reference (or null) — safe to use directly
 * with useSessionsStore() without triggering useSyncExternalStore's
 * snapshot-caching guard.
 */
export function selectActiveSession(state: SessionsState): Session | null {
  return state.activeId ? (state.sessions[state.activeId] ?? null) : null;
}

/**
 * Pure derivations. These create new arrays each call, so DO NOT pass them
 * straight to useSessionsStore() — that triggers React's "getSnapshot must
 * be cached" infinite-loop guard. In components, subscribe to the raw
 * `sessions` map and wrap the call in useMemo:
 *
 *   const sessions = useSessionsStore((s) => s.sessions);
 *   const groups = useMemo(() => groupSessionsByCwd(sessions), [sessions]);
 */
export function sortSessionsByActivity(sessions: Record<string, Session>): Session[] {
  return Object.values(sessions).sort((a, b) =>
    a.lastActivityAt < b.lastActivityAt ? 1 : -1,
  );
}

export function groupSessionsByCwd(
  sessions: Record<string, Session>,
): Array<{ cwd: string; items: Session[] }> {
  const groups = new Map<string, Session[]>();
  for (const s of Object.values(sessions)) {
    const arr = groups.get(s.cwd) ?? [];
    arr.push(s);
    groups.set(s.cwd, arr);
  }
  return [...groups.entries()]
    .map(([cwd, items]) => ({
      cwd,
      items: items.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1)),
    }))
    .sort((a, b) => {
      const aT = a.items[0]?.lastActivityAt ?? '';
      const bT = b.items[0]?.lastActivityAt ?? '';
      return aT < bT ? 1 : -1;
    });
}

/**
 * Split sessions into projects (grouped by cwd) vs chats (flat list).
 * A session is a Chat if its cwd lives under `chatsBaseDir`.
 */
export function partitionSessions(
  sessions: Record<string, Session>,
  chatsBaseDir: string,
): {
  projects: Array<{ cwd: string; items: Session[] }>;
  chats: Session[];
} {
  const projectSessions: Record<string, Session> = {};
  const chats: Session[] = [];
  for (const [id, s] of Object.entries(sessions)) {
    if (chatsBaseDir && s.cwd.startsWith(chatsBaseDir)) {
      chats.push(s);
    } else {
      projectSessions[id] = s;
    }
  }
  chats.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  return {
    projects: groupSessionsByCwd(projectSessions),
    chats,
  };
}
