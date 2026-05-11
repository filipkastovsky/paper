import { closeRedis } from "@/services/redis.js";
import { LESSONS } from "@paper/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

const _fundLesson = LESSONS.find((l) => l.trackId === "fundamentals");
if (!_fundLesson) throw new Error("no fundamentals lesson found");
const FUND_LESSON = _fundLesson.id;
const SAFETY_LESSONS = LESSONS.filter((l) => l.trackId === "safety").map((l) => l.id);
const TOTAL_LESSONS = LESSONS.length;

describe("POST /v1/lessons/:id/complete", () => {
  let ctx: TestServer;
  beforeAll(async () => {
    ctx = await makeTestServer();
  });
  afterEach(async () => {
    await truncateAllTables(ctx.db);
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
    await closeRedis();
  });

  async function deviceAuth(uuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: uuid },
    });
    return (res.json() as { access_token: string }).access_token;
  }

  it("requires auth", async () => {
    const encoded = encodeURIComponent(FUND_LESSON);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/lessons/${encoded}/complete`,
      payload: { quiz_score: 80 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("201 on first completion with is_first_lesson=true", async () => {
    const token = await deviceAuth("00000000-0000-0000-0000-00000000ea01");
    const encoded = encodeURIComponent(FUND_LESSON);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/lessons/${encoded}/complete`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { quiz_score: 80 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      progress: { lesson_id: string; quiz_score: number };
      is_first_lesson: boolean;
      track_just_completed: string | null;
    };
    expect(body.progress.lesson_id).toBe(FUND_LESSON);
    expect(body.progress.quiz_score).toBe(80);
    expect(body.is_first_lesson).toBe(true);
    expect(body.track_just_completed).toBeNull();
  });

  it("200 on idempotent re-completion with is_first_lesson=false", async () => {
    const token = await deviceAuth("00000000-0000-0000-0000-00000000ea02");
    const encoded = encodeURIComponent(FUND_LESSON);
    const send = (score: number) =>
      ctx.app.inject({
        method: "POST",
        url: `/v1/lessons/${encoded}/complete`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { quiz_score: score },
      });
    const a = await send(60);
    const b = await send(90);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    const bBody = b.json() as { is_first_lesson: boolean; progress: { quiz_score: number } };
    expect(bBody.is_first_lesson).toBe(false);
    expect(bBody.progress.quiz_score).toBe(90);
  });

  it("404 on unknown lesson", async () => {
    const token = await deviceAuth("00000000-0000-0000-0000-00000000ea03");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/lessons/${encodeURIComponent("fundamentals/nope")}/complete`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { quiz_score: 80 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 on invalid quiz_score", async () => {
    const token = await deviceAuth("00000000-0000-0000-0000-00000000ea04");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/lessons/${encodeURIComponent(FUND_LESSON)}/complete`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { quiz_score: 999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("track_just_completed='safety' after the last safety lesson", async () => {
    const token = await deviceAuth("00000000-0000-0000-0000-00000000ea05");
    for (const id of SAFETY_LESSONS.slice(0, -1)) {
      await ctx.app.inject({
        method: "POST",
        url: `/v1/lessons/${encodeURIComponent(id)}/complete`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { quiz_score: 70 },
      });
    }
    const lastId = SAFETY_LESSONS.at(-1) ?? "";
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/lessons/${encodeURIComponent(lastId)}/complete`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { quiz_score: 100 },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { track_just_completed: string }).track_just_completed).toBe("safety");
  });
});

describe("GET /v1/learn/state", () => {
  let ctx: TestServer;
  beforeAll(async () => {
    ctx = await makeTestServer();
  });
  afterEach(async () => {
    await truncateAllTables(ctx.db);
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
    await closeRedis();
  });

  async function deviceAuth(uuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: uuid },
    });
    return (res.json() as { access_token: string }).access_token;
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/learn/state" });
    expect(res.statusCode).toBe(401);
  });

  it("brand-new user — all 20 lessons null, all 3 tracks 0/N", async () => {
    const token = await deviceAuth("00000000-0000-0000-0000-00000000ea06");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/learn/state",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tracks: Array<{ id: string; lessons_total: number; lessons_completed: number }>;
      lessons: Array<{ id: string; completed_at: string | null; quiz_score: number | null }>;
    };
    expect(body.lessons).toHaveLength(TOTAL_LESSONS);
    expect(body.lessons.every((l) => l.completed_at === null)).toBe(true);
    expect(body.tracks).toHaveLength(3);
    for (const t of body.tracks) {
      expect(t.lessons_completed).toBe(0);
    }
  });

  it("after a POST, GET reflects completion + score", async () => {
    const token = await deviceAuth("00000000-0000-0000-0000-00000000ea07");
    await ctx.app.inject({
      method: "POST",
      url: `/v1/lessons/${encodeURIComponent(FUND_LESSON)}/complete`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { quiz_score: 75 },
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/learn/state",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json() as {
      tracks: Array<{ id: string; lessons_completed: number }>;
      lessons: Array<{ id: string; completed_at: string | null; quiz_score: number | null }>;
    };
    const completed = body.lessons.filter((l) => l.completed_at !== null);
    expect(completed).toHaveLength(1);
    expect(completed.at(0)?.quiz_score).toBe(75);
    expect(body.tracks.find((t) => t.id === "fundamentals")?.lessons_completed).toBe(1);
  });
});
