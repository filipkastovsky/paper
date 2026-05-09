import { users } from "@/db/schema/index.js";
import { getPortfolioWithValuation, initializePortfolio } from "@/services/portfolio.js";
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
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const [u] = await app.db.select().from(users).where(eq(users.id, userId));
      if (!u) return reply.code(404).send({ error: "user_not_found" as const });

      // Self-heal: portfolio rows are auto-created on device auth, but a token
      // minted before that wiring shipped (or a row deleted out-of-band) could
      // leave a user without one. `initializePortfolio` is idempotent, so we
      // call it then re-fetch rather than 500-ing.
      let p = await getPortfolioWithValuation(app.db, app.config.REDIS_URL, userId);
      if (!p) {
        await initializePortfolio(app.db, userId);
        p = await getPortfolioWithValuation(app.db, app.config.REDIS_URL, userId);
      }
      if (!p) throw new Error("portfolio init failed for authenticated user");

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
