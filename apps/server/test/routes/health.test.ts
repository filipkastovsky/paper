import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestServer } from "../helpers/server.js";

describe("GET /v1/health", () => {
  let app: Awaited<ReturnType<typeof makeTestServer>>;

  beforeAll(async () => {
    app = await makeTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
