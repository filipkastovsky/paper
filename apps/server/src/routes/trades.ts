import { executeTrade, listTrades } from "@/services/trades.js";
import { ASSETS } from "@paper/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const ASSET_ID_ENUM = z.enum(ASSETS.map((a) => a.id) as [string, ...string[]]);

const TradeBody = z.object({
  asset_id: ASSET_ID_ENUM,
  side: z.enum(["buy", "sell"]),
  // Pre-validate the wire string. Trade math runs on Decimal; we keep the
  // wire shape `string` end-to-end to avoid float-round trips.
  usd_amount: z.string().regex(/^\d+(\.\d{1,8})?$/, "must be a positive number with ≤8 decimals"),
  idempotency_key: z.string().min(1).max(120),
});

const TradeRow = z.object({
  id: z.uuid(),
  asset_id: z.string(),
  side: z.enum(["buy", "sell"]),
  usd_amount: z.string(),
  qty: z.string(),
  price_at_execution: z.string(),
  idempotency_key: z.string(),
  created_at: z.string(),
});

const TradeOk = z.object({
  trade: TradeRow,
  is_first_trade: z.boolean(),
});

const TradeError = z.object({
  error: z.enum(["insufficient_cash", "insufficient_qty", "unknown_asset", "invalid_amount"]),
});
const PriceUnavailable = z.object({ error: z.literal("price_unavailable") });

const TradeListResponse = z.object({
  trades: z.array(TradeRow),
});
const TradeListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const tradesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/trades",
    {
      preHandler: app.authenticate,
      // Per spec §11.6: ≤20 trades/min/user. The default rate-limit plugin
      // keys on IP — override per-route to key on the JWT subject so a shared
      // NAT or proxy doesn't cross-throttle different users.
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.user?.sub ?? req.ip,
        },
      },
      // attachValidation defers body-schema errors so that preHandler (auth)
      // runs first. Without this, an invalid body gets a 400 before the JWT
      // check fires, making unauthenticated requests with invalid bodies appear
      // as validation errors rather than auth failures.
      attachValidation: true,
      schema: {
        tags: ["trades"],
        summary: "Execute one buy/sell at the cached price",
        security: [{ bearerAuth: [] }],
        body: TradeBody,
        response: {
          200: TradeOk, // idempotent replay
          201: TradeOk, // fresh insert
          // 400 can be a Zod schema validation error (Fastify native format) OR
          // our own { error: "unknown_asset"|"invalid_amount" }. Using z.any()
          // avoids FST_ERR_FAILED_ERROR_SERIALIZATION when Fastify's validation
          // error format doesn't match the response schema.
          400: z.any(),
          422: TradeError,
          // @fastify/rate-limit sends its own error format; z.any() avoids
          // FST_ERR_FAILED_ERROR_SERIALIZATION when its shape doesn't match.
          429: z.any(),
          503: PriceUnavailable,
        },
      },
    },
    async (request, reply) => {
      // With attachValidation: true, body-schema errors don't auto-respond.
      // After auth has run (preHandler), manually surface any validation error.
      if (request.validationError) {
        return reply.code(400).send({ error: request.validationError.message });
      }

      const userId = request.user.sub;
      const body = request.body;

      const result = await executeTrade(app.db, app.config.REDIS_URL, {
        userId,
        assetId: body.asset_id,
        side: body.side,
        usdAmount: padTo8(body.usd_amount),
        idempotencyKey: body.idempotency_key,
      });

      if (result.kind === "error") {
        const code = result.code;
        if (code === "price_unavailable") {
          return reply.code(503).send({ error: code });
        }
        if (code === "unknown_asset" || code === "invalid_amount") {
          return reply.code(400).send({ error: code });
        }
        // insufficient_cash / insufficient_qty
        return reply.code(422).send({ error: code });
      }

      const wire = toWire(result.trade);
      // 201 on fresh inserts (whether or not it's the user's first trade overall);
      // 200 on idempotent replay so clients can distinguish "just created" from
      // "returning an existing row". Plan 5 metrics dashboards key on this.
      const status = result.wasIdempotentReplay ? 200 : 201;
      return reply.code(status).send({ trade: wire, is_first_trade: result.isFirstTrade });
    },
  );

  app.get(
    "/v1/trades",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trades"],
        summary: "List the user's trades, newest first",
        security: [{ bearerAuth: [] }],
        querystring: TradeListQuery,
        response: { 200: TradeListResponse },
      },
    },
    async (request) => {
      const list = await listTrades(app.db, {
        userId: request.user.sub,
        limit: request.query.limit,
      });
      return { trades: list.map(toWire) };
    },
  );
};

function toWire(t: {
  id: string;
  assetId: string;
  side: "buy" | "sell";
  usdAmount: string;
  qty: string;
  priceAtExecution: string;
  idempotencyKey: string;
  createdAt: Date;
}): {
  id: string;
  asset_id: string;
  side: "buy" | "sell";
  usd_amount: string;
  qty: string;
  price_at_execution: string;
  idempotency_key: string;
  created_at: string;
} {
  return {
    id: t.id,
    asset_id: t.assetId,
    side: t.side,
    usd_amount: t.usdAmount,
    qty: t.qty,
    price_at_execution: t.priceAtExecution,
    idempotency_key: t.idempotencyKey,
    created_at: t.createdAt.toISOString(),
  };
}

function padTo8(s: string): string {
  // "100" → "100.00000000"; "1.5" → "1.50000000"; "0.00000001" stays.
  const [whole, frac = ""] = s.split(".");
  return `${whole}.${(`${frac}00000000`).slice(0, 8)}`;
}
