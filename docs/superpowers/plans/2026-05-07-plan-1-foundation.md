# Plan 1: Foundation & Deployable Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can install the `paper` PWA on their phone, automatically authenticate with a device UUID, and see a welcome screen rendered with Marshmallow primitives — fully deployed to the Hetzner k3s cluster (API) and Cloudflare Pages (PWA), with logs in Loki, traces in Tempo, and metrics in Prometheus.

**Architecture:** A pnpm monorepo (`apps/web`, `apps/server`, `packages/shared`, `packages/api-client`) wired to a `podman compose` dev environment (Postgres, Redis, MinIO) and a single Terragrunt stack at `../lab/stacks/paper/` that deploys the API + per-app Redis + migration Job to the existing CloudNativePG-equipped cluster. The PWA is built by Vite and shipped to Cloudflare Pages; the API is a Fastify+Drizzle service behind a Cloudflare-proxied Traefik IngressRoute. End-user auth is a custom JWT-with-refresh flow keyed by a client-generated device UUID.

**Tech Stack:** Node 22 LTS, pnpm 9, Fastify 5, Zod 4, Drizzle, Kubb, postgres.js, pino, OpenTelemetry, Vite 5, React 18, TanStack Router, TanStack Query, Zustand, Tailwind v4, vite-plugin-pwa, Vitest, Playwright, Biome, lefthook, Docker (ARM64), kubectl, terragrunt, wrangler. See `docs/decisions/0001`–`0009` for the full rationale.

---

## Prerequisites

These must exist before Task 1. Verify each.

| # | Prerequisite | How to verify |
|---|---|---|
| P1 | Node 22 + pnpm 9 installed | `node -v` → `v22.*`; `pnpm -v` → `9.*` |
| P2 | Podman machine running (macOS) or podman socket up (Linux) | `podman ps` succeeds |
| P3 | `lab` repo cloned at `/Users/filipkastovsky/work/personal/lab` with cluster reachable | `cd ../lab && kubectl --kubeconfig=lab_kubeconfig.yaml get nodes` shows 3 nodes Ready |
| P4 | Cloudflare account with API token (Zone:DNS:Edit + Pages:Edit + Workers R2 Storage:Edit) | `npx wrangler whoami` succeeds |
| P5 | DNS A record `paper.lab.filipkastovsky.cz` (orange-cloud proxied) → cluster ingress IP — **created via Cloudflare dashboard before Task 22** | `dig paper.lab.filipkastovsky.cz` returns Cloudflare IP |
| P6 | GitHub Personal Access Token with `write:packages` scope, exported as `GHCR_TOKEN`, plus `GHCR_USER=<your-github-username>` | `echo $GHCR_TOKEN \| podman login ghcr.io -u $GHCR_USER --password-stdin` succeeds |
| P7 | Cloudflare R2 bucket `paper-share-cards` and a Pages project named `paper-web` (created via dashboard or `wrangler r2 bucket create paper-share-cards` + `wrangler pages project create paper-web`) | both visible in dashboard |
| P8 | `tofu` (OpenTofu) and `terragrunt` installed | `tofu -version`, `terragrunt -v` |

If any P-row fails, fix it before starting Task 1.

---

## Container runtime note

This project uses **podman** end-to-end (the user does not have docker installed). Implications threaded through the plan:

- `podman compose` shells out to `docker-compose` (or `podman-compose`) to read `docker-compose.yml`. The on-disk filename remains `docker-compose.yml` because that's the canonical compose file name; only the CLI invocation is `podman compose`.
- `podman build --platform=linux/arm64 ...` replaces `docker buildx build`. No `--load` flag (built images go to the local store directly). `--push` is replaced by a separate `podman push` after the build completes.
- On macOS, podman runs containers in a Linux VM. Containers reach the host via `host.containers.internal`, **not** `localhost`. The smoke-run step in Task 20 reflects this.
- `podman login ghcr.io` for registry auth.
- `Dockerfile` filename and `# syntax=docker/dockerfile:1.7` directive are kept as-is; podman build understands them natively.

---

## File structure

This plan creates the following layout. Files are listed once at the location they're first introduced; subsequent tasks modify them.

```
startup/                                       # this repo
├── .gitignore
├── biome.json
├── lefthook.yml
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/
│   ├── server/
│   │   ├── Dockerfile
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── drizzle/                          # generated SQL migrations
│   │   ├── src/
│   │   │   ├── index.ts                      # Fastify boot
│   │   │   ├── server.ts                     # buildServer() factory (testable)
│   │   │   ├── config.ts                     # Zod-validated env
│   │   │   ├── migrate.ts                    # standalone migration runner
│   │   │   ├── db/
│   │   │   │   ├── client.ts
│   │   │   │   └── schema/
│   │   │   │       ├── index.ts
│   │   │   │       ├── users.ts
│   │   │   │       └── refresh-tokens.ts
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts                   # @fastify/jwt + auth helpers
│   │   │   │   ├── otel.ts
│   │   │   │   ├── rate-limit.ts
│   │   │   │   └── swagger.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts
│   │   │   │   └── auth.ts
│   │   │   └── lib/
│   │   │       └── tokens.ts                 # JWT signing + refresh-token helpers
│   │   └── test/
│   │       ├── helpers/
│   │       │   ├── db.ts                     # truncate-tables helper
│   │       │   └── server.ts                 # test Fastify factory
│   │       └── routes/
│   │           ├── health.test.ts
│   │           └── auth.test.ts
│   └── web/
│       ├── index.html
│       ├── package.json
│       ├── playwright.config.ts
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── public/
│       │   ├── favicon.ico
│       │   └── icons/
│       │       ├── icon-192.png
│       │       └── icon-512.png
│       ├── src/
│       │   ├── main.tsx
│       │   ├── routeTree.gen.ts              # generated by TanStack Router
│       │   ├── components/
│       │   │   └── ui/                       # copied from docs/design/react/components/ui/
│       │   ├── lib/
│       │   │   ├── api.ts                    # fetch wrapper with auth + refresh
│       │   │   ├── auth.ts                   # device UUID, token storage
│       │   │   ├── cn.ts                     # clsx + tailwind-merge
│       │   │   ├── format.ts                 # USD/pct/qty formatters (copied from docs/design/react/lib/)
│       │   │   ├── posthog.ts
│       │   │   └── query-client.ts
│       │   ├── routes/
│       │   │   ├── __root.tsx
│       │   │   └── index.tsx                 # welcome screen
│       │   ├── stores/
│       │   │   └── ui-store.ts
│       │   └── styles/
│       │       ├── globals.css               # copied from docs/design/react/globals.css
│       │       └── tokens.css                # copied from docs/design/tokens.css
│       └── tests/
│           └── e2e/
│               └── smoke.spec.ts
├── packages/
│   ├── api-client/
│   │   ├── kubb.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/                              # generated
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── events.ts
│           ├── index.ts
│           └── types.ts
└── docs/                                     # already exists
```

And in the sibling lab repo:

```
lab/                                          # ../lab
└── stacks/
    └── paper/
        ├── terragrunt.hcl
        ├── main.tf
        └── manifests/
            ├── 00-redis.yaml
            ├── 10-migrate-job.yaml
            ├── 20-paper-api-deployment.yaml
            ├── 21-paper-api-service.yaml
            └── 22-paper-api-ingressroute.yaml
```

---

## Tasks

### Task 1: Initialize the pnpm monorepo skeleton

**Files:**
- Create: `.gitignore`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
.turbo/
.cache/
coverage/
.DS_Store
*.log

# env
.env
.env.*
!.env.example

# IDE
.idea/
.vscode/

# build outputs
apps/web/dist/
apps/web/dev-dist/
apps/web/playwright-report/
apps/web/test-results/
apps/server/dist/
packages/api-client/src/
!packages/api-client/src/.gitkeep

# tooling
.pnpm-store/
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "paper",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22",
    "pnpm": ">=10"
  },
  "packageManager": "pnpm@10.30.3",
  "scripts": {
    "dev:infra": "podman compose up -d",
    "dev:infra:down": "podman compose down -v",
    "dev": "pnpm dev:infra && pnpm -r --parallel dev",
    "dev:web": "pnpm --filter @paper/web dev",
    "dev:server": "pnpm --filter @paper/server dev",
    "build": "pnpm -r build",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter @paper/web test:e2e",
    "gen:api-client": "pnpm --filter @paper/api-client gen",
    "db:generate": "pnpm --filter @paper/server db:generate",
    "db:migrate": "pnpm --filter @paper/server db:migrate"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "lefthook": "^1.10.0",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "useDefineForClassFields": true
  }
}
```

- [ ] **Step 5: Run install**

Run: `pnpm install`
Expected: completes successfully, creates `pnpm-lock.yaml` and `node_modules/`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore pnpm-workspace.yaml package.json tsconfig.base.json pnpm-lock.yaml
git commit -m "chore: initialize pnpm monorepo skeleton"
```

---

### Task 2: Add Biome + lefthook tooling

**Files:**
- Create: `biome.json`, `lefthook.yml`

- [ ] **Step 1: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "ignore": [
      "**/dist",
      "**/node_modules",
      "**/coverage",
      "**/.cache",
      "docs/**",
      "packages/api-client/src/**",
      "apps/web/src/routeTree.gen.ts",
      "apps/server/drizzle/**"
    ]
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "a11y": { "recommended": true },
      "style": { "useImportType": "error", "useNodejsImportProtocol": "error" },
      "correctness": {
        "noUnusedImports": "warn",
        "noUnusedVariables": "warn",
        "useExhaustiveDependencies": "warn"
      },
      "suspicious": { "noConsoleLog": "warn" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  }
}
```

- [ ] **Step 2: Create `lefthook.yml`**

```yaml
pre-commit:
  piped: true
  commands:
    biome:
      glob: "*.{ts,tsx,js,jsx,json,jsonc}"
      run: pnpm exec biome check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true
    typecheck:
      glob: "*.{ts,tsx}"
      run: pnpm -r typecheck
