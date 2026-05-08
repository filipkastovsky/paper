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
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
  });
}
