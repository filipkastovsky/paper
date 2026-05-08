import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "paper API", version: "0.0.0" },
      servers: [{ url: "http://localhost:3000" }],
      components: {
        securitySchemes: {
          // T9 will mark protected routes with `security: [{ bearerAuth: [] }]`.
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });
  // ADR 0006 §2.2 mandates the canonical OpenAPI document at /openapi.json
  // (Swagger UI's default JSON path is /docs/json; we expose both).
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
}
