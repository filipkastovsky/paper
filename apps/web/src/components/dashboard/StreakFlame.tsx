import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useState } from "react";

export function StreakFlame({
  currentDays,
  longestDays,
}: {
  currentDays: number;
  longestDays: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 font-display text-sm font-semibold text-paper"
        aria-label={`${currentDays}-day streak`}
      >
        🔥 {currentDays}
      </button>
      <BottomSheet open={open} onOpenChange={setOpen} title="Your streak">
        <div className="space-y-4 font-display">
          <div className="text-center">
            <p className="text-6xl">🔥</p>
            <p className="mt-2 text-3xl font-bold text-ink">{currentDays}</p>
            <p className="text-ink-soft text-sm">day streak</p>
          </div>
          <div className="flex justify-center gap-6 border-t border-line pt-4">
            <div className="text-center">
              <p className="font-bold text-ink text-xl">{longestDays}</p>
              <p className="text-ink-soft text-xs">longest</p>
            </div>
          </div>
          <p className="text-center text-ink-soft text-xs">
            Complete a lesson, trade, or daily prediction every day to keep your streak alive.
          </p>
        </div>
      </BottomSheet>
    </>
  );
}
