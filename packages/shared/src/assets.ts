/**
 * v0 asset roster — 12 majors, all with Binance USDT pairs. Order is
 * STABLE (do not reorder); the index drives the Marshmallow pastel rotation
 * shown on chips and share cards.
 */
export const ASSETS = [
  { id: "BTC", name: "Bitcoin", binanceSymbol: "BTCUSDT" },
  { id: "ETH", name: "Ethereum", binanceSymbol: "ETHUSDT" },
  { id: "SOL", name: "Solana", binanceSymbol: "SOLUSDT" },
  { id: "USDC", name: "USD Coin", binanceSymbol: "USDCUSDT" },
  { id: "BNB", name: "BNB", binanceSymbol: "BNBUSDT" },
  { id: "XRP", name: "XRP", binanceSymbol: "XRPUSDT" },
  { id: "ADA", name: "Cardano", binanceSymbol: "ADAUSDT" },
  { id: "DOGE", name: "Dogecoin", binanceSymbol: "DOGEUSDT" },
  { id: "AVAX", name: "Avalanche", binanceSymbol: "AVAXUSDT" },
  { id: "LINK", name: "Chainlink", binanceSymbol: "LINKUSDT" },
  { id: "DOT", name: "Polkadot", binanceSymbol: "DOTUSDT" },
  { id: "TON", name: "Toncoin", binanceSymbol: "TONUSDT" },
] as const;

export type AssetId = (typeof ASSETS)[number]["id"];

/** "peach" | "mint" | "sky" | "lilac" — rotates 4-cycle by stable list index. */
export const ASSET_PASTELS = ["peach", "mint", "sky", "lilac"] as const;
export type AssetPastel = (typeof ASSET_PASTELS)[number];

export function pastelForAsset(assetId: AssetId): AssetPastel {
  const idx = ASSETS.findIndex((a) => a.id === assetId);
  if (idx < 0) throw new Error(`unknown asset: ${assetId}`);
  // biome-ignore lint/style/noNonNullAssertion: idx is bounded
  return ASSET_PASTELS[idx % ASSET_PASTELS.length]!;
}

export function isAssetId(s: string): s is AssetId {
  return ASSETS.some((a) => a.id === s);
}
