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

describe("GET /openapi.json", () => {
  let app: Awaited<ReturnType<typeof makeTestServer>>;

  beforeAll(async () => {
    app = await makeTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes the health endpoint in the OpenAPI spec", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { paths: Record<string, unknown> };
    expect(spec.paths["/v1/health"]).toBeDefined();
  });
});
