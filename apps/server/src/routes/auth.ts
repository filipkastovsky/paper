import { randomUUID } from "node:crypto";
import { refreshTokens, users } from "@/db/schema/index.js";
import { REFRESH_TOKEN_TTL_DAYS, mintAccessToken, mintRefreshToken } from "@/lib/tokens.js";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const DeviceAuthBody = z.object({
  device_uuid: z.guid(),
});

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({
    id: z.guid(),
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

      // upsert user
      const [existing] = await app.db.select().from(users).where(eq(users.deviceUuid, device_uuid));
      const user =
        existing ?? (await app.db.insert(users).values({ deviceUuid: device_uuid }).returning())[0];
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