```

The `api-client-regen` hook listed in ADR 0008 is added in Task 12 once the pipeline exists.

- [ ] **Step 3: Install lefthook hooks**

Run: `pnpm exec lefthook install`
Expected: writes `.git/hooks/pre-commit`, prints "sync hooks: ✔️ (lefthook)".

- [ ] **Step 4: Verify Biome lints the empty repo cleanly**

Run: `pnpm lint`
Expected: prints `Checked X files in <Y>ms. No fixes applied.` with exit 0.

- [ ] **Step 5: Commit**

```bash
git add biome.json lefthook.yml package.json pnpm-lock.yaml
git commit -m "chore: add biome + lefthook"
```

---

### Task 3: Add `docker-compose.yml` for local infra (run via `podman compose`)

**Files:**
- Create: `docker-compose.yml`, `.env.example`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
name: paper

services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: paper
    volumes:
      - paper_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d paper"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - paper_minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  paper_pg_data: {}
  paper_minio_data: {}
```

- [ ] **Step 2: Create `.env.example`**

```dotenv
# Server
DATABASE_URL=postgres://app:app@localhost:5432/paper
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-only-change-me-to-a-64-byte-hex-string-in-prod-please-rotate
LOG_LEVEL=debug
HOST=0.0.0.0
PORT=3000

# Web (Vite reads VITE_*)
# VITE_API_BASE: localhost works when web runs on the host; from inside a container use host.containers.internal.
VITE_API_BASE=http://localhost:3000
VITE_POSTHOG_API_KEY=
VITE_POSTHOG_HOST=https://eu.posthog.com
```

- [ ] **Step 3: Bring up local infra**

Run: `cp .env.example .env && pnpm dev:infra`
Expected: `podman compose up -d` finishes, `podman compose ps` shows 3 services healthy. Verify Postgres: `podman exec -i $(podman compose ps -q postgres) psql -U app -d paper -c "SELECT 1;"` returns `1`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add local docker-compose (postgres, redis, minio)"
```

---

### Task 4: Scaffold `packages/shared`

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/events.ts`, `packages/shared/src/types.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@paper/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared/src/events.ts`**

```typescript
// Per spec §9. Add new event names here as they're implemented.
export const EVENTS = {
  APP_OPENED: "app_opened",
  ONBOARDING_STEP_COMPLETED: "onboarding_step_completed",
  ONBOARDING_FINISHED: "onboarding_finished",
  SESSION_STARTED: "session_started",
  SESSION_ENDED: "session_ended",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
```

- [ ] **Step 4: Create `packages/shared/src/types.ts`**

```typescript
export type AssetId = string; // narrowed to a union once the asset list is locked in Plan 2
export type Side = "buy" | "sell";
```

- [ ] **Step 5: Create `packages/shared/src/index.ts`**

```typescript
export * from "./events.js";
export * from "./types.js";
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @paper/shared typecheck`
Expected: exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): scaffold @paper/shared package with events + types"
```

---

### Task 5: Scaffold `apps/server` Fastify boot + /v1/health

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/src/config.ts`, `apps/server/src/server.ts`, `apps/server/src/index.ts`, `apps/server/src/routes/health.ts`, `apps/server/test/helpers/server.ts`, `apps/server/test/routes/health.test.ts`

- [ ] **Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@paper/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json --noCheck && tsc-alias -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@paper/shared": "workspace:*",
    "fastify": "^5.2.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "tsc-alias": "^1.8.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `apps/server/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    setupFiles: [],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
```

- [ ] **Step 4: Create `apps/server/src/config.ts`**

```typescript
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}
```

- [ ] **Step 5: Create `apps/server/src/routes/health.ts`**

```typescript
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/health", async () => ({ status: "ok" as const }));
}
```

- [ ] **Step 6: Create `apps/server/src/server.ts`**

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { healthRoutes } from "./routes/health.js";

export interface BuildServerOptions {
  config: Config;
}

export async function buildServer({ config }: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
    disableRequestLogging: false,
  });

  await app.register(healthRoutes);

  return app;
}
```

- [ ] **Step 7: Create `apps/server/src/index.ts`**

```typescript
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutdown initiated");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Create `apps/server/test/helpers/server.ts`**

```typescript
import { buildServer } from "@/server.js";
import { loadConfig } from "@/config.js";

export async function makeTestServer() {
  const config = loadConfig({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    JWT_SECRET: "test-secret-must-be-at-least-32-characters-long",
    LOG_LEVEL: "silent",
  } as NodeJS.ProcessEnv);
  const app = await buildServer({ config });
  await app.ready();
  return app;
}
```

- [ ] **Step 9: Write the failing test for /v1/health**

Create `apps/server/test/routes/health.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestServer } from "../helpers/server.js";

describe("GET /v1/health", () => {
  let app: Awaited<ReturnType<typeof makeTestServer>>;

  beforeAll(async () => {
    app = await makeTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 10: Install deps and run test (should pass on first run since we wrote handler in step 5)**

Run: `pnpm install` (from repo root) then `pnpm --filter @paper/server test`
Expected: 1 passed.

- [ ] **Step 11: Smoke-run the server**

Run: `pnpm --filter @paper/server dev`
In another terminal: `curl -sS http://localhost:3000/v1/health`
Expected: `{"status":"ok"}`. Stop dev server (Ctrl-C).

- [ ] **Step 12: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): scaffold Fastify boot with /v1/health and tests"
```

---

### Task 6: Add Drizzle ORM + first schema (users, refresh_tokens) + migration runner

**Files:**
- Create: `apps/server/drizzle.config.ts`, `apps/server/src/db/client.ts`, `apps/server/src/db/schema/users.ts`, `apps/server/src/db/schema/refresh-tokens.ts`, `apps/server/src/db/schema/index.ts`, `apps/server/src/migrate.ts`, `apps/server/test/helpers/db.ts`

- [ ] **Step 1: Add Drizzle deps to `apps/server/package.json`**

Append to `dependencies`:

```json
"drizzle-orm": "^0.38.3",
"postgres": "^3.4.5"
```

Append to `devDependencies`:

```json
"drizzle-kit": "^0.30.1"
```

Add to `scripts`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx src/migrate.ts",
"db:studio": "drizzle-kit studio"
```

Run from repo root: `pnpm install`.

- [ ] **Step 2: Create `apps/server/drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
  },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
```

- [ ] **Step 3: Create `apps/server/src/db/schema/users.ts`**

```typescript
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").unique(), // nullable until onboarding step 2 (Plan 2)
  deviceUuid: text("device_uuid").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- [ ] **Step 4: Create `apps/server/src/db/schema/refresh-tokens.ts`**

```typescript
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    familyId: uuid("family_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    byUser: index("refresh_tokens_user_id_idx").on(t.userId),
    byFamily: index("refresh_tokens_family_id_idx").on(t.familyId),
  }),
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
```

- [ ] **Step 5: Create `apps/server/src/db/schema/index.ts`**

```typescript
export * from "./users.js";
export * from "./refresh-tokens.js";
```

- [ ] **Step 6: Create `apps/server/src/db/client.ts`**

```typescript
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandles {
  db: Db;
  sql: postgres.Sql;
}

export function makeDb(databaseUrl: string): DbHandles {
  const sql = postgres(databaseUrl, { prepare: false, max: 10 });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql };
}
```

- [ ] **Step 7: Create `apps/server/src/migrate.ts`**

```typescript
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sql } = makeDb(config.DATABASE_URL);
  console.log("running migrations against", config.DATABASE_URL.replace(/:.+@/, ":***@"));
  await migrate(db, { migrationsFolder: "drizzle" });
  await sql.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Generate the first migration**

Run: `pnpm --filter @paper/server db:generate`
Expected: writes `apps/server/drizzle/0000_<random_name>.sql` containing `CREATE TABLE "users"...` and `CREATE TABLE "refresh_tokens"...`. Commit it later in step 11.

- [ ] **Step 9: Apply the migration to the local docker-compose Postgres**

Ensure `podman compose ps` shows postgres healthy. Then:

Run: `pnpm --filter @paper/server db:migrate`
Expected: prints `migrations applied`.

Verify: `podman exec -i $(podman compose ps -q postgres) psql -U app -d paper -c "\dt"` shows `users` and `refresh_tokens` tables.

- [ ] **Step 10: Create `apps/server/test/helpers/db.ts` for tests that need a clean DB**

```typescript
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client.js";

export async function truncateAllTables(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE "refresh_tokens", "users" RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 11: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): add Drizzle ORM with users + refresh_tokens schema and migration runner"
```

---

### Task 7: Wire `fastify-type-provider-zod` + OpenAPI (`@fastify/swagger` + `@fastify/swagger-ui`)

**Files:**
- Create: `apps/server/src/plugins/swagger.ts`
- Modify: `apps/server/src/server.ts`, `apps/server/src/routes/health.ts`, `apps/server/test/routes/health.test.ts`

- [ ] **Step 1: Add deps**

Append to `apps/server/package.json` `dependencies`:

```json
"@fastify/swagger": "^9.4.0",
"@fastify/swagger-ui": "^5.2.0",
"fastify-type-provider-zod": "^4.0.2"
```

Run: `pnpm install`.

- [ ] **Step 2: Create `apps/server/src/plugins/swagger.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
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
```

- [ ] **Step 3: Modify `apps/server/src/server.ts` to register Zod type provider + Swagger**

Replace its contents with:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import { registerSwagger } from "./plugins/swagger.js";
import { healthRoutes } from "./routes/health.js";

export interface BuildServerOptions {
  config: Config;
}

export async function buildServer({ config }: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await registerSwagger(app);
  await app.register(healthRoutes);

  return app;
}

export type AppInstance = FastifyInstance;
```

- [ ] **Step 4: Modify `apps/server/src/routes/health.ts` to declare a Zod response schema (so it shows up in OpenAPI)**

```typescript
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

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
```

- [ ] **Step 5: Add an OpenAPI test**

Append to `apps/server/test/routes/health.test.ts`:

```typescript
describe("GET /openapi.json", () => {
  let app: Awaited<ReturnType<typeof makeTestServer>>;

  beforeAll(async () => {
    app = await makeTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes the health endpoint in the OpenAPI spec", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { paths: Record<string, unknown> };
    expect(spec.paths["/v1/health"]).toBeDefined();
  });
});
```

(`@fastify/swagger-ui`'s default JSON route is `/docs/json`; the UI itself lives at `/docs`.)

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @paper/server test`
Expected: 2 passed.

- [ ] **Step 7: Smoke check**

