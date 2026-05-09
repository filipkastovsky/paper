import { users } from "@/db/schema/index.js";
import { normalizeHandle, validateHandleFormat } from "@/services/handles.js";
import { getPortfolioWithValuation, initializePortfolio } from "@/services/portfolio.js";
import { ASSET_PASTELS, type AssetPastel } from "@paper/shared";
import { and, eq, ne } from "drizzle-orm";
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

const PatchBody = z.object({
  handle: z.string().min(1).max(40).optional(),
  avatar: z.enum(ASSET_PASTELS).optional(),
});

const PatchResponse = z.object({ user: MeUser });
const PatchError = z.object({
  error: z.enum(["invalid_handle_format", "handle_reserved", "handle_taken"]),
});
const NotFoundError = z.object({ error: z.literal("user_not_found") });

const HandleCheckQuery = z.object({
  handle: z.string().min(1).max(40),
});
const HandleCheckResponse = z.object({
  available: z.boolean(),
  reason: z.enum(["invalid_format", "reserved", "taken"]).nullable(),
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

  app.patch(
    "/v1/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["me"],
        summary: "Update current user's handle and/or avatar",
        security: [{ bearerAuth: [] }],
        body: PatchBody,
        response: {
          200: PatchResponse,
          400: PatchError,
          404: NotFoundError,
          409: PatchError,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const body = request.body;

      const patch: { handle?: string; avatar?: AssetPastel } = {};

      if (body.handle !== undefined) {
        const normalized = normalizeHandle(body.handle);
        const formatErr = validateHandleFormat(normalized);
        if (formatErr?.kind === "invalid_format") {
          return reply.code(400).send({ error: "invalid_handle_format" as const });
        }
        if (formatErr?.kind === "reserved") {
          return reply.code(400).send({ error: "handle_reserved" as const });
        }

        const [taken] = await app.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.handle, normalized), ne(users.id, userId)));
        if (taken) {
          return reply.code(409).send({ error: "handle_taken" as const });
        }

        patch.handle = normalized;
      }

      if (body.avatar !== undefined) {
        patch.avatar = body.avatar;
      }

      // The pre-update SELECT closes the obvious case fast, but a concurrent
      // PATCH can still slip in between SELECT and UPDATE. The unique index on
      // users.handle then trips a Postgres unique_violation (SQLSTATE 23505),
      // which must be remapped to the documented 409 instead of leaking a 500.
      let updated: typeof users.$inferSelect | undefined;
      try {
        [updated] = await app.db.update(users).set(patch).where(eq(users.id, userId)).returning();
      } catch (err) {
        if (
          err !== null &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          return reply.code(409).send({ error: "handle_taken" as const });
        }
        throw err;
      }
      if (!updated) {
        return reply.code(404).send({ error: "user_not_found" as const });
      }

      return {
        user: { id: updated.id, handle: updated.handle, avatar: updated.avatar },
      };
    },
  );

  app.get(
    "/v1/handles/check",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["me"],
        summary: "Check whether a handle is available",
        security: [{ bearerAuth: [] }],
        querystring: HandleCheckQuery,
        response: {
          200: HandleCheckResponse,
        },
      },
    },
    async (request) => {
      // Validate the raw input BEFORE normalising so the UI reports the
      // input the user actually typed as invalid (e.g. "BAD" with uppercase
      // is invalid_format even though normalising would silently turn it
      // into a valid "bad").
      const raw = request.query.handle;
      const formatErr = validateHandleFormat(raw);
      if (formatErr?.kind === "invalid_format") {
        return { available: false, reason: "invalid_format" as const };
      }
      if (formatErr?.kind === "reserved") {
        return { available: false, reason: "reserved" as const };
      }

      const normalized = normalizeHandle(raw);
      const [existing] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, normalized));
      if (existing) {
        return { available: false, reason: "taken" as const };
      }

      return { available: true, reason: null };
    },
  );
};
