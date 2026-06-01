import { create } from 'zustand';

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
export type ThemeChoice = 'dark' | 'light' | 'system';

const THEME_STORAGE_KEY = 'agent-dashboard.theme';

function loadTheme(): ThemeChoice {
  if (typeof window === 'undefined') return 'dark';
  const v = window.localStorage?.getItem(THEME_STORAGE_KEY);
  return v === 'light' || v === 'system' ? v : 'dark';
}

interface UIState {
  /** Left sidebar collapse. Cmd+\ */
  leftCollapsed: boolean;
  /** Right dock panel (VSCode-style — squeezes main, not overlay). */
  rightPanelOpen: boolean;
  /** Bottom dock panel. */
  bottomPanelOpen: boolean;
  /** What's inside each panel; null = empty (picker shown). */
  rightPanelKind: PanelKind | null;
  bottomPanelKind: PanelKind | null;
  /** Drag-resizable dimensions (px). */
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
  theme: ThemeChoice;
  /** Transient toast message; null when nothing to show. */
  toast: string | null;

  toggleLeft: () => void;
  setTheme: (theme: ThemeChoice) => void;
  showToast: (message: string) => void;
  clearToast: () => void;
  openNewSession: (mode?: 'project' | 'chat', cwd?: string) => void;
  toggleSectionCollapsed: (section: 'projects' | 'chats') => void;
  setRightPanelOpen: (open: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setRightPanelKind: (kind: PanelKind | null) => void;
  setBottomPanelKind: (kind: PanelKind | null) => void;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setBottomPanelHeight: (h: number) => void;
  setNewSessionOpen: (open: boolean) => void;
  setHookModalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  leftCollapsed: false,
  rightPanelOpen: false,
  bottomPanelOpen: false,
  rightPanelKind: null,
  bottomPanelKind: null,
  sidebarWidth: 240,
  rightPanelWidth: 360,
  bottomPanelHeight: 260,
  newSessionOpen: false,
  hookModalOpen: false,
  settingsOpen: false,
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
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setRightPanelKind: (kind) => set({ rightPanelKind: kind }),
  setBottomPanelKind: (kind) => set({ bottomPanelKind: kind }),
  setSidebarWidth: (w) => set({ sidebarWidth: clamp(w, 180, 400) }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: clamp(w, 240, rightPanelMax()) }),
  setBottomPanelHeight: (h) => set({ bottomPanelHeight: clamp(h, 160, 600) }),
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
  setHookModalOpen: (open) => set({ hookModalOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
