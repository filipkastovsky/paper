import { makeDb } from "@/db/client.js";
import { users } from "@/db/schema/index.js";
import { listLessonProgress, recordLessonComplete } from "@/services/lesson-progress.js";
import { closeRedis } from "@/services/redis.js";
import { LESSONS } from "@paper/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";

// biome-ignore lint/style/noNonNullAssertion: test fixture — fundamentals track is guaranteed by @paper/shared
const FUND_LESSON = LESSONS.find((l) => l.trackId === "fundamentals")!.id;
const SAFETY_LESSONS = LESSONS.filter((l) => l.trackId === "safety").map((l) => l.id);

describe("recordLessonComplete", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(uuid: string): Promise<string> {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: uuid })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    return u.id;
  }

  it("happy path — first completion returns isFirstLesson=true, trackJustCompleted=null", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lp01");
    const result = await recordLessonComplete(handles.db, {
      userId,
      lessonId: FUND_LESSON,
      quizScore: 80,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.isFirstLesson).toBe(true);
    expect(result.trackJustCompleted).toBeNull();
    expect(result.progress.lessonId).toBe(FUND_LESSON);
    expect(result.progress.quizScore).toBe(80);
  });

  it("re-completing with HIGHER score raises quiz_score; isFirstLesson=false", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lp02");
    await recordLessonComplete(handles.db, {
      userId,
      lessonId: FUND_LESSON,
      quizScore: 60,
    });
    const result = await recordLessonComplete(handles.db, {
      userId,
      lessonId: FUND_LESSON,
      quizScore: 90,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.isFirstLesson).toBe(false);
    expect(result.progress.quizScore).toBe(90);
  });

  it("re-completing with LOWER score keeps the higher score", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lp03");
    await recordLessonComplete(handles.db, {
      userId,
      lessonId: FUND_LESSON,
      quizScore: 90,
    });
    const result = await recordLessonComplete(handles.db, {
      userId,
      lessonId: FUND_LESSON,
      quizScore: 40,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.progress.quizScore).toBe(90);
  });

  it("track-just-completed: completing the last safety lesson returns 'safety'", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lp04");
    for (const id of SAFETY_LESSONS.slice(0, -1)) {
      await recordLessonComplete(handles.db, {
        userId,
        lessonId: id,
        quizScore: 70,
      });
    }
    // biome-ignore lint/style/noNonNullAssertion: SAFETY_LESSONS is non-empty by @paper/shared guarantee
    const lastId = SAFETY_LESSONS[SAFETY_LESSONS.length - 1]!;
    const result = await recordLessonComplete(handles.db, {
      userId,
      lessonId: lastId,
      quizScore: 100,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.trackJustCompleted).toBe("safety");
  });

  it("re-completing an already-completed lesson does NOT re-fire trackJustCompleted", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lp05");
    for (const id of SAFETY_LESSONS) {
      await recordLessonComplete(handles.db, {
        userId,
        lessonId: id,
        quizScore: 70,
      });
    }
    // biome-ignore lint/style/noNonNullAssertion: SAFETY_LESSONS is non-empty by @paper/shared guarantee
    const lastId = SAFETY_LESSONS[SAFETY_LESSONS.length - 1]!;
    const result = await recordLessonComplete(handles.db, {
      userId,
      lessonId: lastId,
      quizScore: 100,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.trackJustCompleted).toBeNull();
  });

  it("unknown lesson_id → kind: error, code: unknown_lesson", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lp06");
    const result = await recordLessonComplete(handles.db, {
      userId,
      lessonId: "fundamentals/does-not-exist",
      quizScore: 80,
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("unknown_lesson");
  });

  it("invalid score (101 or -1) → kind: error, code: invalid_score", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lp07");
    for (const bad of [101, -1, 999]) {
      const result = await recordLessonComplete(handles.db, {
        userId,
        lessonId: FUND_LESSON,
        quizScore: bad,
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("invalid_score");
    }
  });
});

describe("listLessonProgress", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns rows for the correct user, no cross-user leak, desc by completed_at", async () => {
    const [u1] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000lp08" })
      .returning({ id: users.id });
    const [u2] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000lp09" })
      .returning({ id: users.id });
    if (!u1 || !u2) throw new Error("no user");

    const ids = SAFETY_LESSONS.slice(0, 3);
    for (const id of ids) {
      await recordLessonComplete(handles.db, { userId: u1.id, lessonId: id, quizScore: 70 });
    }
    await recordLessonComplete(handles.db, {
      userId: u2.id,
      lessonId: FUND_LESSON,
      quizScore: 50,
    });

    const u1Rows = await listLessonProgress(handles.db, u1.id);
    expect(u1Rows).toHaveLength(3);
    expect(u1Rows[0]?.lessonId).toBe(ids[2]);

    const u2Rows = await listLessonProgress(handles.db, u2.id);
    expect(u2Rows).toHaveLength(1);
    expect(u2Rows[0]?.lessonId).toBe(FUND_LESSON);
  });
});
