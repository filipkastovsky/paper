import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { TRACKS, type TrackId } from "@paper/shared";

export function TrackCompleteModal({
  trackId,
  onDismiss,
}: {
  trackId: TrackId | null;
  onDismiss: () => void;
}) {
  const track = trackId ? (TRACKS.find((t) => t.id === trackId) ?? null) : null;
  const open = trackId !== null;

  return (
    <BottomSheet open={open} onOpenChange={(v) => (v ? null : onDismiss())} title="Track complete!">
      {track ? (
        <Card tone={track.pastel} padding="lush" elevation="flat" className="text-ink">
          <Heading level="h2" className="text-center">
            Just finished {track.title} on
          </Heading>
          <p className="mt-1 text-center font-display text-ink/70 text-sm">papercrypto.tech</p>
          <p className="mt-4 text-center text-ink/60 text-xs">
            Image rendering ships in Plan 7. For now, screenshot this card.
          </p>
        </Card>
      ) : null}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button asChild variant="secondary">
          <a href="/learn" onClick={onDismiss}>
            Back to Learn
          </a>
        </Button>
        <Button asChild>
          <a href="/dashboard" onClick={onDismiss}>
            Place a trade
          </a>
        </Button>
      </div>
    </BottomSheet>
  );
}
