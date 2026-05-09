/**
 * Server `error` enum → user-facing copy. Keep these short and human; they
 * surface inside the bottom sheet during the confirmation moment.
 */
export const TRADE_ERROR_COPY: Record<string, string> = {
  insufficient_cash: "Not enough cash to cover this trade.",
  insufficient_qty: "You don't hold enough of this asset.",
  unknown_asset: "That asset isn't supported.",
  invalid_amount: "Amount must be greater than zero.",
  price_unavailable: "Price data is briefly unavailable. Try again in a few seconds.",
  rate_limited: "Slow down — you can place 20 trades per minute.",
};

export function tradeErrorCopy(code: string | undefined): string {
  if (!code) return "Something went wrong. Try again.";
  return TRADE_ERROR_COPY[code] ?? "Something went wrong. Try again.";
}
