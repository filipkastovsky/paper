import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
export const REFRESH_TOKEN_TTL_DAYS = 90;

export interface AccessClaims {
  sub: string;
  iat: number;
  exp: number;
}

export async function mintAccessToken(params: { secret: string; userId: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS };
  return jwt.sign(payload, params.secret, { subject: params.userId, algorithm: "HS256" });
}

export async function verifyAccessToken(params: {
  secret: string;
  token: string;
}): Promise<AccessClaims> {
  const decoded = jwt.verify(params.token, params.secret, { algorithms: ["HS256"] });
  if (
    typeof decoded === "string" ||
    !decoded.sub ||
    typeof decoded.iat !== "number" ||
    typeof decoded.exp !== "number"
  ) {
    throw new Error("invalid jwt payload");
  }
  return { sub: String(decoded.sub), iat: decoded.iat, exp: decoded.exp };
}

export function mintRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
