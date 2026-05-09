import { ASSETS, type AssetId } from "@paper/shared";
import { getRedis } from "./redis.js";

export const PRICE_CACHE_TTL_SECONDS = 120;
const PRICE_KEY_PREFIX = "paper:price:";
const BINANCE_24HR = "https://api.binance.com/api/v3/ticker/24hr";

export interface CachedPrice {
  usd: number;
  prevUsd: number;
  ts: number;
}

export async function getCachedPrice(
  redisUrl: string,
  assetId: AssetId,
): Promise<CachedPrice | null> {
  const r = getRedis(redisUrl);
  const raw = await r.get(`${PRICE_KEY_PREFIX}${assetId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedPrice;
    if (
      typeof parsed.usd !== "number" ||
      typeof parsed.prevUsd !== "number" ||
      typeof parsed.ts !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getAllCachedPrices(
  redisUrl: string,
): Promise<Record<AssetId, CachedPrice | null>> {
  const out: Record<string, CachedPrice | null> = {};
  await Promise.all(
    ASSETS.map(async (a) => {
      out[a.id] = await getCachedPrice(redisUrl, a.id);
    }),
  );
  return out as Record<AssetId, CachedPrice | null>;
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  prevClosePrice: string;
}

const BINANCE_TIMEOUT_MS = 10_000;

async function fetchBinanceTicker(symbol: string): Promise<BinanceTicker> {
  // 10s ceiling per asset — without it, a stuck TCP socket would block all 12
  // parallel fetches in fetchAndCacheAllPrices until Node's default ~minutes-long
  // socket timeout, and the next cron tick would pile up behind it.
  const res = await fetch(`${BINANCE_24HR}?symbol=${encodeURIComponent(symbol)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(BINANCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`binance ${symbol}: HTTP ${res.status}`);
  const json = (await res.json()) as BinanceTicker;
  return json;
}

export async function fetchAndCacheAllPrices(
  redisUrl: string,
): Promise<{ ok: number; failed: number }> {
  const r = getRedis(redisUrl);
  const ts = Math.floor(Date.now() / 1000);
  let ok = 0;
  let failed = 0;
  await Promise.all(
    ASSETS.map(async (a) => {
      try {
        const t = await fetchBinanceTicker(a.binanceSymbol);
        const usd = Number(t.lastPrice);
        const prevUsd = Number(t.prevClosePrice);
        if (!Number.isFinite(usd) || !Number.isFinite(prevUsd)) {
          throw new Error(`non-finite price for ${a.id}: ${t.lastPrice} / ${t.prevClosePrice}`);
        }
        const payload: CachedPrice = { usd, prevUsd, ts };
        await r.set(
          `${PRICE_KEY_PREFIX}${a.id}`,
          JSON.stringify(payload),
          "EX",
          PRICE_CACHE_TTL_SECONDS,
        );
        ok++;
      } catch (err) {
        // Log so the cron's structured output (T8) surfaces the cause when a
        // binanceSymbol is misconfigured, Binance delists, or the per-fetch
        // timeout fires. The cron still treats {failed > 0, ok > 0} as soft.
        console.warn(
          JSON.stringify({
            event: "price_fetch_failed",
            asset_id: a.id,
            binance_symbol: a.binanceSymbol,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        failed++;
      }
    }),
  );
  return { ok, failed };
}
