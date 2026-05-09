import { AssetChip } from "@/components/dashboard/AssetChip";
import { cn } from "@/lib/cn";
import { useGetV1Assets } from "@paper/api-client";
import type { AssetId } from "@paper/shared";

export function AssetPickerRow({
  selected,
  onSelect,
}: {
  selected: AssetId;
  onSelect: (id: AssetId) => void;
}) {
  const { data, isLoading } = useGetV1Assets({ query: { staleTime: 30_000 } });
  const assets = data?.assets ?? [];

  return (
    <div className="-mx-2 flex gap-2 overflow-x-auto px-2 py-1">
      {isLoading && <div className="text-ink-soft text-sm">Loading assets…</div>}
      {assets.map((a) => {
        const isSel = a.id === selected;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id as AssetId)}
            aria-pressed={isSel}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-pill px-3 py-2",
              "ring-1 ring-line transition-colors",
              isSel ? "bg-ink text-paper ring-ink" : "bg-surface-2 text-ink hover:bg-surface",
            )}
          >
            <AssetChip
              letter={a.id}
              pastel={a.pastel as "peach" | "mint" | "sky" | "lilac"}
              size="sm"
            />
            <span className="font-display font-semibold text-sm">{a.id}</span>
          </button>
        );
      })}
    </div>
  );
}
