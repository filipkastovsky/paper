import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const HealthResponse = z.object({ status: z.literal("ok") });

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/health",
    {
      schema: {
        tags: ["meta"],
        summary: "Liveness probe",
        response: { 200: HealthResponse },
      },
    },
    async () => ({ status: "ok" as const }),
  );
};
