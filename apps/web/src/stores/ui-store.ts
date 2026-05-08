import { create } from "zustand";

interface UIState {
  installPromptDismissed: boolean;
  dismissInstallPrompt: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  installPromptDismissed: false,
  dismissInstallPrompt: () => set({ installPromptDismissed: true }),
}));