Run server (`pnpm --filter @paper/server dev`) and open `http://localhost:3000/docs` in a browser. Expected: Swagger UI lists the health endpoint.

- [ ] **Step 8: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): wire Zod type provider + OpenAPI with Swagger UI"
```

---

### Task 8: Add JWT signing + auth helpers (`apps/server/src/lib/tokens.ts`)

**Files:**
- Create: `apps/server/src/lib/tokens.ts`, `apps/server/test/lib/tokens.test.ts`

- [ ] **Step 1: Add deps**

Append to `apps/server/package.json` `dependencies`:

```json
"@fastify/jwt": "^9.0.4"
```

Run: `pnpm install`.

- [ ] **Step 2: Write the failing tests for `mintAccessToken`, `mintRefreshToken`, `hashRefreshToken`**

Create `apps/server/test/lib/tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  hashRefreshToken,
  mintAccessToken,
  mintRefreshToken,
  verifyAccessToken,
} from "@/lib/tokens.js";

const SECRET = "test-secret-must-be-at-least-32-characters-long";

describe("mintAccessToken / verifyAccessToken", () => {
  it("round-trips a user id", async () => {
    const userId = "00000000-0000-0000-0000-000000000001";
    const token = await mintAccessToken({ secret: SECRET, userId });
    const claims = await verifyAccessToken({ secret: SECRET, token });
    expect(claims.sub).toBe(userId);
    expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintAccessToken({ secret: SECRET, userId: "x" });
    await expect(verifyAccessToken({ secret: "other-secret-32-characters-minimum", token })).rejects.toThrow();
  });
});

describe("mintRefreshToken / hashRefreshToken", () => {
  it("returns a 256-bit url-safe token and a stable hash", () => {
    const { token, hash } = mintRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url of 32 bytes
    expect(hashRefreshToken(token)).toBe(hash);
  });

  it("default expiry is 90 days", () => {
    expect(REFRESH_TOKEN_TTL_DAYS).toBe(90);
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run: `pnpm --filter @paper/server test test/lib/tokens.test.ts`
Expected: FAIL — module `@/lib/tokens.js` not found.

- [ ] **Step 4: Implement `apps/server/src/lib/tokens.ts`**

```typescript
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
export const REFRESH_TOKEN_TTL_DAYS = 90;

export interface AccessClaims {
  sub: string;
  iat: number;
  exp: number;
}

export async function mintAccessToken(params: { secret: string; userId: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS };
  return jwt.sign(payload, params.secret, { subject: params.userId, algorithm: "HS256" });
}

export async function verifyAccessToken(params: { secret: string; token: string }): Promise<AccessClaims> {
  const decoded = jwt.verify(params.token, params.secret, { algorithms: ["HS256"] });
  if (typeof decoded === "string" || !decoded.sub || typeof decoded.iat !== "number" || typeof decoded.exp !== "number") {
    throw new Error("invalid jwt payload");
  }
  return { sub: String(decoded.sub), iat: decoded.iat, exp: decoded.exp };
}

export function mintRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

(Note: `@fastify/jwt` is added in Task 9 for request-time auth; the helpers above use `jsonwebtoken` directly because we need to mint tokens outside of request context too. They're compatible — both use HS256 and the same secret.)

- [ ] **Step 5: Add `jsonwebtoken` dep**

Append to `apps/server/package.json` `dependencies`:

```json
"jsonwebtoken": "^9.0.2"
```

Append to `devDependencies`:

```json
"@types/jsonwebtoken": "^9.0.7"
```

Run: `pnpm install`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @paper/server test test/lib/tokens.test.ts`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): add JWT + refresh token helpers with tests"
```

---

### Task 9: Add @fastify/jwt auth plugin (verify Bearer tokens on protected routes)

**Files:**
- Create: `apps/server/src/plugins/auth.ts`
- Modify: `apps/server/src/server.ts`

- [ ] **Step 1: Create `apps/server/src/plugins/auth.ts`**

```typescript
import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { Config } from "@/config.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; iat: number; exp: number };
    user: { sub: string; iat: number; exp: number };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app, opts: { config: Config }) => {
  await app.register(fastifyJwt, { secret: opts.config.JWT_SECRET });
  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
```

- [ ] **Step 2: Wire it in `apps/server/src/server.ts`**

In `buildServer`, after `setSerializerCompiler` and before `registerSwagger`, add:

```typescript
import { authPlugin } from "./plugins/auth.js";
// ...
await app.register(authPlugin, { config });
```

- [ ] **Step 3: Verify the existing tests still pass**

Run: `pnpm --filter @paper/server test`
Expected: 2 passed (no auth-protected routes yet).

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -m "feat(server): add @fastify/jwt auth plugin with authenticate decorator"
```

---

### Task 10: TDD `POST /v1/auth/device` (create user from device UUID, mint tokens)

**Files:**
- Create: `apps/server/src/routes/auth.ts`, `apps/server/test/routes/auth.test.ts`
- Modify: `apps/server/src/server.ts` (register route), `apps/server/test/helpers/server.ts` (inject db handle)

- [ ] **Step 1: Modify `apps/server/test/helpers/server.ts` so tests share a single Postgres connection and clean state between tests**

Replace its contents with:

```typescript
import { buildServer } from "@/server.js";
import { loadConfig } from "@/config.js";
import { makeDb, type DbHandles } from "@/db/client.js";

export interface TestServer {
  app: Awaited<ReturnType<typeof buildServer>>;
  db: DbHandles["db"];
  sql: DbHandles["sql"];
  config: ReturnType<typeof loadConfig>;
}

export async function makeTestServer(): Promise<TestServer> {
  const config = loadConfig({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "0",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    JWT_SECRET: "test-secret-must-be-at-least-32-characters-long",
    LOG_LEVEL: "silent",
  } as NodeJS.ProcessEnv);
  const handles = makeDb(config.DATABASE_URL);
  const app = await buildServer({ config, db: handles.db });
  await app.ready();
  return { app, db: handles.db, sql: handles.sql, config };
}
```

- [ ] **Step 2: Modify `apps/server/src/server.ts` to accept and decorate the db**

Replace its contents with:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { authPlugin } from "./plugins/auth.js";
import { registerSwagger } from "./plugins/swagger.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
  }
}

export interface BuildServerOptions {
  config: Config;
  db: Db;
}

export async function buildServer({ config, db }: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db);
  app.decorate("config", config);

  await app.register(authPlugin, { config });
  await registerSwagger(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);

  return app;
}

export type AppInstance = FastifyInstance;
```

- [ ] **Step 3: Modify `apps/server/src/index.ts` to construct db**

Replace its contents with:

```typescript
import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL);
  const app = await buildServer({ config, db: handles.db });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutdown initiated");
    await app.close();
    await handles.sql.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Write the failing test**

Create `apps/server/test/routes/auth.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema/index.js";
import { truncateAllTables } from "../helpers/db.js";
import { makeTestServer, type TestServer } from "../helpers/server.js";

describe("POST /v1/auth/device", () => {
  let ctx: TestServer;

  beforeAll(async () => {
    ctx = await makeTestServer();
  });

  afterEach(async () => {
    await truncateAllTables(ctx.db);
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
  });

  it("creates a user on first call and returns tokens", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "11111111-1111-1111-1111-111111111111" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      access_token: string;
      refresh_token: string;
      user: { id: string; handle: string | null };
    };
    expect(body.access_token).toMatch(/^eyJ/);
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user.handle).toBeNull();

    const rows = await ctx.db.select().from(users).where(eq(users.deviceUuid, "11111111-1111-1111-1111-111111111111"));
    expect(rows).toHaveLength(1);
  });

  it("returns the existing user on subsequent calls (idempotent)", async () => {
    const first = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "22222222-2222-2222-2222-222222222222" },
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "22222222-2222-2222-2222-222222222222" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstUser = first.json().user as { id: string };
    const secondUser = second.json().user as { id: string };
    expect(firstUser.id).toBe(secondUser.id);
  });

  it("rejects an invalid device_uuid", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 5: Run the failing test**

Run: `pnpm --filter @paper/server test test/routes/auth.test.ts`
Expected: all 3 fail (route does not exist).

- [ ] **Step 6: Implement `apps/server/src/routes/auth.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { refreshTokens, users } from "@/db/schema/index.js";
import {
  REFRESH_TOKEN_TTL_DAYS,
  mintAccessToken,
  mintRefreshToken,
} from "@/lib/tokens.js";
import { randomUUID } from "node:crypto";

const DeviceAuthBody = z.object({
  device_uuid: z.string().uuid(),
});

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    handle: z.string().nullable(),
  }),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
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
        existing ??
        (await app.db
          .insert(users)
          .values({ deviceUuid: device_uuid })
          .returning())[0];
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
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @paper/server test test/routes/auth.test.ts`
Expected: 3 passed.

- [ ] **Step 8: Run the full server suite**

Run: `pnpm --filter @paper/server test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/server
git commit -m "feat(server): POST /v1/auth/device upserts user + mints token pair"
```

---

### Task 11: TDD `POST /v1/auth/refresh` (rotate refresh token; revoke family on reuse)

**Files:**
- Modify: `apps/server/src/routes/auth.ts`, `apps/server/test/routes/auth.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `apps/server/test/routes/auth.test.ts`:

```typescript
import { hashRefreshToken } from "@/lib/tokens.js";
import { refreshTokens } from "@/db/schema/index.js";

describe("POST /v1/auth/refresh", () => {
  let ctx: TestServer;

  beforeAll(async () => {
    ctx = await makeTestServer();
  });

  afterEach(async () => {
    await truncateAllTables(ctx.db);
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
  });

  async function deviceAuth(deviceUuid: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: deviceUuid },
    });
    return res.json() as { access_token: string; refresh_token: string; user: { id: string } };
  }

  it("rotates the refresh token and returns new access + refresh", async () => {
    const auth = await deviceAuth("33333333-3333-3333-3333-333333333333");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: auth.refresh_token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { access_token: string; refresh_token: string };
    expect(body.refresh_token).not.toBe(auth.refresh_token);
    expect(body.access_token).toMatch(/^eyJ/);

    // old refresh token is revoked
    const oldHash = hashRefreshToken(auth.refresh_token);
    const [oldRow] = await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, oldHash));
    expect(oldRow?.revokedAt).not.toBeNull();
  });

  it("rejects a reused (revoked) refresh token and revokes the entire family", async () => {
    const auth = await deviceAuth("44444444-4444-4444-4444-444444444444");
    // first rotation succeeds
    const firstRotate = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: auth.refresh_token },
    });
    expect(firstRotate.statusCode).toBe(200);

    // attempt to reuse the original refresh token
    const replay = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: auth.refresh_token },
    });
    expect(replay.statusCode).toBe(401);

    // all tokens in the family are revoked
    const all = await ctx.db.select().from(refreshTokens);
    for (const row of all) {
      expect(row.revokedAt).not.toBeNull();
    }
  });

  it("rejects an unknown refresh token", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @paper/server test test/routes/auth.test.ts`
