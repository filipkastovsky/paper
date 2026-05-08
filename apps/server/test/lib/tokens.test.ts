import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  hashRefreshToken,
  mintAccessToken,
  mintRefreshToken,
  verifyAccessToken,
} from "@/lib/tokens.js";
import { describe, expect, it } from "vitest";

const SECRET = "test-secret-must-be-at-least-32-characters-long";

describe("mintAccessToken / verifyAccessToken", () => {
  it("round-trips a user id", async () => {
    const userId = "00000000-0000-0000-0000-000000000001";
    const token = await mintAccessToken({ secret: SECRET, userId });
    const claims = await verifyAccessToken({ secret: SECRET, token });
    expect(claims.sub).toBe(userId);
    expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintAccessToken({ secret: SECRET, userId: "x" });
    await expect(
      verifyAccessToken({ secret: "other-secret-32-characters-minimum", token }),
    ).rejects.toThrow();
  });
});

describe("mintRefreshToken / hashRefreshToken", () => {
  it("returns a 256-bit url-safe token and a stable hash", () => {
    const { token, hash } = mintRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url of 32 bytes
    expect(hashRefreshToken(token)).toBe(hash);
  });

  it("default expiry is 90 days", () => {
    expect(REFRESH_TOKEN_TTL_DAYS).toBe(90);
  });
});
