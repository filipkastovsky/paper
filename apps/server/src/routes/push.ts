import { subscribeUser, unsubscribeUser } from "@/services/push.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const VapidKeyResponse = z.object({
  vapid_public_key: z.string(),
});

const SubscribeBody = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

const UnsubscribeBody = z.object({
  endpoint: z.string().url(),
});

export const pushRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/push/vapid-key",
    {
      schema: {
        tags: ["push"],
        summary: "VAPID public key",
        response: { 200: VapidKeyResponse },
      },
    },
    async () => {
      return { vapid_public_key: app.config.VAPID_PUBLIC_KEY };
    },
  );

  app.post(
    "/v1/push/subscribe",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["push"],
        summary: "Subscribe to push notifications",
        security: [{ bearerAuth: [] }],
        body: SubscribeBody,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      await subscribeUser(app.db, userId, request.body);
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/push/unsubscribe",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["push"],
        summary: "Unsubscribe from push notifications",
        security: [{ bearerAuth: [] }],
        body: UnsubscribeBody,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await unsubscribeUser(app.db, request.body.endpoint);
      return reply.code(204).send();
    },
  );
};
