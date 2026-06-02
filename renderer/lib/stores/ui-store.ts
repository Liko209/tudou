import { create } from 'zustand';
import { useSessionsStore } from './sessions-store';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Right panel max scales with the window (up to 70% of its width) rather
 * than a fixed cap — wide on big displays, never swallowing the whole app
 * on small ones. Falls back to a sane constant during SSR / before the
 * window exists.
 */
function rightPanelMax(): number {
  if (typeof window === 'undefined') return 700;
  return Math.round(window.innerWidth * 0.7);
}

export type PanelKind = 'files' | 'sidechat' | 'terminal';
export type ThemeChoice = 'dark' | 'light';

/**
 * Dock panel state for a SINGLE session. Each session owns its own right /
 * bottom panel (open + which kind), so switching sessions swaps the panels
 * and — because AppShell keeps every session's panel mounted — switching back
 * restores the exact same content, including a terminal's live process.
 * Panel DIMENSIONS stay global (a layout preference, not per-session content).
 */
export interface SessionPanelState {
  rightOpen: boolean;
  rightKind: PanelKind | null;
  bottomOpen: boolean;
  bottomKind: PanelKind | null;
}

/** A session with no remembered panel state — used as the read-time default.
 *  Stable identity so selectors returning it don't churn renders. */
export const EMPTY_PANEL: SessionPanelState = Object.freeze({
  rightOpen: false,
  rightKind: null,
  bottomOpen: false,
  bottomKind: null,
});

const THEME_STORAGE_KEY = 'agent-dashboard.theme';

function loadTheme(): ThemeChoice {
  if (typeof window === 'undefined') return 'dark';
  const v = window.localStorage?.getItem(THEME_STORAGE_KEY);
  return v === 'light' ? 'light' : 'dark';
}

interface UIState {
  /** Left sidebar collapse. Cmd+\ */
  leftCollapsed: boolean;
  /**
   * Per-session dock panel state, keyed by session id. Right panel is
   * VSCode-style (squeezes main, not overlay); bottom panel docks below.
   * Read via `useActivePanel()` / the helpers below — components rarely touch
   * this map directly. Pruned when a session is removed (prunePanels).
   */
  panels: Record<string, SessionPanelState>;
  /**
   * Per-session compose drafts, keyed by session id. The floating compose box
   * over each session terminal writes here so a half-written reply survives
   * scrolling, hiding the box, and switching sessions. Cleared on insert and
   * pruned with the session (prunePanels).
   */
  composeDrafts: Record<string, string>;
  /**
   * Drag offset (px) of the compose box from its default bottom-center spot —
   * global so dragging it once applies to every session's box. {0,0} = default.
   */
  composeOffset: { x: number; y: number };
  /** Drag-resizable dimensions (px) — global, shared across sessions. */
  sidebarWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  newSessionOpen: boolean;
  /**
   * Preselects the project/chat scope inside NewSessionModal so the
   * per-section "+" buttons in the sidebar land the user on the right
   * tab. `null` means "no preset, modal picks its own default".
   */
  newSessionMode: 'project' | 'chat' | null;
  /**
   * Preset working dir for NewSessionModal — set by a project's "+" button so
   * the new session lands in that exact project. null = let the user choose.
   */
  newSessionCwd: string | null;
  /** Section-level fold in the sidebar (collapses ALL items within). */
  sectionsCollapsed: { projects: boolean; chats: boolean };
  hookModalOpen: boolean;
  settingsOpen: boolean;
  /** Full-screen Usage view overlaying the center pane. */
  usageOpen: boolean;
  theme: ThemeChoice;
  /** Transient toast message; null when nothing to show. */
  toast: string | null;

