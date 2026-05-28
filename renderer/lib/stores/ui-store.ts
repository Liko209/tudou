import { create } from 'zustand';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type PanelKind = 'files' | 'sidechat' | 'terminal';

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
  hookModalOpen: boolean;
  settingsOpen: boolean;

  toggleLeft: () => void;
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

  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setRightPanelKind: (kind) => set({ rightPanelKind: kind }),
  setBottomPanelKind: (kind) => set({ bottomPanelKind: kind }),
  setSidebarWidth: (w) => set({ sidebarWidth: clamp(w, 180, 400) }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: clamp(w, 240, 700) }),
  setBottomPanelHeight: (h) => set({ bottomPanelHeight: clamp(h, 160, 600) }),
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
  setHookModalOpen: (open) => set({ hookModalOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
