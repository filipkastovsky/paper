import { randomUUID } from "node:crypto";
import { refreshTokens, users } from "@/db/schema/index.js";
import {
  REFRESH_TOKEN_TTL_DAYS,
  hashRefreshToken,
  mintAccessToken,
  mintRefreshToken,
} from "@/lib/tokens.js";
import { and, eq, isNull } from "drizzle-orm";
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

  const RefreshBody = z.object({ refresh_token: z.string().min(20) });
  const RefreshResponse = z.object({
    access_token: z.string(),
    refresh_token: z.string(),
  });

  app.post(
    "/v1/auth/refresh",
    {
      schema: {
        tags: ["auth"],
        summary: "Rotate a refresh token",
        body: RefreshBody,
        response: {
          200: RefreshResponse,
          401: z.object({ error: z.literal("invalid_refresh_token") }),
        },
      },
    },
    async (request, reply) => {
      const { refresh_token } = request.body;
      const presentedHash = hashRefreshToken(refresh_token);

      const [row] = await app.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, presentedHash));

      if (!row) {
        return reply.code(401).send({ error: "invalid_refresh_token" as const });
      }

      // Replay/expiry detection: an already-revoked or expired token revokes the
      // entire family. RFC 6819 §5.2.2.3.
      if (row.revokedAt || row.expiresAt < new Date()) {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.familyId, row.familyId));
        return reply.code(401).send({ error: "invalid_refresh_token" as const });
      }

      // Atomic rotation: a conditional UPDATE serialises concurrent rotations of the
      // same token. If two requests hit, only one's UPDATE returns a row; the other
      // sees zero rows back, treats itself as a replay loser, and revokes the family.
      const newRefresh = mintRefreshToken();
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

      const userId = await app.db.transaction(async (tx) => {
        const revoked = await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
          .returning({ id: refreshTokens.id });

        if (revoked.length === 0) {
          // Lost the race — another rotation just revoked this row. Treat as replay.
          await tx
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(eq(refreshTokens.familyId, row.familyId));
          return null;
        }

        await tx.insert(refreshTokens).values({
          userId: row.userId,
          tokenHash: newRefresh.hash,
          familyId: row.familyId,
          expiresAt,
        });
        return row.userId;
      });

      if (!userId) {
        return reply.code(401).send({ error: "invalid_refresh_token" as const });
      }

      const accessToken = await mintAccessToken({
        secret: app.config.JWT_SECRET,
        userId,
      });

      return { access_token: accessToken, refresh_token: newRefresh.token };
    },
  );
};