  toggleLeft: () => void;
  setTheme: (theme: ThemeChoice) => void;
  showToast: (message: string) => void;
  clearToast: () => void;
  openNewSession: (mode?: 'project' | 'chat', cwd?: string) => void;
  toggleSectionCollapsed: (section: 'projects' | 'chats') => void;
  /** All panel actions operate on the CURRENTLY ACTIVE session (no-op if none). */
  setRightPanelOpen: (open: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setRightPanelKind: (kind: PanelKind | null) => void;
  setBottomPanelKind: (kind: PanelKind | null) => void;
  setComposeDraft: (sessionId: string, text: string) => void;
  setComposeOffset: (pos: { x: number; y: number }) => void;
  /** Drop per-session UI state (panels + compose drafts) for sessions no
   *  longer present (called by AppShell). */
  prunePanels: (validIds: string[]) => void;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setBottomPanelHeight: (h: number) => void;
  setNewSessionOpen: (open: boolean) => void;
  setHookModalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setUsageOpen: (open: boolean) => void;
}

/** Apply a patch to the active session's panel state; no-op if no active
 *  session. Centralizes the "find active id → merge → write back" dance. */
function patchActivePanel(
  set: (fn: (s: UIState) => Partial<UIState>) => void,
  patch: Partial<SessionPanelState>,
): void {
  const id = useSessionsStore.getState().activeId;
  if (!id) return;
  set((s) => ({
    panels: { ...s.panels, [id]: { ...(s.panels[id] ?? EMPTY_PANEL), ...patch } },
  }));
}

export const useUIStore = create<UIState>((set, get) => ({
  leftCollapsed: false,
  panels: {},
  composeDrafts: {},
  composeOffset: { x: 0, y: 0 },
  sidebarWidth: 240,
  rightPanelWidth: 360,
  bottomPanelHeight: 260,
  newSessionOpen: false,
  hookModalOpen: false,
  settingsOpen: false,
  usageOpen: false,
  theme: loadTheme(),
  toast: null,
  newSessionMode: null,
  newSessionCwd: null,
  sectionsCollapsed: { projects: false, chats: false },

  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  showToast: (message) => set({ toast: message }),
  clearToast: () => set({ toast: null }),
  openNewSession: (mode, cwd) =>
    set({ newSessionOpen: true, newSessionMode: mode ?? null, newSessionCwd: cwd ?? null }),
  toggleSectionCollapsed: (section) =>
    set((s) => ({
      sectionsCollapsed: {
        ...s.sectionsCollapsed,
        [section]: !s.sectionsCollapsed[section],
      },
    })),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    }
    set({ theme });
  },
  setRightPanelOpen: (open) => patchActivePanel(set, { rightOpen: open }),
  setBottomPanelOpen: (open) => patchActivePanel(set, { bottomOpen: open }),
  // Opening into the picker keeps the panel open; picking a kind fills it.
  setRightPanelKind: (kind) => patchActivePanel(set, { rightKind: kind }),
  setBottomPanelKind: (kind) => patchActivePanel(set, { bottomKind: kind }),
  setComposeDraft: (sessionId, text) =>
    set((s) => ({ composeDrafts: { ...s.composeDrafts, [sessionId]: text } })),
  setComposeOffset: (pos) => set({ composeOffset: pos }),
  prunePanels: (validIds) => {
    const { panels, composeDrafts } = get();
    const valid = new Set(validIds);
    const deadPanels = Object.keys(panels).filter((id) => !valid.has(id));
    const deadDrafts = Object.keys(composeDrafts).filter((id) => !valid.has(id));
    if (deadPanels.length === 0 && deadDrafts.length === 0) return; // no change
    const nextPanels = { ...panels };
    for (const id of deadPanels) delete nextPanels[id];
    const nextDrafts = { ...composeDrafts };
    for (const id of deadDrafts) delete nextDrafts[id];
    set({ panels: nextPanels, composeDrafts: nextDrafts });
  },
  setSidebarWidth: (w) => set({ sidebarWidth: clamp(w, 180, 400) }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: clamp(w, 240, rightPanelMax()) }),
  setBottomPanelHeight: (h) => set({ bottomPanelHeight: clamp(h, 160, 600) }),
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
  setHookModalOpen: (open) => set({ hookModalOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setUsageOpen: (open) => set({ usageOpen: open }),
}));

/**
 * The active session's dock panel state (or EMPTY_PANEL when there's no active
 * session / it has no remembered state). Re-renders when the active session
 * changes or when that session's panel state changes.
 */
export function useActivePanel(): SessionPanelState {
  const activeId = useSessionsStore((s) => s.activeId);
  return useUIStore((s) => (activeId ? (s.panels[activeId] ?? EMPTY_PANEL) : EMPTY_PANEL));
}
