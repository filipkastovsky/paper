import { cn } from "@/lib/cn";
import * as Dialog from "@radix-ui/react-dialog";
import type * as React from "react";

/**
 * A bottom sheet built on Radix Dialog. Slides up from the bottom on mobile,
 * centers on desktop. Used for the trade-confirmation moment so the user never
 * loses the trade form context behind a route change.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl bg-paper p-6 pb-10 shadow-float outline-none",
            "sm:bottom-auto sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:pb-6",
            className,
          )}
        >
          {/* Visible drag handle on mobile */}
          <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line sm:hidden" />
          <Dialog.Title className="font-display text-ink font-bold text-xl">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-ink-soft text-sm">
              {description}
            </Dialog.Description>
          ) : null}
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
