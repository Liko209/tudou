import { create } from 'zustand';

interface UIState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  newSessionOpen: boolean;
  hookModalOpen: boolean;

  toggleLeft: () => void;
  toggleRight: () => void;
  /** Cmd+\ — collapse both if either visible, expand both if both hidden. */
  toggleSides: () => void;
  setNewSessionOpen: (open: boolean) => void;
  setHookModalOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  newSessionOpen: false,
  hookModalOpen: false,

  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  toggleSides: () =>
    set((s) => {
      const bothHidden = s.leftCollapsed && s.rightCollapsed;
      return { leftCollapsed: !bothHidden, rightCollapsed: !bothHidden };
    }),

  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
  setHookModalOpen: (open) => set({ hookModalOpen: open }),
}));
