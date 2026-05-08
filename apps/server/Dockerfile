# syntax=docker/dockerfile:1.7

# ----- Stage 1: build -----
FROM --platform=linux/arm64 node:22-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# Copy workspace manifests for cache-friendly install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/

RUN pnpm install --frozen-lockfile --filter "@paper/server..." --filter "@paper/shared"

# Copy sources and build
COPY packages/shared packages/shared
COPY apps/server apps/server

RUN pnpm --filter @paper/shared typecheck \
    && pnpm --filter @paper/server build

# ----- Stage 2: runtime -----
FROM --platform=linux/arm64 node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Re-install only production deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate \
    && pnpm install --frozen-lockfile --prod --filter "@paper/server..." --filter "@paper/shared"

COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/drizzle apps/server/drizzle
COPY --from=build /repo/packages/shared/src packages/shared/src

USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
