import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("GET /v1/health", () => {
  let ctx: TestServer;

  beforeAll(async () => {
    ctx = await makeTestServer();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
  });

  it("returns ok", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /openapi.json", () => {
  let ctx: TestServer;

  beforeAll(async () => {
    ctx = await makeTestServer();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
  });

  it("exposes the health endpoint in the OpenAPI spec", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { paths: Record<string, unknown> };
    expect(spec.paths["/v1/health"]).toBeDefined();
  });
});
