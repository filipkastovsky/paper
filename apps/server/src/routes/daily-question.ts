import { getTodayQuestion } from "@/services/daily-questions.js";
import { getPointsBalance, getUserPredictionForQuestion } from "@/services/predictions.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const QuestionOut = z.object({
  id: z.string().uuid(),
  date: z.string(),
  asset_id: z.string(),
  direction_resolved: z.enum(["up", "down", "tie"]).nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
});

const PredictionOut = z.object({
  direction: z.enum(["up", "down"]),
  stake: z.number(),
  status: z.enum(["pending", "correct", "wrong", "tie"]),
  payout: z.number().nullable(),
});

const DailyQuestionResponse = z.object({
  question: QuestionOut.nullable(),
  my_prediction: PredictionOut.nullable(),
  points_balance: z.number().int(),
});

export const dailyQuestionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/daily-question",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["daily-question"],
        summary: "Get today's market question + the user's prediction (if any)",
        security: [{ bearerAuth: [] }],
        response: { 200: DailyQuestionResponse },
      },
    },
    async (request) => {
      const userId = request.user.sub;

      const question = await getTodayQuestion(app.db);

      const myPrediction = question
        ? await getUserPredictionForQuestion(app.db, userId, question.id)
        : null;

      const pointsBalance = await getPointsBalance(app.db, userId);

      return {
        question: question
          ? {
              id: question.id,
              date: question.date,
              asset_id: question.assetId,
              direction_resolved: question.directionResolved as "up" | "down" | "tie" | null,
              resolved_at: question.resolvedAt ? question.resolvedAt.toISOString() : null,
              created_at: question.createdAt.toISOString(),
            }
          : null,
        my_prediction: myPrediction
          ? {
              direction: myPrediction.direction as "up" | "down",
              stake: myPrediction.stake,
              status: myPrediction.status as "pending" | "correct" | "wrong" | "tie",
              payout: myPrediction.payout ?? null,
            }
          : null,
        points_balance: pointsBalance,
      };
    },
  );
};
