import type { AssetId } from "@paper/shared";
import { create } from "zustand";

export type Side = "buy" | "sell";

interface TradeState {
  side: Side;
  assetId: AssetId;
  /** Free-form input — user types digits + at most one decimal point. */
  usdInput: string;
  /** Minted on first submit; reused across retries of the same intent. */
  idempotencyKey: string | null;
  confirmOpen: boolean;
  successOpen: boolean;
  /** Opaque trade row from the server, set after a successful POST. */
  lastTrade: {
    id: string;
    asset_id: string;
    side: Side;
    usd_amount: string;
    qty: string;
    price_at_execution: string;
  } | null;

  setSide: (s: Side) => void;
  setAssetId: (id: AssetId) => void;
  setUsdInput: (next: string) => void;
  openConfirm: () => void;
  closeConfirm: () => void;
  openSuccess: (trade: NonNullable<TradeState["lastTrade"]>) => void;
  closeSuccess: () => void;
  resetForNextTrade: () => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  side: "buy",
  assetId: "BTC",
  usdInput: "",
  idempotencyKey: null,
  confirmOpen: false,
  successOpen: false,
  lastTrade: null,
  setSide: (s) => set({ side: s }),
  setAssetId: (id) => set({ assetId: id }),
  setUsdInput: (next) => set({ usdInput: next }),
  openConfirm: () => {
    // Mint a fresh idempotency key when the user opens the sheet — every
    // distinct "I am about to confirm" event gets its own key, but in-sheet
    // retries (network glitch, double-tap) reuse it.
    const key = `c-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    set({ confirmOpen: true, idempotencyKey: key });
  },
  closeConfirm: () => set({ confirmOpen: false }),
  openSuccess: (t) => set({ successOpen: true, confirmOpen: false, lastTrade: t }),
  closeSuccess: () => set({ successOpen: false }),
  resetForNextTrade: () =>
    set({ usdInput: "", idempotencyKey: null, lastTrade: null, successOpen: false }),
}));
