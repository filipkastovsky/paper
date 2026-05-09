import { create } from "zustand";

export type Step = "welcome" | "handle" | "balance" | "lesson";
export const STEPS: Step[] = ["welcome", "handle", "balance", "lesson"];

interface OnboardingState {
  /** Last server-confirmed handle (after PATCH /v1/me succeeds). */
  claimedHandle: string | null;
  /** Selected avatar; null until the user picks. */
  avatar: "peach" | "mint" | "sky" | "lilac" | null;
  /** Marks true after step 3 (balance reveal acknowledged). */
  balanceAcknowledged: boolean;

  setClaimedHandle: (h: string | null) => void;
  setAvatar: (a: OnboardingState["avatar"]) => void;
  acknowledgeBalance: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  claimedHandle: null,
  avatar: null,
  balanceAcknowledged: false,
  setClaimedHandle: (h) => set({ claimedHandle: h }),
  setAvatar: (a) => set({ avatar: a }),
  acknowledgeBalance: () => set({ balanceAcknowledged: true }),
  reset: () => set({ claimedHandle: null, avatar: null, balanceAcknowledged: false }),
}));
