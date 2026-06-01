import { create } from 'zustand';
import type {
  PreviousSession,
  Session,
  SessionUpdate,
} from '../../../shared/session-types';

interface SessionsState {
  sessions: Record<string, Session>;
  /**
   * Persisted-but-not-running sessions. Surfaced in the sidebar as
   * dormant entries that the user can click to lazily resume.
   * Sourced from main via `sessions.listPrevious()` and refreshed
   * whenever the live list changes.
   */
  previous: PreviousSession[];
  activeId: string | null;

  upsertSession: (session: Session) => void;
  applyUpdate: (id: string, update: SessionUpdate) => void;
  removeSession: (id: string) => void;
  setActive: (id: string | null) => void;
  bulkReplace: (sessions: Session[]) => void;
  setPrevious: (list: PreviousSession[]) => void;
  removePrevious: (id: string) => void;
  renamePrevious: (id: string, title: string | null) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: {},
  previous: [],
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

  setPrevious: (list) => set({ previous: list }),

  removePrevious: (id) =>
    set((state) => ({ previous: state.previous.filter((p) => p.id !== id) })),

  renamePrevious: (id, title) =>
    set((state) => ({
      previous: state.previous.map((p) => (p.id === id ? { ...p, title } : p)),
    })),
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
    // panelOnly sessions belong to a dock panel — never show in sidebar.
    if (s.panelOnly) continue;
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

/**
 * Unified sidebar item — either a live session or a dormant previous one.
 * Built by merging the live `sessions` map with the `previous` list and
 * deduping by cliSessionId (live wins).
 */
export interface SidebarItem {
  /** Stable key for React: live session id or previous record id. */
  key: string;
  cli: Session['cli'];
  cwd: string;
  displayName: string;
  /** Custom/auto title; falls back to displayName when null. */
  title: string | null;
  /** Creation time — used for the stable sidebar order (newest appended). */
  startedAt: string;
  lastActivityAt: string;
  isLive: boolean;
  live: Session | null;
  dormant: PreviousSession | null;
}

function liveToItem(s: Session): SidebarItem {
  return {
    key: s.id,
    cli: s.cli,
    cwd: s.cwd,
    displayName: s.displayName,
    title: s.title,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    isLive: true,
    live: s,
    dormant: null,
  };
}

function dormantToItem(p: PreviousSession): SidebarItem {
  return {
    key: `prev:${p.id}`,
    cli: p.cli,
    cwd: p.cwd,
    displayName: p.displayName,
    title: p.title ?? null,
    startedAt: p.startedAt,
    lastActivityAt: p.startedAt,
    isLive: false,
    live: null,
    dormant: p,
  };
}

/**
 * Merge live sessions + dormant previous sessions into one sidebar list,
 * partitioned into Projects (grouped by cwd) and Chats (flat). Dedupes
 * by cliSessionId — if a previous record matches a live session's id,
 * the live one wins and the dormant copy is dropped.
 */
export function buildSidebarItems(
  sessions: Record<string, Session>,
  previous: PreviousSession[],
  chatsBaseDir: string,
): {
  projects: Array<{ cwd: string; items: SidebarItem[] }>;
  chats: SidebarItem[];
} {
  // Dedup keys — a previous record is considered "the same as" a live
  // session when EITHER their internal dashboard id matches (always
  // true right after a resume) OR their `cli:cliSessionId` pair matches
  // (catches the moment after the adapter has discovered cliSessionId
  // but before the persistence record was rewritten). Without the id
  // check, a freshly-resumed session briefly renders as two rows
  // because the live Session starts with cliSessionId=null while its
  // persistence row already carries the resume target.
  const liveIds = new Set<string>(Object.keys(sessions));
  const liveCliIds = new Set<string>();
  for (const s of Object.values(sessions)) {
    if (s.cliSessionId) liveCliIds.add(`${s.cli}:${s.cliSessionId}`);
  }

  const items: SidebarItem[] = [];
  for (const s of Object.values(sessions)) {
    if (s.panelOnly) continue;
    items.push(liveToItem(s));
  }
  for (const p of previous) {
    if (liveIds.has(p.id)) continue;
    if (p.cliSessionId && liveCliIds.has(`${p.cli}:${p.cliSessionId}`)) continue;
    items.push(dormantToItem(p));
  }

  const projects = new Map<string, SidebarItem[]>();
  const chats: SidebarItem[] = [];
  for (const it of items) {
    if (chatsBaseDir && it.cwd.startsWith(chatsBaseDir)) {
      chats.push(it);
    } else {
      const arr = projects.get(it.cwd) ?? [];
      arr.push(it);
      projects.set(it.cwd, arr);
    }
  }

  // Newest-first by creation time. Stable on purpose: selecting (or resuming)
  // a session never changes its startedAt, so the list doesn't reshuffle on
  // click — manual drag-reorder is the only other intended reordering.
  const byCreatedDesc = (a: SidebarItem, b: SidebarItem): number =>
    a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0;
  const sortItems = (arr: SidebarItem[]): SidebarItem[] => arr.sort(byCreatedDesc);
  // A project's stable rank = when it FIRST appeared (its oldest session).
  const firstSeen = (arr: SidebarItem[]): string =>
    arr.reduce((min, it) => (it.startedAt < min ? it.startedAt : min), arr[0]?.startedAt ?? '');

  chats.sort(byCreatedDesc);

  return {
    projects: [...projects.entries()]
      .map(([cwd, arr]) => ({ cwd, items: sortItems(arr) }))
      // Newest project on top, ranked by first appearance. Creating a session
      // inside an existing project changes its newest item but not its oldest,
      // so the project keeps its position — only the session moves to the top
      // of that project.
      .sort((a, b) => {
        const aT = firstSeen(a.items);
        const bT = firstSeen(b.items);
        return aT > bT ? -1 : aT < bT ? 1 : 0;
      }),
    chats,
  };
}
