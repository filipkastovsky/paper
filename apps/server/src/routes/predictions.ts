import { dailyQuestions } from "@/db/schema/index.js";
import { submitPrediction } from "@/services/predictions.js";
import { upsertStreak } from "@/services/streaks.js";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const PredictionBody = z.object({
  daily_question_id: z.string().uuid(),
  direction: z.enum(["up", "down"]),
  stake: z.number().int().min(100).max(500),
  idempotency_key: z.string().min(1).max(120),
});

const PredictionRow = z.object({
  id: z.string().uuid(),
  direction: z.string(),
  stake: z.number(),
  status: z.string(),
  payout: z.number().nullable(),
  created_at: z.string(),
});

const PredictionOk = z.object({
  prediction: PredictionRow,
  points_balance: z.number().int(),
});

const PredictionError = z.object({
  error: z.enum([
    "question_not_found",
    "question_resolved",
    "invalid_direction",
    "invalid_stake",
    "insufficient_points",
  ]),
});

export const predictionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/predictions",
    {
      preHandler: app.authenticate,
      attachValidation: true,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: (req) => req.user?.sub ?? req.ip,
        },
      },
      schema: {
        tags: ["predictions"],
        summary: "Submit a direction prediction for today's daily question",
        security: [{ bearerAuth: [] }],
        body: PredictionBody,
        response: {
          200: PredictionOk,
          201: PredictionOk,
          400: z.any(),
          422: PredictionError,
          429: z.any(),
        },
      },
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send({ error: request.validationError.message });
      }

      const userId = request.user.sub;
      const body = request.body;

      const [question] = await app.db
        .select()
        .from(dailyQuestions)
        .where(eq(dailyQuestions.id, body.daily_question_id))
        .limit(1);

      if (!question) {
        return reply.code(400).send({ error: "question_not_found" as const });
      }
      if (question.directionResolved !== null) {
        return reply.code(400).send({ error: "question_resolved" as const });
      }

      const result = await submitPrediction(app.db, {
        userId,
        dailyQuestionId: body.daily_question_id,
        direction: body.direction,
        stake: body.stake,
        idempotencyKey: body.idempotency_key,
      });

      if (result.kind === "error") {
        return reply.code(422).send({ error: result.code });
      }

      if (result.wasNew) {
        void upsertStreak(app.db, userId).catch((err: unknown) => {
          app.log.warn(
            { err, userId },
            "predictions: upsertStreak fire-and-forget failed (non-fatal)",
          );
        });
      }

      const status = result.wasNew ? 201 : 200;
      return reply.code(status).send({
        prediction: {
          id: result.prediction.id,
          direction: result.prediction.direction,
          stake: result.prediction.stake,
          status: result.prediction.status,
          payout: result.prediction.payout ?? null,
          created_at: result.prediction.createdAt.toISOString(),
        },
        points_balance: result.newBalance,
      });
    },
  );
};
