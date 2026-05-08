# ADR 0007 — Monorepo internal layout

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-07 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | CTO agent (Claude) |
| **Audience** | Implementation engineer |
| **Companion** | ADR 0006 (server stack), product spec §11.4 |

---

## TL;DR

**pnpm workspaces** with two app packages and two library packages:

```
paper/
├── apps/
│   ├── web/         # Vite + React PWA (ADR 0002, 0003)
│   └── server/      # Fastify + Drizzle + cron jobs (ADR 0006)
├── packages/
│   ├── shared/      # Zod schemas, event constants, shared types
│   └── api-client/  # Kubb-generated typed client + RQ hooks
├── biome.json
├── lefthook.yml
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

K8s manifests + Terragrunt stack live in the **separate `lab` repo** at `lab/stacks/paper/`, not in this monorepo.

## Context

The product spec §11.4 prescribes pnpm workspaces with `client / server / shared` packages. ADR 0006 introduces the Kubb-generated client SDK as a fourth concern. ADR 0009 (infra) keeps cluster manifests in the existing `lab` repo.

The internal layout, name conventions, and lockfile policy were left open.

## Decision

### Top-level

```
paper/
├── apps/                    # deployable applications
├── packages/                # internal libraries
├── docs/                    # specs, ADRs, design system
├── docker-compose.yml       # local dev infra (postgres, redis, minio)
├── biome.json               # ADR 0008
├── lefthook.yml             # ADR 0008
├── tsconfig.base.json       # shared compiler options
├── pnpm-workspace.yaml      # workspace declaration
├── package.json             # root scripts
└── README.md
```

### `apps/web/`

The Vite + React PWA. Key subdirectories:

```
apps/web/
├── public/
│   └── icons/                  # PWA icons
├── src/
│   ├── main.tsx                # entry, SW register
│   ├── routes/                 # TanStack Router file-based routes
│   ├── components/
│   │   ├── ui/                 # primitives (Marshmallow + Radix wrappers)
│   │   └── feature/            # domain components per tab
│   ├── stores/                 # Zustand stores (ADR 0005)
│   ├── lib/
│   │   ├── cn.ts               # clsx + tailwind-merge
│   │   ├── format.ts           # Intl USD/pct/qty formatters (already shipped in docs/design/react/)
│   │   ├── query-client.ts     # TanStack Query defaults
│   │   └── posthog.ts          # PostHog client init
│   └── styles/
│       ├── tokens.css          # symlink-or-copy of docs/design/tokens.css
│       └── globals.css         # Tailwind v4 entry, @theme inline (per ADR 0001)
├── index.html
├── vite.config.ts              # plugins: react, tailwindcss, vite-plugin-pwa
├── tsconfig.json
└── package.json
```

The Marshmallow primitives shipped in `docs/design/react/components/` are copied into `apps/web/src/components/ui/` on first scaffold and become live source. `docs/design/react/` remains the canonical reference.

### `apps/server/`

The Fastify API + cron job entrypoints.

```
apps/server/
├── src/
│   ├── index.ts                # Fastify boot
│   ├── plugins/                # @fastify/* registrations
│   │   ├── auth.ts             # @fastify/jwt
│   │   ├── otel.ts             # @fastify/otel
│   │   ├── rate-limit.ts       # @fastify/rate-limit
│   │   └── swagger.ts          # @fastify/swagger + UI
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── portfolio.ts
│   │   ├── trades.ts
│   │   ├── lessons.ts
│   │   ├── predictions.ts
│   │   ├── leaderboard.ts
│   │   └── …
│   ├── db/
│   │   ├── client.ts           # postgres.js + drizzle init
│   │   └── schema/
│   │       ├── users.ts
│   │       ├── portfolio.ts
│   │       ├── trades.ts
│   │       ├── lessons.ts
│   │       ├── predictions.ts
│   │       ├── streaks.ts
│   │       ├── leaderboard.ts
│   │       └── index.ts
│   ├── services/               # domain logic, framework-agnostic
│   │   ├── prices.ts           # Binance fetch + Redis cache
│   │   ├── trade-execution.ts
│   │   ├── prediction-resolution.ts
│   │   ├── leaderboard.ts
│   │   ├── streaks.ts
│   │   ├── push.ts             # web-push send
│   │   └── share-cards.ts      # payload generation, not rendering
│   └── jobs/                   # CronJob entrypoints (ADR 0006 §2.6)
│       ├── price-ingestion.ts
│       ├── daily-question-create.ts
│       ├── daily-question-resolve.ts
│       ├── leaderboard-recompute.ts
│       └── streak-reaper.ts
├── drizzle/                    # generated migration SQL
├── drizzle.config.ts
├── Dockerfile                  # multi-stage, ARM64
├── tsconfig.json
└── package.json
```

The Dockerfile produces one image used by `paper-api`, `paper-price-ticker` (none in v0 — collapsed into the cron), and all five CronJobs; only the `command` differs.

### `packages/shared/`

Pure, dependency-light TypeScript shared between `apps/web` and `apps/server`.

```
packages/shared/
├── src/
│   ├── events.ts               # event-name constants from spec §9
│   ├── types.ts                # cross-cutting types (e.g. AssetId, Side)
│   └── index.ts
├── tsconfig.json
└── package.json
```

Imported as `@paper/shared`. Built with `tsc` to `dist/`; consumers import from the workspace.

### `packages/api-client/`

Kubb-generated client artefacts. Regenerated by `pnpm gen:api-client`.

```
packages/api-client/
├── kubb.config.ts              # Kubb plugin chain
├── src/                        # GENERATED — do not hand-edit
│   ├── client.ts
│   ├── types/
│   ├── zod/
│   ├── hooks/                  # TanStack Query hooks
│   └── msw/
├── tsconfig.json
└── package.json
```

Imported as `@paper/api-client` from `apps/web` and `@paper/api-client/msw` from web tests.

### Root scripts (`package.json`)

```
{
  "scripts": {
    "dev":           "docker compose up -d && pnpm -r --parallel dev",
    "dev:web":       "pnpm --filter @paper/web dev",
    "dev:server":    "pnpm --filter @paper/server dev",
    "build":         "pnpm -r build",
    "lint":          "biome check .",
    "lint:fix":      "biome check --apply .",
    "test":          "pnpm -r test",
    "test:e2e":      "pnpm --filter @paper/web test:e2e",
    "gen:api-client":"pnpm --filter @paper/api-client gen",
    "db:generate":   "pnpm --filter @paper/server db:generate",
    "db:migrate":    "pnpm --filter @paper/server db:migrate",
    "db:studio":     "pnpm --filter @paper/server db:studio"
  }
}
```

### Naming + scope

- All packages use the **`@paper/` scope**: `@paper/web`, `@paper/server`, `@paper/shared`, `@paper/api-client`. Even though the consumer-facing brand is undecided (ADR 0009), the cluster identifier `paper` is stable.
- Workspace protocol: dependencies between workspace packages use `workspace:*`.

### Lockfile policy

- Single `pnpm-lock.yaml` at the root. Committed.
- Dependency updates via `pnpm update -r --interactive`.
- No frozen-lockfile bypass in CI.

### Path aliases

Each package has its own `tsconfig.json` with `paths`:

- `apps/web`: `@/*` → `src/*` (web-internal only)
- `apps/server`: `@/*` → `src/*` (server-internal only)
- Cross-package imports use the package name (`@paper/shared`), never relative paths across packages.

## Rationale

1. **`apps/` + `packages/` is the de facto pnpm-workspace layout in 2026.** Familiar to anyone joining; no novelty cost.
2. **Cron entrypoints under `apps/server/src/jobs/`** keeps Drizzle client + service layer reuse trivial — they're the same package, just different scripts.
3. **`@paper/api-client` as its own package** isolates Kubb-generated code from hand-written code. Regeneration is a destructive overwrite of one package's `src/` — easy to reason about.
4. **K8s manifests stay in the `lab` repo** because that's where every other personal-cluster app lives (sure, immich, vaultwarden, triage, …). The pattern is established; deviating costs more than it saves. The app monorepo only owns its Dockerfile.

## Consequences

### Positive

- New domain feature touches at most three packages: server (route + service + schema) → regenerate api-client → web (consume hook). One PR.
- Cron jobs reuse all server services with zero duplication.
- The `lab` repo continues to be the single source of truth for cluster state.

### Negative / accepted

- **`@paper/api-client` regeneration must be remembered** after server schema changes. Mitigation: a pre-commit step in `lefthook.yml` runs `gen:api-client` if any `apps/server/src/routes/**` file changed.
- **Web app and infra repo are coupled by image tag.** Mitigation: image tags are SHA-based; the `lab/stacks/paper/` Terragrunt stack accepts the tag as a TF variable, so a deploy is a one-line update + apply.

## Alternatives considered

### A. Spec's literal `client / server / shared` (no `apps/` / `packages/` prefix)
**Rejected.** Conflates apps with libraries; non-standard in modern pnpm-workspace projects.

### B. Single-package monolith (no workspaces)
**Rejected.** Spec mandates pnpm workspaces (§11.4), and Kubb-generated client benefits from being its own boundary.

### C. Turborepo / Nx orchestration
**Rejected for v0.** pnpm's `-r` and `--filter` cover all current task-running needs. Adding Turborepo is justified when build caching becomes a bottleneck (>30s cold builds); not the case at v0 size.

### D. Cron jobs as a separate `apps/worker/` package
**Rejected.** Crons reuse 100% of server's domain code. Splitting them into a different package forces either circular deps or duplicated code. Same package, different entrypoints is cleanest.

### E. Cluster manifests in this monorepo
**Rejected.** Breaks the `lab` repo's pattern, splits cluster state across two repos, complicates `terragrunt run-all`.

## References

- Product spec §11.4
- ADR 0006 (server stack)
- ADR 0009 (infrastructure)
- pnpm workspaces: https://pnpm.io/workspaces
