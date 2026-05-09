import { getAllCachedPrices } from "@/services/prices.js";
import { ASSETS, pastelForAsset } from "@paper/shared";
import { Decimal } from "decimal.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const AssetItem = z.object({
  id: z.string(),
  name: z.string(),
  pastel: z.enum(["peach", "mint", "sky", "lilac"]),
  price_usd: z.number().nullable(),
  change_24h_pct: z.number().nullable(),
  cached_at: z.number().nullable(),
});

const AssetsResponse = z.object({
  assets: z.array(AssetItem),
});

export const assetsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/assets",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["assets"],
        summary: "Asset roster with current prices",
        security: [{ bearerAuth: [] }],
        response: { 200: AssetsResponse },
      },
    },
    async () => {
      const prices = await getAllCachedPrices(app.config.REDIS_URL);
      const assets = ASSETS.map((a) => {
        const p = prices[a.id];
        let change_24h_pct: number | null = null;
        if (p && p.prevUsd > 0) {
          const cur = new Decimal(p.usd);
          const prev = new Decimal(p.prevUsd);
          change_24h_pct = cur.minus(prev).div(prev).mul(100).toDecimalPlaces(4).toNumber();
        }
        return {
          id: a.id,
          name: a.name,
          pastel: pastelForAsset(a.id),
          price_usd: p?.usd ?? null,
          change_24h_pct,
          cached_at: p?.ts ?? null,
        };
      });
      return { assets };
    },
  );
};