Expected: 3 new tests fail with 404 or unexpected status.

- [ ] **Step 3: Implement the route**

Append to `apps/server/src/routes/auth.ts` (inside `authRoutes`, before the closing brace):

```typescript
  const RefreshBody = z.object({ refresh_token: z.string().min(20) });

  typed.post(
    "/v1/auth/refresh",
    {
      schema: {
        tags: ["auth"],
        summary: "Rotate a refresh token",
        body: RefreshBody,
        response: {
          200: TokenResponse.pick({ access_token: true, refresh_token: true }),
          401: z.object({ error: z.literal("invalid_refresh_token") }),
        },
      },
    },
    async (request, reply) => {
      const { refresh_token } = request.body;
      const presentedHash = (await import("@/lib/tokens.js")).hashRefreshToken(refresh_token);

      const [row] = await app.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, presentedHash));

      if (!row) {
        return reply.code(401).send({ error: "invalid_refresh_token" as const });
      }

      // detect replay: token already revoked → revoke entire family
      if (row.revokedAt || row.expiresAt < new Date()) {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.familyId, row.familyId));
        return reply.code(401).send({ error: "invalid_refresh_token" as const });
      }

      // rotate
      const newRefresh = mintRefreshToken();
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

      await app.db.transaction(async (tx) => {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.id, row.id));
        await tx.insert(refreshTokens).values({
          userId: row.userId,
          tokenHash: newRefresh.hash,
          familyId: row.familyId,
          expiresAt,
        });
      });

      const accessToken = await mintAccessToken({
        secret: app.config.JWT_SECRET,
        userId: row.userId,
      });

      return { access_token: accessToken, refresh_token: newRefresh.token };
    },
  );
```

(Top of file: replace `import { ... } from "@/lib/tokens.js"` with `import { REFRESH_TOKEN_TTL_DAYS, hashRefreshToken, mintAccessToken, mintRefreshToken } from "@/lib/tokens.js"` and remove the dynamic import inside the handler.)

Final imports for `apps/server/src/routes/auth.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { refreshTokens, users } from "@/db/schema/index.js";
import {
  REFRESH_TOKEN_TTL_DAYS,
  hashRefreshToken,
  mintAccessToken,
  mintRefreshToken,
} from "@/lib/tokens.js";
import { randomUUID } from "node:crypto";
```

And in the handler use `hashRefreshToken(refresh_token)` directly.

- [ ] **Step 4: Run the auth tests**

Run: `pnpm --filter @paper/server test test/routes/auth.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Run full test suite**

Run: `pnpm --filter @paper/server test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): POST /v1/auth/refresh with refresh-token rotation and family revocation"
```

---

### Task 12: Add OpenTelemetry, fastify-metrics, and `@fastify/rate-limit`

**Files:**
- Create: `apps/server/src/plugins/otel.ts`, `apps/server/src/plugins/rate-limit.ts`
- Modify: `apps/server/src/server.ts`, `apps/server/src/config.ts`, `.env.example`

- [ ] **Step 1: Add deps**

Append to `apps/server/package.json` `dependencies`:

```json
"@fastify/otel": "^0.8.0",
"@opentelemetry/api": "^1.9.0",
"@opentelemetry/sdk-node": "^0.55.0",
"@opentelemetry/auto-instrumentations-node": "^0.53.0",
"@opentelemetry/exporter-trace-otlp-http": "^0.55.0",
"fastify-metrics": "^12.1.0",
"@fastify/rate-limit": "^10.2.1",
"ioredis": "^5.4.2"
```

Run: `pnpm install`.

- [ ] **Step 2: Extend config schema**

In `apps/server/src/config.ts`, replace `ConfigSchema` with:

```typescript
const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default("paper-api"),
});
```

- [ ] **Step 3: Create `apps/server/src/plugins/otel.ts`**

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Config } from "@/config.js";

export function startOtel(config: Config): NodeSDK | null {
  if (!config.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  const headers = config.OTEL_EXPORTER_OTLP_HEADERS
    ? Object.fromEntries(
        config.OTEL_EXPORTER_OTLP_HEADERS.split(",").map((kv) => {
          const [k, ...v] = kv.split("=");
          return [k!.trim(), v.join("=").trim()];
        }),
      )
    : undefined;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: config.OTEL_SERVICE_NAME }),
    traceExporter: new OTLPTraceExporter({
      url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      headers,
    }),
    instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })],
  });
  sdk.start();
  return sdk;
}
```

- [ ] **Step 4: Create `apps/server/src/plugins/rate-limit.ts`**

```typescript
import fp from "fastify-plugin";
import fastifyRateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import type { Config } from "@/config.js";

export const rateLimitPlugin = fp(async (app, opts: { config: Config }) => {
  const redis = new Redis(opts.config.REDIS_URL, { maxRetriesPerRequest: 1 });
  await app.register(fastifyRateLimit, {
    redis,
    global: false, // opt-in per route in v0
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.headers["x-forwarded-for"]?.toString() ?? req.ip,
  });
});
```

- [ ] **Step 5: Wire in `apps/server/src/server.ts` after `authPlugin`**

Add to imports:

```typescript
import fastifyMetrics from "fastify-metrics";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
```

After `app.register(authPlugin, ...)`:

```typescript
await app.register(fastifyMetrics, { endpoint: "/metrics" });
await app.register(rateLimitPlugin, { config });
```

- [ ] **Step 6: Start OTel from `apps/server/src/index.ts` BEFORE `buildServer`**

Replace `apps/server/src/index.ts` with:

```typescript
import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";
import { startOtel } from "./plugins/otel.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const otel = startOtel(config); // no-op if endpoint unset
  const handles = makeDb(config.DATABASE_URL);
  const app = await buildServer({ config, db: handles.db });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutdown initiated");
    await app.close();
    await handles.sql.end();
    await otel?.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Update `.env.example`**

Append:

```dotenv
# OpenTelemetry (omit in dev to disable)
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=
OTEL_SERVICE_NAME=paper-api
```

- [ ] **Step 8: Run tests + smoke /metrics**

Run: `pnpm --filter @paper/server test`
Expected: all green.

Smoke: `pnpm --filter @paper/server dev`, then in another terminal `curl -sS http://localhost:3000/metrics | head -20`
Expected: Prometheus-format metrics including `nodejs_*` and `http_*`.

- [ ] **Step 9: Commit**

```bash
git add apps/server .env.example pnpm-lock.yaml
git commit -m "feat(server): add OTel SDK, Prometheus /metrics, and Redis-backed rate limiter"
```

---

### Task 13: Scaffold `packages/api-client` with Kubb codegen pipeline

**Files:**
- Create: `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/kubb.config.ts`, `packages/api-client/src/.gitkeep`
- Modify: `apps/server/scripts/dump-openapi.ts` (new), `apps/server/package.json`
- Modify: `lefthook.yml`

- [ ] **Step 1: Add a server script to dump openapi.json to disk**

