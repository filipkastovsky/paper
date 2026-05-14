import { create } from "zustand";

export type Direction = "up" | "down";

interface DailyQuestionState {
  optimisticDirection: Direction | null;
  defaultStake: number;
  idempotencyKey: string | null;

  setOptimisticDirection: (direction: Direction) => void;
  mintIdempotencyKey: () => void;
  clearOptimistic: () => void;
}

export const useDailyQuestionStore = create<DailyQuestionState>((set) => ({
  optimisticDirection: null,
  defaultStake: 100,
  idempotencyKey: null,

  setOptimisticDirection: (direction) => set({ optimisticDirection: direction }),

  mintIdempotencyKey: () => {
    const key = `dq-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    set({ idempotencyKey: key });
  },

  clearOptimistic: () => set({ optimisticDirection: null, idempotencyKey: null }),
}));
