import { cn } from "@/lib/cn";
import type { ChangeEvent } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "invalid_format" }
  | { kind: "reserved" }
  | { kind: "taken" };

const HINTS: Record<Status["kind"], string> = {
  idle: "3–20 characters. Lowercase letters, digits, underscore. Must start with a letter.",
  checking: "checking…",
  available: "available ✓",
  invalid_format: "Only lowercase letters, digits, and underscore. Must start with a letter.",
  reserved: "That handle is reserved.",
  taken: "Already taken — try another.",
};

const TONE_CLASS: Record<Status["kind"], string> = {
  idle: "text-muted",
  checking: "text-muted",
  available: "text-up",
  invalid_format: "text-down",
  reserved: "text-down",
  taken: "text-down",
};

export function HandleInput({
  value,
  status,
  onChange,
}: {
  value: string;
  status: Status;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-md bg-surface-2 px-4 py-3 ring-1 ring-line focus-within:ring-ink">
        <span className="font-display text-ink-soft">@</span>
        <input
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          aria-invalid={
            status.kind === "invalid_format" ||
            status.kind === "reserved" ||
            status.kind === "taken"
          }
          aria-describedby="handle-hint"
          className="flex-1 bg-transparent font-display text-lg outline-none placeholder:text-muted"
          placeholder="yourhandle"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
      </div>
      <p
        id="handle-hint"
        aria-live="polite"
        aria-atomic="true"
        className={cn("mt-2 text-xs", TONE_CLASS[status.kind])}
      >
        {HINTS[status.kind]}
      </p>
    </div>
  );
}

export type { Status };
