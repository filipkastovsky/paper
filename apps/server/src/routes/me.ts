import { users } from "@/db/schema/index.js";
import { getPortfolioWithValuation } from "@/services/portfolio.js";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const MeUser = z.object({
  id: z.uuid(),
  handle: z.string().nullable(),
  avatar: z.string().nullable(),
});

const Holding = z.object({
  asset_id: z.string(),
  qty: z.string(),
  cost_basis: z.string(),
  price_usd: z.number().nullable(),
  value_usd: z.string().nullable(),
});

const MePortfolio = z.object({
  cash_usd: z.string(),
  holdings: z.array(Holding),
  total_value_usd: z.string(),
});

const MeResponse = z.object({
  user: MeUser,
  portfolio: MePortfolio,
});

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["me"],
        summary: "Current user + portfolio with valuation",
        security: [{ bearerAuth: [] }],
        response: {
          200: MeResponse,
          404: z.object({ error: z.literal("user_not_found") }),
          500: z.object({ error: z.literal("portfolio_missing") }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const [u] = await app.db.select().from(users).where(eq(users.id, userId));
      if (!u) return reply.code(404).send({ error: "user_not_found" as const });

      const p = await getPortfolioWithValuation(app.db, app.config.REDIS_URL, userId);
      if (!p) return reply.code(500).send({ error: "portfolio_missing" as const });

      return {
        user: { id: u.id, handle: u.handle, avatar: u.avatar },
        portfolio: {
          cash_usd: p.cash_usd,
          holdings: p.holdings,
          total_value_usd: p.total_value_usd,
        },
      };
    },
  );
};
