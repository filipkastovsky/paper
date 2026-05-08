import { randomUUID } from "node:crypto";
import { refreshTokens, users } from "@/db/schema/index.js";
import { REFRESH_TOKEN_TTL_DAYS, mintAccessToken, mintRefreshToken } from "@/lib/tokens.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const DeviceAuthBody = z.object({
  device_uuid: z.guid(),
});

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({
    // Server-issued user.id is always a real RFC 4122 v4 UUID (drizzle defaultRandom()).
    // Strict z.uuid() tightens the OpenAPI contract; request body keeps z.guid() for client tolerance.
    id: z.uuid(),
    handle: z.string().nullable(),
  }),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/auth/device",
    {
      schema: {
        tags: ["auth"],
        summary: "Authenticate a device, creating a user on first call",
        body: DeviceAuthBody,
        response: { 200: TokenResponse },
      },
    },
    async (request) => {
      const { device_uuid } = request.body;

      // Atomic upsert: collapses the previous SELECT-then-INSERT into one round-trip
      // and removes the TOCTOU race when two concurrent first-time auths share a
      // device_uuid (the second would have hit the unique constraint as a 500).
      const [user] = await app.db
        .insert(users)
        .values({ deviceUuid: device_uuid })
        .onConflictDoUpdate({
          target: users.deviceUuid,
          // No-op SET to force RETURNING to surface the existing row.
          set: { deviceUuid: device_uuid },
        })
        .returning();
      if (!user) throw new Error("failed to upsert user");

      // mint tokens
      const accessToken = await mintAccessToken({
        secret: app.config.JWT_SECRET,
        userId: user.id,
      });
      const refresh = mintRefreshToken();
      const familyId = randomUUID();
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
      await app.db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: refresh.hash,
        familyId,
        expiresAt,
      });

      return {
        access_token: accessToken,
        refresh_token: refresh.token,
        user: { id: user.id, handle: user.handle },
      };
    },
  );
};
