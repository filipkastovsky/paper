import type { Db } from "@/db/client.js";
import { type LessonProgress, lessonProgress } from "@/db/schema/index.js";
import { type TrackId, getLesson, getTrack, isLessonId } from "@paper/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export type RecordLessonCompleteInput = {
  userId: string;
  lessonId: string;
  quizScore: number;
};

export type RecordLessonCompleteResult =
  | {
      kind: "ok";
      progress: LessonProgress;
      isFirstLesson: boolean;
      wasNewInsert: boolean;
      trackJustCompleted: TrackId | null;
    }
  | { kind: "error"; code: "unknown_lesson" | "invalid_score" };

/**
 * Upsert a lesson_progress row. completed_at is set on first insert and never
 * changes; quiz_score uses GREATEST(prev, new). isFirstLesson reflects the
 * total post-upsert row count for the user. trackJustCompleted fires only on
 * the insert (not the update) that completes the final lesson in a track.
 */
export async function recordLessonComplete(
  db: Db,
  input: RecordLessonCompleteInput,
): Promise<RecordLessonCompleteResult> {
  if (!isLessonId(input.lessonId)) {
    return { kind: "error", code: "unknown_lesson" };
  }
  if (!Number.isInteger(input.quizScore) || input.quizScore < 0 || input.quizScore > 100) {
    return { kind: "error", code: "invalid_score" };
  }

  // biome-ignore lint/style/noNonNullAssertion: isLessonId guard above guarantees getLesson returns a value
  const lesson = getLesson(input.lessonId)!;
  // biome-ignore lint/style/noNonNullAssertion: lesson.trackId is always a valid track id from shared data
  const track = getTrack(lesson.trackId)!;

  // Was the lesson already completed BEFORE this call? Drives the
  // trackJustCompleted gate so re-completing doesn't re-fire it.
  const [existing] = await db
    .select({ id: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(
      and(eq(lessonProgress.userId, input.userId), eq(lessonProgress.lessonId, input.lessonId)),
    )
    .limit(1);
  const wasNewInsert = !existing;

  const [upserted] = await db
    .insert(lessonProgress)
    .values({
      userId: input.userId,
      lessonId: input.lessonId,
      quizScore: input.quizScore,
    })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: {
        quizScore: sql`GREATEST(${lessonProgress.quizScore}, ${input.quizScore})`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  if (!upserted) throw new Error("upsert returned no row — unexpected");

  // isFirstLesson: total row count for this user is exactly 1.
  const userRows = await db
    .select({ id: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, input.userId))
    .limit(2);
  const isFirstLesson = wasNewInsert && userRows.length === 1;

  // trackJustCompleted: only fire if THIS call was a new insert AND the user
  // has now completed every lesson in the track.
  let trackJustCompleted: TrackId | null = null;
  if (wasNewInsert) {
    const trackRows = await db
      .select({ id: lessonProgress.lessonId })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, input.userId),
          inArray(lessonProgress.lessonId, [...track.lessonIds]),
        ),
      );
    if (trackRows.length === track.lessonIds.length) {
      trackJustCompleted = track.id as TrackId;
    }
  }

  return { kind: "ok", progress: upserted, isFirstLesson, wasNewInsert, trackJustCompleted };
}

export async function listLessonProgress(db: Db, userId: string): Promise<LessonProgress[]> {
  return db
    .select()
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, userId))
    .orderBy(desc(lessonProgress.completedAt));
}
