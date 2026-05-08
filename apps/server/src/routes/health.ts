import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

const HealthResponse = z.object({ status: z.literal("ok") });

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
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
}