Create `apps/server/scripts/dump-openapi.ts`:

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../src/config.js";
import { makeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";

async function main(): Promise<void> {
  const config = loadConfig({
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: "0",
    DATABASE_URL: "postgres://app:app@localhost:5432/paper",
    REDIS_URL: "redis://localhost:6379",
    JWT_SECRET: "build-time-only-must-be-at-least-32-characters",
    LOG_LEVEL: "silent",
    OTEL_SERVICE_NAME: "paper-api",
  } as NodeJS.ProcessEnv);
  const handles = makeDb(config.DATABASE_URL);
  const app = await buildServer({ config, db: handles.db });
  await app.ready();
  const spec = app.swagger();
  const out = "../../packages/api-client/openapi.json";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(spec, null, 2));
  await app.close();
  await handles.sql.end();
  console.log(`wrote ${out}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add to `apps/server/package.json` `scripts`:

```json
"openapi:dump": "tsx scripts/dump-openapi.ts"
```

(Note: this script does not need a live database — Drizzle/postgres connection is only opened, not exercised. It's fine if `podman compose` is not running, because `app.swagger()` runs after `app.ready()` based purely on registered route schemas.)

- [ ] **Step 2: Create `packages/api-client/package.json`**

```json
{
  "name": "@paper/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./msw": "./src/msw/index.ts"
  },
  "scripts": {
    "gen": "pnpm --filter @paper/server openapi:dump && kubb",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.62.7",
    "msw": "^2.7.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@kubb/cli": "^3.4.5",
    "@kubb/core": "^3.4.5",
    "@kubb/plugin-client": "^3.4.5",
    "@kubb/plugin-msw": "^3.4.5",
    "@kubb/plugin-oas": "^3.4.5",
    "@kubb/plugin-react-query": "^3.4.5",
    "@kubb/plugin-ts": "^3.4.5",
    "@kubb/plugin-zod": "^3.4.5",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 3: Create `packages/api-client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "preserve",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `packages/api-client/kubb.config.ts`**

```typescript
import { defineConfig } from "@kubb/core";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";
import { pluginClient } from "@kubb/plugin-client";
import { pluginReactQuery } from "@kubb/plugin-react-query";
import { pluginMsw } from "@kubb/plugin-msw";

export default defineConfig({
  root: ".",
  input: { path: "./openapi.json" },
  output: { path: "./src", clean: true },
  plugins: [
    pluginOas({ validate: true }),
    pluginTs({ output: { path: "types" } }),
    pluginZod({ output: { path: "zod" }, typed: true }),
    pluginClient({
      output: { path: "client" },
      client: { importPath: "../client/http-client.ts" },
    }),
    pluginReactQuery({
      output: { path: "hooks" },
      client: { importPath: "../client/http-client.ts" },
      mutation: { methods: ["post", "put", "patch", "delete"] },
    }),
    pluginMsw({ output: { path: "msw" }, handlers: true }),
  ],
});
```

- [ ] **Step 5: Create `packages/api-client/src/.gitkeep`**

Empty file. Required because the directory is in `.gitignore` (whole `src/` folder is generated except this marker).

Update `.gitignore` rule already present:
```
packages/api-client/src/
!packages/api-client/src/.gitkeep
```

- [ ] **Step 6: Create the manual fetch client base that the generated code imports**

Create `packages/api-client/src/client/http-client.ts` (this file is HAND-WRITTEN; Kubb is configured to leave it alone via the `clean: true` + path scoping. We achieve that by writing it BEFORE running gen and then ensuring the gen output paths don't overlap.)

Actually with `clean: true`, the entire `./src` folder is wiped each gen. To avoid losing the hand-written client, place it OUTSIDE `src` and reference it from kubb config.

Replace `kubb.config.ts`'s `client.importPath` to `../../http-client.ts`, and create the file at `packages/api-client/http-client.ts`:

```typescript
// packages/api-client/http-client.ts — HAND-WRITTEN. Kubb-generated code imports `client` from here.
const baseUrl = (typeof window !== "undefined"
  ? (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
  : process.env.API_BASE) ?? "http://localhost:3000";

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void { accessToken = token; }

export type RequestConfig<TData = unknown> = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  params?: Record<string, unknown>;
  data?: TData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type ResponseConfig<TData = unknown> = { data: TData; status: number };

export const client = async <TData, _TError = unknown, TVariables = unknown>(
  config: RequestConfig<TVariables>,
): Promise<ResponseConfig<TData>> => {
  const url = new URL(config.url, baseUrl);
  if (config.params) {
    for (const [k, v] of Object.entries(config.params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...config.headers,
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: config.method,
    headers,
    body: config.data ? JSON.stringify(config.data) : undefined,
    signal: config.signal,
  });
  const data = res.headers.get("content-type")?.includes("application/json")
    ? ((await res.json()) as TData)
    : ((await res.text()) as TData);
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}`) as Error & { status: number; data: unknown };
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return { data, status: res.status };
};

export default client;
```

Adjust `kubb.config.ts` to point at this hand-written client:

```typescript
pluginClient({ output: { path: "client" }, client: { importPath: "../../http-client.ts" } }),
pluginReactQuery({ output: { path: "hooks" }, client: { importPath: "../../http-client.ts" }, mutation: { methods: ["post", "put", "patch", "delete"] } }),
```

- [ ] **Step 7: Create a manual `src/index.ts` shim that re-exports the regenerated tree**

Because `clean: true` removes `src/index.ts` on each gen, instead create a top-level barrel at `packages/api-client/index.ts` and re-export FROM `./src/...` paths produced by Kubb:

Update `packages/api-client/package.json` `main`/`types`/`exports`:

```json
"main": "./index.ts",
"types": "./index.ts",
"exports": {
  ".": "./index.ts",
  "./msw": "./src/msw/index.ts",
  "./hooks": "./src/hooks/index.ts",
  "./types": "./src/types/index.ts"
}
```

Create `packages/api-client/index.ts`:

```typescript
export * from "./src/types/index.js";
export * from "./src/zod/index.js";
export * from "./src/hooks/index.js";
export { setAccessToken } from "./http-client.js";
```

(These imports will fail until the first gen runs; that's fine — fixed in Step 9.)

- [ ] **Step 8: Install deps**

Run: `pnpm install`.

- [ ] **Step 9: Run the first generation**

From repo root: `pnpm --filter @paper/api-client gen`
Expected: writes `packages/api-client/openapi.json` and populates `packages/api-client/src/{types,zod,client,hooks,msw}` with generated files.

Verify: `pnpm --filter @paper/api-client typecheck` exits 0.

- [ ] **Step 10: Add the api-client-regen pre-commit hook**

In `lefthook.yml`, append under `pre-commit > commands`:

```yaml
    api-client-regen:
      glob: "apps/server/src/{routes,db}/**/*.ts"
      run: pnpm gen:api-client && git add packages/api-client/src packages/api-client/openapi.json
      stage_fixed: true
```

- [ ] **Step 11: Commit**

```bash
git add packages/api-client lefthook.yml apps/server/scripts apps/server/package.json pnpm-lock.yaml .gitignore
git commit -m "feat(api-client): scaffold Kubb codegen pipeline + hand-written http-client"
```

(The committed `packages/api-client/src/` content is the seed generation. Since `.gitignore` excludes `src/` except for `.gitkeep`, force-add the generated content with `git add -f packages/api-client/src` if needed — or better, drop the `.gitignore` rule for that path and commit generated code (it's reviewable diff). Recommended: drop the rule. Edit `.gitignore` to remove the `packages/api-client/src/` line and the `.gitkeep` exception, then add and commit `packages/api-client/src/`.)

---

### Task 14: Scaffold `apps/web` Vite + React + Tailwind v4 + Marshmallow primitives

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/styles/globals.css`, `apps/web/src/styles/tokens.css`, `apps/web/src/lib/cn.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/components/ui/*.tsx`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@paper/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@paper/api-client": "workspace:*",
    "@paper/shared": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-popover": "^1.1.4",
    "@radix-ui/react-slider": "^1.2.2",
    "@radix-ui/react-tabs": "^1.1.2",
    "@radix-ui/react-toast": "^1.2.4",
    "@tanstack/react-query": "^5.62.7",
    "@tanstack/react-router": "^1.92.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "posthog-js": "^1.205.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^2.5.5",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "@tailwindcss/vite": "^4.0.0",
    "@tanstack/router-plugin": "^1.92.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vite": "^5.4.11",
    "vite-plugin-pwa": "^0.21.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vite/client", "vite-plugin-pwa/client"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "vite.config.ts", "playwright.config.ts", "tests"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`** (PWA wired in Task 18; minimal here)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { port: 5173 },
});
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap"
      rel="stylesheet"
    />
    <meta name="theme-color" content="#FAFAF1" />
    <title>paper</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Copy `docs/design/tokens.css` → `apps/web/src/styles/tokens.css`**

```bash
mkdir -p apps/web/src/styles
cp docs/design/tokens.css apps/web/src/styles/tokens.css
```

- [ ] **Step 6: Copy `docs/design/react/globals.css` → `apps/web/src/styles/globals.css`** and adjust the import path

```bash
cp docs/design/react/globals.css apps/web/src/styles/globals.css
```

Edit the first line of `apps/web/src/styles/globals.css` from:

```css
@import "../tokens.css";
```

to:

```css
@import "./tokens.css";
```

- [ ] **Step 7: Copy lib helpers**

```bash
mkdir -p apps/web/src/lib
cp docs/design/react/lib/cn.ts apps/web/src/lib/cn.ts
cp docs/design/react/lib/format.ts apps/web/src/lib/format.ts
```

- [ ] **Step 8: Copy Marshmallow primitives**

```bash
mkdir -p apps/web/src/components/ui
cp -r docs/design/react/components/ui/* apps/web/src/components/ui/
```

Verify the imports inside the copied files reference `@/lib/cn` (or relative `../../lib/cn`). Adjust to `@/lib/cn` if needed by running:

```bash
sed -i '' 's|"\.\./\.\./lib/cn"|"@/lib/cn"|g' apps/web/src/components/ui/*.tsx
```

- [ ] **Step 9: Create `apps/web/src/routes/__root.tsx`**

```tsx
import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
});
```

- [ ] **Step 10: Create `apps/web/src/routes/index.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";

export const Route = createFileRoute("/")({
  component: WelcomeScreen,
});

function WelcomeScreen() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-12 flex items-center justify-center">
      <Card tone="paper" elevation="float" padding="lush" className="max-w-md w-full text-center relative">
        <span aria-hidden className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-peach opacity-50" />
        <span aria-hidden className="absolute -top-2 -right-3 h-12 w-12 rounded-full bg-mint opacity-60" />
        <div className="relative">
          <Eyebrow>welcome to paper</Eyebrow>
          <Heading level="display" className="mt-3">
            Learn crypto with $10,000 of practice cash.
          </Heading>
          <p className="mt-4 text-ink-soft">
            No real money. Pastel lessons. A daily question. A streak you'll want to keep.
          </p>
          <Button trailing="→" fullWidth className="mt-8">
            Get started
          </Button>
        </div>
      </Card>
    </main>
  );
}
```

- [ ] **Step 11: Create `apps/web/src/main.tsx`**

```tsx
import "@/styles/globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router; }
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
```

- [ ] **Step 12: Install + run dev**

From repo root: `pnpm install`.
Run: `pnpm --filter @paper/web dev`
Expected: Vite serves on http://localhost:5173. Open it; the welcome screen renders with Marshmallow tokens (cream paper, peach blob, ink button). The `routeTree.gen.ts` file is auto-generated by the TanStack Router plugin on first run.

- [ ] **Step 13: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite + React + Tailwind v4 + Marshmallow primitives + welcome screen"
```

---

### Task 15: Add a placeholder PWA icon set

**Files:**
- Create: `apps/web/public/icons/icon-192.png`, `apps/web/public/icons/icon-512.png`, `apps/web/public/favicon.ico`

- [ ] **Step 1: Generate placeholder icons via a one-line Node script**

Create a temporary script `scripts/make-icons.mjs` at repo root:

```javascript
// minimal PNG: solid peach square; replace with real branding before public launch.
// Uses sharp (npx zero-install).
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

mkdirSync("apps/web/public/icons", { recursive: true });

const svg = (size) => `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="oklch(86% 0.085 35)"/>
  <text x="50%" y="58%" font-family="Bricolage Grotesque, sans-serif" font-weight="800"
        font-size="${size * 0.55}" fill="oklch(22% 0.022 275)" text-anchor="middle">P</text>
</svg>`;

for (const size of [192, 512]) {
  writeFileSync(`apps/web/public/icons/icon-${size}.svg`, svg(size));
}
console.log("wrote SVG placeholders; use sharp or any converter to produce PNGs.");
```

For now, ship the SVGs and a tiny `favicon.ico` placeholder. The browser tolerates SVG icons in the manifest (Task 18 sets the manifest paths). To produce PNG copies (preferred for iOS), run:

```bash
npx sharp-cli -i apps/web/public/icons/icon-192.svg -o apps/web/public/icons/icon-192.png
npx sharp-cli -i apps/web/public/icons/icon-512.svg -o apps/web/public/icons/icon-512.png
```

If sharp-cli is unavailable on your machine, skip PNG conversion and reference the SVGs in the manifest — the iOS install dialog will fall back to a generic icon for v0 stealth, fixed before TikTok launch.

- [ ] **Step 2: Add a minimal favicon**

Place any 32×32 PNG at `apps/web/public/favicon.ico` (or copy `apps/web/public/icons/icon-192.svg` to favicon.svg and update `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` in `index.html`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/public scripts/make-icons.mjs
git commit -m "chore(web): add placeholder PWA icons (peach P)"
```

---

### Task 16: Wire TanStack Query + Zustand + PostHog client

**Files:**
- Create: `apps/web/src/lib/query-client.ts`, `apps/web/src/lib/posthog.ts`, `apps/web/src/stores/ui-store.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Create `apps/web/src/lib/query-client.ts`**

```typescript
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});
```

- [ ] **Step 2: Create `apps/web/src/lib/posthog.ts`**

```typescript
import posthog from "posthog-js";

export function initPostHog(): void {
  const key = import.meta.env.VITE_POSTHOG_API_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://eu.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
  });
}

export { posthog };
```

- [ ] **Step 3: Create `apps/web/src/stores/ui-store.ts`**

```typescript
import { create } from "zustand";

interface UIState {
  installPromptDismissed: boolean;
  dismissInstallPrompt: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  installPromptDismissed: false,
  dismissInstallPrompt: () => set({ installPromptDismissed: true }),
}));
```

- [ ] **Step 4: Modify `apps/web/src/main.tsx`**

Replace its contents with:

```tsx
import "@/styles/globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { initPostHog } from "@/lib/posthog";
import { queryClient } from "@/lib/query-client";
import { routeTree } from "./routeTree.gen";

initPostHog();

const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router; }
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: Verify dev server still renders**

Run: `pnpm --filter @paper/web dev`, open http://localhost:5173, confirm no console errors. Stop server.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): wire TanStack Query, Zustand, PostHog"
```

---

### Task 17: Wire device-UUID auth flow on the client

**Files:**
- Create: `apps/web/src/lib/auth.ts`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`

- [ ] **Step 1: Create `apps/web/src/lib/auth.ts`**

```typescript
import { setAccessToken } from "@paper/api-client";

const STORAGE_DEVICE = "paper.device_uuid";
const STORAGE_REFRESH = "paper.refresh_token";
const STORAGE_USER = "paper.user";

interface StoredUser {
  id: string;
  handle: string | null;
}

interface AuthApiResponse {
  access_token: string;
  refresh_token: string;
  user: StoredUser;
}

function ensureDeviceUuid(): string {
  let uuid = localStorage.getItem(STORAGE_DEVICE);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(STORAGE_DEVICE, uuid);
  }
  return uuid;
}

async function postJson<TBody, TResp>(path: string, body: TBody): Promise<TResp> {
  const base = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth ${path} failed: ${res.status}`);
  return res.json() as Promise<TResp>;
}

export async function bootstrapAuth(): Promise<StoredUser> {
  const refresh = localStorage.getItem(STORAGE_REFRESH);

  if (refresh) {
    try {
      const data = await postJson<{ refresh_token: string }, AuthApiResponse>("/v1/auth/refresh", { refresh_token: refresh });
      persistAuth(data);
      return readUser();
    } catch {
      localStorage.removeItem(STORAGE_REFRESH);
      localStorage.removeItem(STORAGE_USER);
    }
  }

  const data = await postJson<{ device_uuid: string }, AuthApiResponse>("/v1/auth/device", {
    device_uuid: ensureDeviceUuid(),
  });
  persistAuth(data);
  return data.user;
}

function persistAuth(data: AuthApiResponse): void {
  setAccessToken(data.access_token);
  localStorage.setItem(STORAGE_REFRESH, data.refresh_token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(data.user));
}

function readUser(): StoredUser {
  const raw = localStorage.getItem(STORAGE_USER);
  if (!raw) throw new Error("user missing after auth");
  return JSON.parse(raw) as StoredUser;
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(STORAGE_USER);
  return raw ? (JSON.parse(raw) as StoredUser) : null;
}
```

- [ ] **Step 2: Bootstrap auth in `main.tsx` before rendering**

Replace `apps/web/src/main.tsx`:

```tsx
import "@/styles/globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { bootstrapAuth } from "@/lib/auth";
import { initPostHog, posthog } from "@/lib/posthog";
import { queryClient } from "@/lib/query-client";
import { routeTree } from "./routeTree.gen";

initPostHog();

async function start(): Promise<void> {
  const user = await bootstrapAuth();
  posthog.identify(user.id);

  const router = createRouter({ routeTree, context: { queryClient } });

  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

declare module "@tanstack/react-router" {
  interface Register { router: ReturnType<typeof createRouter>; }
}

void start();
```

- [ ] **Step 3: Surface the user id on the welcome screen for the smoke test**

Modify `apps/web/src/routes/index.tsx` — append a paragraph using stored user id:

Replace its contents with:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { getStoredUser } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: WelcomeScreen,
});

function WelcomeScreen() {
  const user = getStoredUser();
  return (
    <main className="min-h-dvh bg-paper px-6 py-12 flex items-center justify-center">
      <Card tone="paper" elevation="float" padding="lush" className="max-w-md w-full text-center relative">
        <span aria-hidden className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-peach opacity-50" />
        <span aria-hidden className="absolute -top-2 -right-3 h-12 w-12 rounded-full bg-mint opacity-60" />
        <div className="relative">
          <Eyebrow>welcome to paper</Eyebrow>
          <Heading level="display" className="mt-3">
            Learn crypto with $10,000 of practice cash.
          </Heading>
          <p className="mt-4 text-ink-soft">
            No real money. Pastel lessons. A daily question. A streak you'll want to keep.
          </p>
          {user && (
            <p data-testid="user-id" className="mt-3 text-xs text-muted">
              session: {user.id.slice(0, 8)}…
            </p>
          )}
          <Button trailing="→" fullWidth className="mt-8">
            Get started
          </Button>
        </div>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Smoke check end-to-end (server + web)**

Terminal 1: `pnpm dev:infra && pnpm --filter @paper/server db:migrate && pnpm --filter @paper/server dev`
Terminal 2: `pnpm --filter @paper/web dev`

Open http://localhost:5173. Open browser devtools → Application → Local Storage. Expect three keys: `paper.device_uuid`, `paper.refresh_token`, `paper.user`. The screen should show `session: <8 hex chars>…`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): bootstrap device-UUID auth on app start"
```

---

### Task 18: Add `vite-plugin-pwa` (manifest + service worker, network-first API)

**Files:**
- Modify: `apps/web/vite.config.ts`, `apps/web/src/main.tsx`

- [ ] **Step 1: Update `apps/web/vite.config.ts`**

Replace its contents with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      devOptions: { enabled: true, type: "module" },
      manifest: {
        name: "paper",
        short_name: "paper",
        description: "Learn crypto with $10,000 of practice cash.",
        theme_color: "#FAFAF1",
        background_color: "#FAFAF1",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/v1\/(auth|portfolio|me|leaderboard|lessons)/.test(url.pathname) && !url.pathname.includes("/auth/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-read",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "image" || request.destination === "font",
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts", expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 } },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { port: 5173 },
});
```

- [ ] **Step 2: Smoke-build the PWA bundle**

Run: `pnpm --filter @paper/web build`
Expected: writes `apps/web/dist/` containing `index.html`, hashed JS/CSS bundles, `manifest.webmanifest`, and `sw.js` / `workbox-*.js`. The build log shows the precache list.

- [ ] **Step 3: Preview the built PWA**

Run: `pnpm --filter @paper/web preview`
Open http://localhost:4173 in Chrome. Devtools → Application → Service Workers shows `sw.js` activated. Devtools → Application → Manifest shows the manifest fields. Stop server.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): add vite-plugin-pwa with manifest and Workbox runtime caching"
```

---

### Task 19: Playwright smoke E2E

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Install Playwright browsers (once per machine)**

Run: `pnpm --filter @paper/web exec playwright install chromium`

- [ ] **Step 2: Create `apps/web/playwright.config.ts`**

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 }, // iPhone 14 portrait
    deviceScaleFactor: 3,
  },
  projects: [{ name: "chromium-mobile", use: { ...devices["iPhone 14"] } }],
  webServer: [
    {
      command: "pnpm --filter @paper/server dev",
      url: "http://localhost:3000/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @paper/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
```

- [ ] **Step 3: Create `apps/web/tests/e2e/smoke.spec.ts`**

```typescript
import { expect, test } from "@playwright/test";

test("first load creates a device session and renders welcome", async ({ page, context }) => {
  await page.goto("/");
  // welcome copy is visible
  await expect(page.getByText(/Learn crypto with \$10,000/i)).toBeVisible();
  // session indicator appears (8-char prefix + ellipsis)
  await expect(page.getByTestId("user-id")).toContainText(/session:/);

  // localStorage has the three auth keys
  const ls = await page.evaluate(() => ({
    device: localStorage.getItem("paper.device_uuid"),
    refresh: localStorage.getItem("paper.refresh_token"),
    user: localStorage.getItem("paper.user"),
  }));
  expect(ls.device).toMatch(/^[0-9a-f-]{36}$/);
  expect(ls.refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(ls.user).toContain("\"id\":");
});

test("second load reuses the existing session (refresh path)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("user-id")).toBeVisible();
  const firstId = await page.getByTestId("user-id").textContent();

  await page.reload();
  await expect(page.getByTestId("user-id")).toBeVisible();
  const secondId = await page.getByTestId("user-id").textContent();

  expect(secondId).toBe(firstId);
});
```

- [ ] **Step 4: Run E2E**

Ensure local infra is up and migrations applied: `pnpm dev:infra && pnpm db:migrate`.

Run: `pnpm --filter @paper/web test:e2e`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "test(web): add Playwright smoke for device-UUID auth roundtrip"
```

---

### Task 20: Build a multi-stage ARM64 Dockerfile for the server

**Files:**
- Create: `apps/server/Dockerfile`, `apps/server/.dockerignore`

- [ ] **Step 1: Create `apps/server/.dockerignore`**

```
node_modules
dist
test
tests
*.test.ts
*.md
.env
.env.*
!.env.example
```

- [ ] **Step 2: Create `apps/server/Dockerfile`**

```dockerfile
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
```

- [ ] **Step 3: Local build (validates the Dockerfile end-to-end)**

Run: `podman build --platform=linux/arm64 -t ghcr.io/$GHCR_USER/paper:dev -f apps/server/Dockerfile .`
Expected: a successful build. The resulting image is ~150–200 MB.

- [ ] **Step 4: Smoke-run the container locally against the local Postgres**

```bash
podman run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://app:app@host.containers.internal:5432/paper \
  -e REDIS_URL=redis://host.containers.internal:6379 \
  -e JWT_SECRET=dev-only-change-me-to-a-64-byte-hex-string-in-prod-please-rotate \
  -e LOG_LEVEL=info \
  ghcr.io/$GHCR_USER/paper:dev
```

In another terminal: `curl -sS http://localhost:3000/v1/health`
Expected: `{"status":"ok"}`. Stop container.

- [ ] **Step 5: Commit**

```bash
git add apps/server/Dockerfile apps/server/.dockerignore
git commit -m "build(server): multi-stage ARM64 Dockerfile"
```

---

### Task 21: Create the `lab/stacks/paper/` Terragrunt skeleton

**Files (in the sibling `lab` repo):**
- Create: `lab/stacks/paper/terragrunt.hcl`, `lab/stacks/paper/main.tf`, `lab/stacks/paper/manifests/00-redis.yaml`, `…/10-migrate-job.yaml`, `…/20-paper-api-deployment.yaml`, `…/21-paper-api-service.yaml`, `…/22-paper-api-ingressroute.yaml`

**Note:** All edits in this task are inside `/Users/filipkastovsky/work/personal/lab`.

- [ ] **Step 1: Scaffold the directory and Terragrunt entrypoint**

```bash
cd /Users/filipkastovsky/work/personal/lab
mkdir -p stacks/paper/manifests
```

Create `stacks/paper/terragrunt.hcl`:

```hcl
include "root" {
  path = find_in_parent_folders("root.hcl")
}

dependency "cnpg" {
  config_path = "../cloudnative-pg"
  mock_outputs = { connection_string = "mock" }
}
```

- [ ] **Step 2: Create `stacks/paper/main.tf`** (mirrors `stacks/sure/main.tf` pattern)

```hcl
terraform {
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = ">= 2.0.0" }
    random     = { source = "hashicorp/random", version = ">= 3.0.0" }
  }
}

provider "kubernetes" {
  config_path = "../../lab_kubeconfig.yaml"
}

variable "image_tag" {
  type        = string
  description = "Image tag (git sha) for ghcr.io/<user>/paper"
  default     = "dev"
}

variable "ghcr_user" {
  type        = string
  description = "GitHub username/org owning the paper image"
}

resource "kubernetes_namespace" "paper" {
  metadata { name = "paper" }
}

# Request a dedicated Postgres database in the shared CNPG cluster
resource "kubernetes_manifest" "paper_db" {
  manifest = {
    "apiVersion" = "postgresql.cnpg.io/v1"
    "kind"       = "Database"
    "metadata"   = { "name" = "paper", "namespace" = "cnpg-system" }
    "spec"       = {
      "name"    = "paper"
      "owner"   = "paper"
      "cluster" = { "name" = "main" }
    }
  }
}

# CNPG creates `paper-db-password` in cnpg-system; mirror it into the paper namespace.
data "kubernetes_secret" "paper_db_secret" {
  metadata { name = "paper-db-password", namespace = "cnpg-system" }
  depends_on = [kubernetes_manifest.paper_db]
}

resource "kubernetes_secret" "paper_db_password_local" {
  metadata { name = "paper-db-password", namespace = kubernetes_namespace.paper.metadata[0].name }
  data = { password = data.kubernetes_secret.paper_db_secret.data.password }
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "kubernetes_secret" "paper_app" {
  metadata { name = "paper-app", namespace = kubernetes_namespace.paper.metadata[0].name }
  data = {
    JWT_SECRET     = random_password.jwt.result
    REDIS_PASSWORD = random_password.redis.result
  }
}

# Apply manifests, with templated values
resource "kubernetes_manifest" "paper_manifests" {
  for_each = fileset(path.module, "manifests/*.yaml")
  manifest = yamldecode(templatefile("${path.module}/${each.value}", {
    image       = "ghcr.io/${var.ghcr_user}/paper:${var.image_tag}"
    redis_pwd   = random_password.redis.result
  }))

  depends_on = [
    kubernetes_secret.paper_app,
    kubernetes_secret.paper_db_password_local,
  ]
}
```

- [ ] **Step 3: Create `stacks/paper/manifests/00-redis.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: paper-redis
  namespace: paper
spec:
  replicas: 1
  selector: { matchLabels: { app: paper-redis } }
  template:
    metadata: { labels: { app: paper-redis } }
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          args: ["--save", "", "--appendonly", "no", "--requirepass", "${redis_pwd}"]
          ports: [{ containerPort: 6379 }]
          resources:
            requests: { cpu: "20m", memory: "64Mi" }
            limits:   { cpu: "200m", memory: "128Mi" }
---
apiVersion: v1
kind: Service
metadata:
  name: paper-redis
  namespace: paper
spec:
  selector: { app: paper-redis }
  ports: [{ port: 6379, targetPort: 6379 }]
```

- [ ] **Step 4: Create `stacks/paper/manifests/10-migrate-job.yaml`**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: paper-migrate
  namespace: paper
  annotations:
    # Force re-creation on every apply via image-tag change handled by terragrunt
    "paper.fk.cz/migrate-tag": "${image}"
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ${image}
          command: ["node", "apps/server/dist/migrate.js"]
          env:
            - name: NODE_ENV
              value: production
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: { name: paper-db-password, key: password }
            - name: REDIS_URL
              value: redis://:${redis_pwd}@paper-redis.paper.svc.cluster.local:6379
            - name: JWT_SECRET
              valueFrom: { secretKeyRef: { name: paper-app, key: JWT_SECRET } }
          # Construct a full DSN from the password secret + known cluster service
          # Hint: a future ADR may move this to a fully-qualified DATABASE_URL secret.
```

(Note: in v0 we hand-build the DSN; the migrate script reads `DATABASE_URL` and only the password is in the secret. Patch this shortcut by either (a) writing a small init-container that exports `DATABASE_URL=postgres://paper:<password>@main-rw.cnpg-system.svc.cluster.local:5432/paper`, or (b) putting the full DSN in the secret. Use approach (b) — update Terraform Step 2's `kubernetes_secret.paper_db_password_local` to also store a `dsn` field built from the password and the known service hostname.)

Update `kubernetes_secret.paper_db_password_local` in `main.tf`:

```hcl
resource "kubernetes_secret" "paper_db_password_local" {
  metadata { name = "paper-db-password", namespace = kubernetes_namespace.paper.metadata[0].name }
  data = {
    password = data.kubernetes_secret.paper_db_secret.data.password
    dsn      = "postgres://paper:${data.kubernetes_secret.paper_db_secret.data.password}@main-rw.cnpg-system.svc.cluster.local:5432/paper"
  }
}
```

And update `10-migrate-job.yaml` env block to use `DATABASE_URL` from `paper-db-password.dsn`:

```yaml
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: { name: paper-db-password, key: dsn }
```

- [ ] **Step 5: Create `stacks/paper/manifests/20-paper-api-deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: paper-api
  namespace: paper
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
    prometheus.io/path: "/metrics"
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  selector: { matchLabels: { app: paper-api } }
  template:
    metadata:
      labels: { app: paper-api }
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: paper-api
          image: ${image}
          ports: [{ containerPort: 3000 }]
          env:
            - name: NODE_ENV
              value: production
            - name: HOST
              value: 0.0.0.0
            - name: PORT
              value: "3000"
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: paper-db-password, key: dsn } }
            - name: REDIS_URL
              value: redis://:${redis_pwd}@paper-redis.paper.svc.cluster.local:6379
            - name: JWT_SECRET
              valueFrom: { secretKeyRef: { name: paper-app, key: JWT_SECRET } }
            - name: LOG_LEVEL
              value: info
            - name: OTEL_SERVICE_NAME
              value: paper-api
            # OTel + Loki/Tempo wired via cluster-level Grafana Alloy in a follow-up step
          readinessProbe:
            httpGet: { path: /v1/health, port: 3000 }
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /v1/health, port: 3000 }
            initialDelaySeconds: 10
            periodSeconds: 15
          resources:
            requests: { cpu: "100m", memory: "200Mi" }
            limits:   { cpu: "1000m", memory: "512Mi" }
```

- [ ] **Step 6: Create `stacks/paper/manifests/21-paper-api-service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: paper-api
  namespace: paper
  labels: { app: paper-api }
spec:
  selector: { app: paper-api }
  ports: [{ name: http, port: 80, targetPort: 3000 }]
```

- [ ] **Step 7: Create `stacks/paper/manifests/22-paper-api-ingressroute.yaml`**

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: paper-api
  namespace: paper
spec:
  entryPoints: [websecure]
  routes:
    - match: Host(`api.paper.lab.filipkastovsky.cz`)
      kind: Rule
      services:
        - name: paper-api
          port: 80
  tls:
    certResolver: letsencrypt
```

- [ ] **Step 8: (DNS) Confirm DNS records**

In the Cloudflare dashboard, ensure two A records exist, both orange-cloud proxied, both pointing at the cluster ingress IP (the Hetzner KlipperLB external IP from `kubectl get svc -A | grep LoadBalancer`):

- `paper.lab.filipkastovsky.cz` (for the Pages site — Task 23 sets this up; Pages handles its own routing)
- `api.paper.lab.filipkastovsky.cz` (for this IngressRoute)

For Pages, replace the proxied A record with a CNAME to `paper-web.pages.dev` once the Pages project exists (Task 23).

- [ ] **Step 9: Commit (in the lab repo)**

```bash
cd /Users/filipkastovsky/work/personal/lab
git add stacks/paper README.md
git commit -m "feat(paper): scaffold Terragrunt stack for paper app (api, redis, migrate job)"
```

(Update `lab/README.md` separately to list `stacks/paper` per the lab repo's pattern.)

---

### Task 22: First production deploy — push image, terragrunt apply, smoke

**No new files in this task; commands only.**

- [ ] **Step 1: Tag the image with the current git sha and push**

From the `paper` repo:

```bash
SHA=$(git rev-parse --short=12 HEAD)
podman build --platform=linux/arm64 -t ghcr.io/$GHCR_USER/paper:$SHA -f apps/server/Dockerfile .
podman push ghcr.io/$GHCR_USER/paper:$SHA
```

- [ ] **Step 2: Apply the Terragrunt stack with the new tag**

```bash
cd /Users/filipkastovsky/work/personal/lab
source .env  # exposes provider tokens
TF_VAR_image_tag=$SHA TF_VAR_ghcr_user=$GHCR_USER terragrunt apply -auto-approve --terragrunt-working-dir stacks/paper
```

Expected: applies namespace, CNPG Database, secrets, redis Deployment+Service, migrate Job, paper-api Deployment+Service+IngressRoute. Watch with `kubectl --kubeconfig=lab_kubeconfig.yaml -n paper get pods -w`.

- [ ] **Step 3: Wait for the migrate Job to complete**

```bash
kubectl --kubeconfig=lab_kubeconfig.yaml -n paper wait --for=condition=complete job/paper-migrate --timeout=120s
```

If the Job fails, inspect: `kubectl logs -n paper job/paper-migrate`.

- [ ] **Step 4: Wait for the API Deployment to be Available**

```bash
kubectl --kubeconfig=lab_kubeconfig.yaml -n paper rollout status deployment/paper-api --timeout=120s
```

- [ ] **Step 5: Smoke-test the deployed API**

```bash
curl -sS https://api.paper.lab.filipkastovsky.cz/v1/health
```

Expected: `{"status":"ok"}` (or, on a fresh DNS/Cloudflare cache, `{"status":"ok"}` after a 30–60s propagation).

```bash
curl -sS -X POST https://api.paper.lab.filipkastovsky.cz/v1/auth/device \
  -H "content-type: application/json" \
  -d '{"device_uuid":"00000000-0000-0000-0000-000000000099"}'
```

Expected: a JSON body with `access_token`, `refresh_token`, `user.id`.

- [ ] **Step 6: Commit (no source change; deploy is recorded in lab repo state)**

If `lab` repo has unstaged changes (e.g., terraform.tfstate), follow the lab repo's existing commit conventions.

---

### Task 23: Deploy the PWA to Cloudflare Pages

**No new files; configuration + commands only.**

- [ ] **Step 1: Create a `.env.production` for the build**

Create `apps/web/.env.production`:

```dotenv
VITE_API_BASE=https://api.paper.lab.filipkastovsky.cz
VITE_POSTHOG_API_KEY=<your posthog project key>
VITE_POSTHOG_HOST=https://eu.posthog.com
```

(Add `apps/web/.env.production` to `.gitignore` if you don't want the PostHog key checked in. Recommend `.env.production` committed with placeholders only and the real key supplied at build time via shell env.)

- [ ] **Step 2: Build the production bundle**

```bash
pnpm --filter @paper/web build
```

Expected: `apps/web/dist/` populated, including `manifest.webmanifest` and `sw.js`.

- [ ] **Step 3: Deploy to Cloudflare Pages**

```bash
pnpm --filter @paper/web exec wrangler pages deploy dist --project-name=paper-web --branch=main
```

Expected: a deploy URL like `https://<hash>.paper-web.pages.dev` and a custom-domain hint.

- [ ] **Step 4: Bind the custom domain**

In the Cloudflare dashboard → Pages → `paper-web` → Custom domains → add `paper.lab.filipkastovsky.cz`. Cloudflare automatically creates the CNAME and issues TLS.

- [ ] **Step 5: End-to-end production smoke**

Open `https://paper.lab.filipkastovsky.cz` in mobile Safari (or desktop Chrome with iPhone emulation). Expected:
- Welcome screen renders
- A `paper.device_uuid` appears in localStorage
- Network tab shows POST to `https://api.paper.lab.filipkastovsky.cz/v1/auth/device` returning 200
- Devtools → Application → Manifest shows the PWA installable
- "Add to Home Screen" works

- [ ] **Step 6: Verify observability lit up**

In Grafana Cloud:
- **Loki** — query `{app="paper-api"}`. Expect pino JSON lines including the request log of the smoke `/v1/auth/device` call.
- **Tempo** — search service `paper-api`, look for the recent `POST /v1/auth/device` trace with DB span(s).
- **Prometheus** — query `up{namespace="paper"}` and `http_request_duration_seconds_count{service="paper-api"}`.

If logs aren't flowing, the cluster's `grafana-monitoring` Alloy/promtail config might need a label selector for `namespace=paper`. Check `lab/stacks/grafana-monitoring` and add the namespace if necessary — captured as a follow-up if not in scope today.

- [ ] **Step 7: Final smoke commit (if any config tweaks)**

If you adjusted `.env.production` or any config in this task, commit:

```bash
git add apps/web/.env.production .gitignore
git commit -m "chore(web): wire production env for Cloudflare Pages deploy"
```

Plan 1 complete. Tag the milestone:

```bash
git tag -a v0.1.0-foundation -m "v0 foundation deployable"
```

---

## Self-Review Notes (recorded against the spec)

This is the writing-plans skill's self-review pass against the spec coverage list. The plan covers ONLY the foundation — domain features (Dashboard, Trade, Learn, Ranks, Profile) and crons are intentionally out of scope per the user-approved decomposition.

**Spec coverage delivered by Plan 1:**

- §11.2 client (PWA + service worker + IndexedDB-via-Workbox cache) — covered Tasks 14, 16, 17, 18.
- §11.3 API layer (server-authoritative, JWT + refresh, Zod validation) — covered Tasks 5–11.
- §11.4 deployment (monorepo + always-on Node + managed Postgres + Redis + blob) — covered Tasks 1–4, 13, 20–23.
- §11.6 security posture: JWT, refresh-token rotation with family revocation, rate-limit infra wired (per-route limits added in later plans).
- §6.1 onboarding step 1 (welcome screen) — minimal version covered Task 14, 17.
- §9 events: skeleton wiring for PostHog covered Task 16; full taxonomy added in Plan 8 polish.
- ADR 0006 §2.10 testing: Vitest server tests + Playwright E2E covered (MSW handlers exist via Kubb but unused until Plan 2 adds web component tests).

**Spec coverage explicitly deferred (with the plan number that owns it):**

- Onboarding steps 2–4 (handle pick, balance reveal, first lesson nudge) → Plan 2.
- Portfolio domain, asset list, Binance ingestion, Dashboard hero card → Plan 2.
- All five domain features (Dashboard, Trade, Learn, Ranks, Profile) → Plans 2–7.
- 5× CronJob and the daily-question/leaderboard/streak-reaper logic → Plans 2, 5, 6.
- Share-card Canvas renderer → Plan 7.
- Web Push (VAPID, subscription, send) → Plan 5.
- R2 storage usage (only the bucket exists in Plan 1; no read/write yet) → Plan 7.
- Authentik middleware on `/docs` and `/admin` → Plan 8 polish.
- Full PostHog event taxonomy from spec §9 → Plan 8 polish.
- Grafana dashboards (per-domain) → Plan 8 polish.

**Placeholder scan:** none. Every step has actual code or actual commands. The Cloudflare DNS record creation (P5) and the Cloudflare R2 bucket creation (P7) are gated as prerequisites rather than tasks because they're dashboard-clicks; they're enumerated explicitly in the Prerequisites table.

**Type consistency check:**

- `mintAccessToken` / `verifyAccessToken` / `mintRefreshToken` / `hashRefreshToken` — same names in `tokens.ts`, tests, and consumer code. ✓
- `setAccessToken` exported from `packages/api-client/http-client.ts` and re-exported from the package barrel; consumed by `apps/web/src/lib/auth.ts`. ✓
- `bootstrapAuth` / `getStoredUser` exports from `auth.ts` consumed by `main.tsx` and `routes/index.tsx`. ✓
- `paper-db-password` secret has both `password` and `dsn` keys (Step 4 of Task 21 fixed this); `DATABASE_URL` env consistently sourced from `paper-db-password.dsn`. ✓
- `paper-app` secret holds `JWT_SECRET` and `REDIS_PASSWORD`; `REDIS_PASSWORD` is composed into `REDIS_URL` env value at deploy-time via templatefile substitution. ✓

**Architecture spot-checks:**

- Drizzle migration is run by a separate Job in production, not at app startup — matches ADR 0006 §3.9 of ADR 0009 and avoids each replica racing to migrate.
- Server-authoritative pricing isn't exercised yet (no trade endpoint in Plan 1), but the auth + db + Redis foundation is in place for Plan 3 to build on.
- Plan 1 deploys with 1 replica only. Multi-replica + horizontal scaling is intentionally out of scope; the rate-limit Redis store and the leader-elected crons (Plans 2, 5, 6) make multi-replica safe when needed.
- Hand-written `http-client.ts` lives outside `packages/api-client/src/` so Kubb's `clean: true` doesn't wipe it — addressed in Task 13 Step 6.

**Ambiguity check:**

- Task 13 generated `src/` is committed to git. The `.gitignore` rule excluding `packages/api-client/src/` is removed at the end of Task 13 — Step 11 explicitly notes this. ✓
- The OpenAPI dump script (Task 13 Step 1) does not require Postgres at runtime because Drizzle's lazy connection pool is not exercised before `app.swagger()` is read. The script connects to Postgres only because `makeDb` is called; if Postgres is unreachable, the connection attempt errors after the swagger spec is already in memory. To remove this dependency entirely, the script can be refactored to skip `makeDb` and pass a stub Db — accepted simplification deferred until it bites.

If any of the deferred items in the "Spec coverage explicitly deferred" list block your review, raise them now and I'll adjust the decomposition.
