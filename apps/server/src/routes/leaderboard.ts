import { getLeaderboard } from "@/services/leaderboard.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const LeaderboardEntry = z.object({
  rank: z.number().int(),
  user_id: z.string().uuid(),
  handle: z.string().nullable(),
  composite_score: z.number().int(),
});

const LeaderboardQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const LeaderboardResponse = z.object({
  week_starting_date: z.string(),
  entries: z.array(LeaderboardEntry),
  my_entry: LeaderboardEntry.nullable(),
});

export const leaderboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/leaderboard",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["leaderboard"],
        summary: "Get the global weekly leaderboard (top N + caller's rank)",
        security: [{ bearerAuth: [] }],
        querystring: LeaderboardQuery,
        response: { 200: LeaderboardResponse },
      },
    },
    async (request) => {
      const userId = request.user.sub;
      const { limit } = request.query;
      return getLeaderboard(app.db, userId, limit);
    },
  );
};
