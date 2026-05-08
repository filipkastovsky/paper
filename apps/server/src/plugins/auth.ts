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
  await app.register(fastifyJwt, {
    secret: opts.config.JWT_SECRET,
    // Pin HS256 in both directions to match `apps/server/src/lib/tokens.ts` and
    // defend against algorithm-confusion attacks (e.g. `none`, RS256-with-HMAC-secret).
    sign: { algorithm: "HS256" },
    verify: { algorithms: ["HS256"] },
  });
  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.warn({ err }, "jwt verify failed");
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
