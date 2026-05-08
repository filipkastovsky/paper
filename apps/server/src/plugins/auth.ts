import type { Config } from "@/config.js";
import fastifyJwt from "@fastify/jwt";
import fp from "fastify-plugin";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; iat: number; exp: number };
    user: { sub: string; iat: number; exp: number };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
  }
}

export const authPlugin = fp(async (app, opts: { config: Config }) => {
  await app.register(fastifyJwt, { secret: opts.config.JWT_SECRET });
  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (_err) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
