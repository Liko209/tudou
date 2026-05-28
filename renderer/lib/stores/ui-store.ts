import { create } from 'zustand';

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
  newSessionOpen: boolean;
  hookModalOpen: boolean;
  settingsOpen: boolean;

  toggleLeft: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setRightPanelKind: (kind: PanelKind | null) => void;
  setBottomPanelKind: (kind: PanelKind | null) => void;
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
  newSessionOpen: false,
  hookModalOpen: false,
  settingsOpen: false,

  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setRightPanelKind: (kind) => set({ rightPanelKind: kind }),
  setBottomPanelKind: (kind) => set({ bottomPanelKind: kind }),
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
  setHookModalOpen: (open) => set({ hookModalOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
