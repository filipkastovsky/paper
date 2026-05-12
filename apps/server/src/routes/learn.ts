import { listLessonProgress, recordLessonComplete } from "@/services/lesson-progress.js";
import { upsertStreak } from "@/services/streaks.js";
import { LESSONS, TRACKS } from "@paper/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const CompleteParams = z.object({ id: z.string().min(1) });
const CompleteBody = z.object({ quiz_score: z.number().int().min(0).max(100) });

const ProgressRow = z.object({
  lesson_id: z.string(),
  quiz_score: z.number(),
  completed_at: z.string(),
  updated_at: z.string(),
});

const CompleteResponse = z.object({
  progress: ProgressRow,
  is_first_lesson: z.boolean(),
  track_just_completed: z.enum(["fundamentals", "markets", "safety"]).nullable(),
});

const ErrorResponse = z.object({
  error: z.enum(["lesson_not_found", "invalid_score"]),
});

const LearnStateLesson = z.object({
  id: z.string(),
  track_id: z.string(),
  completed_at: z.string().nullable(),
  quiz_score: z.number().nullable(),
});

const LearnStateTrack = z.object({
  id: z.string(),
  title: z.string(),
  lessons_total: z.number(),
  lessons_completed: z.number(),
});

const LearnStateResponse = z.object({
  tracks: z.array(LearnStateTrack),
  lessons: z.array(LearnStateLesson),
});

export const learnRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/lessons/:id/complete",
    {
      preHandler: app.authenticate,
      // attachValidation defers body-schema errors so that preHandler (auth)
      // runs first. Without this, an invalid body gets a 400 before the JWT
      // check fires, making unauthenticated requests with invalid bodies appear
      // as validation errors rather than auth failures.
      attachValidation: true,
      schema: {
        tags: ["learn"],
        summary: "Mark a lesson complete; idempotent on repeat",
        security: [{ bearerAuth: [] }],
        params: CompleteParams,
        body: CompleteBody,
        response: {
          200: CompleteResponse,
          201: CompleteResponse,
          // 400 can be a Zod schema validation error (Fastify native format) OR
          // our own { error: "invalid_score" }. Using z.any() avoids
          // FST_ERR_FAILED_ERROR_SERIALIZATION when Fastify's validation error
          // format doesn't match the response schema.
          400: z.any(),
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      // With attachValidation: true, body-schema errors don't auto-respond.
      // After auth has run (preHandler), manually surface any validation error.
      if (request.validationError) {
        return reply.code(400).send({ error: request.validationError.message });
      }

      const lessonId = decodeURIComponent(request.params.id);
      const result = await recordLessonComplete(app.db, {
        userId: request.user.sub,
        lessonId,
        quizScore: request.body.quiz_score,
      });

      if (result.kind === "error") {
        if (result.code === "unknown_lesson") {
          return reply.code(404).send({ error: "lesson_not_found" as const });
        }
        return reply.code(400).send({ error: "invalid_score" as const });
      }

      // 201 on first-time insert; 200 on idempotent replay.
      // wasNewInsert comes directly from the service (pre-upsert check).
      const status = result.wasNewInsert ? 201 : 200;
      void upsertStreak(app.db, request.user.sub).catch((err) => {
        app.log.warn({ err }, "streak upsert failed after lesson complete");
      });
      return reply.code(status).send({
        progress: {
          lesson_id: result.progress.lessonId,
          quiz_score: result.progress.quizScore,
          completed_at: result.progress.completedAt.toISOString(),
          updated_at: result.progress.updatedAt.toISOString(),
        },
        is_first_lesson: result.isFirstLesson,
        track_just_completed: result.trackJustCompleted,
      });
    },
  );

  app.get(
    "/v1/learn/state",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["learn"],
        summary: "Full curriculum state with per-user completion",
        security: [{ bearerAuth: [] }],
        response: { 200: LearnStateResponse },
      },
    },
    async (request) => {
      const userId = request.user.sub;
      const rows = await listLessonProgress(app.db, userId);
      const byLessonId = new Map(rows.map((r) => [r.lessonId, r]));

      const lessons = LESSONS.map((l) => {
        const p = byLessonId.get(l.id);
        return {
          id: l.id,
          track_id: l.trackId,
          completed_at: p ? p.completedAt.toISOString() : null,
          quiz_score: p ? p.quizScore : null,
        };
      });

      const tracks = TRACKS.map((t) => {
        const completed = t.lessonIds.filter((id) => byLessonId.has(id)).length;
        return {
          id: t.id,
          title: t.title,
          lessons_total: t.lessonIds.length,
          lessons_completed: completed,
        };
      });

      return { tracks, lessons };
    },
  );
};
