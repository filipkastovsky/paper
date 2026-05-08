# v0 Stack Decisions

**Status:** Approved via brainstorming, ready for implementation planning.
**Date:** 2026-05-07
**Author:** Filip Kaštovský (founder) + Claude (CTO agent)
**Supersedes (in part):** product spec §11 "Architecture" — the topology sketch is preserved, but specific framework / vendor choices are now locked here.
**Companion ADRs:** `docs/decisions/0002` through `docs/decisions/0009`.

---

## 1. Why this document exists

The product spec (`2026-04-23-neo-fintech-minimalist-exchange-design.md`) deliberately left tech-stack choices open (§18). ADR 0001 then locked the **frontend styling layer** (Tailwind v4 + cva + Marshmallow tokens) but left framework, server, infra, and operational tooling open. This spec closes those gaps.

It is a single index over eight numbered ADRs. Each ADR is the canonical, full-rationale record. This document is the at-a-glance map.

## 2. The shape, in one diagram

```
                        [ Cloudflare DNS — orange-cloud proxied ]
                                       │
              ┌────────────────────────┴────────────────────────┐
              │                                                  │
      [ Cloudflare Pages ]                              [ Hetzner k3s — fsn1 ]
       PWA static shell                                   (existing personal cluster)
       Vite + React build                                 ─ Traefik ingress + cert-manager
       global edge CDN                                    ─ namespace `paper`:
                                                            ├─ paper-api Deployment
                                                            ├─ paper-redis Deployment (per-app Bitnami)
                                                            ├─ migrate Job (drizzle-kit on each deploy)
                                                            └─ 5× CronJob: price-ingestion (every 1m), daily-question-resolve + create (00:00 UTC), leaderboard-recompute (every 5m), streak-reaper (hourly)
                                                          ─ namespace `cnpg-system`:
                                                            └─ Database "paper" in shared `main` CNPG cluster
                                                          ─ Grafana Cloud (existing):
                                                            ├─ pino logs → Loki
                                                            ├─ OTel traces → Tempo
                                                            └─ /metrics → Prometheus
              │
       [ Cloudflare R2 ]
        share-card PNGs
        zero egress on hotlinks
```

The product spec's §11.1 topology is unchanged; the §11.4 deployment notes (always-on Node/Bun, managed Postgres, Redis cache, blob store) are realised on the existing Hetzner cluster instead of a managed-PaaS shape.

## 3. The locked choices

| Layer | Choice | ADR |
|---|---|---|
| Frontend styling | Tailwind v4 + `class-variance-authority` + `clsx` + `tailwind-merge` + Marshmallow tokens | **0001** (existing) |
| Frontend build | Vite 5 + `@vitejs/plugin-react` + `@tailwindcss/vite` | **0002** |
| PWA service worker | `vite-plugin-pwa` (Workbox), auto-update mode, network-first API caching | **0003** |
| Headless primitives | Radix UI à la carte: Dialog, Tabs, Popover, Toast, Slider | **0004** |
| State management | TanStack Query (server state) + Zustand (UI state) | **0005** |
| Server runtime | Node 22 LTS | **0006** |
| Server framework | Fastify 5 + `fastify-type-provider-zod` + Zod 4 | **0006** |
| OpenAPI | `@fastify/swagger` + `@fastify/swagger-ui`, schema-first via Zod | **0006** |
| Logging | `pino` (structured) → Loki via Grafana Cloud | **0006** |
| Tracing | `@fastify/otel` → Tempo via Grafana Cloud | **0006** |
| Metrics | `fastify-metrics` → Prometheus via Grafana Cloud | **0006** |
| ORM | Drizzle + drizzle-kit | **0006** |
| Client API SDK | Kubb (codegen from OpenAPI → typed client + TanStack Query hooks + Zod + MSW) | **0006** |
| Auth (end-users) | Custom `@fastify/jwt` device-UUID flow, refresh-token rotation | **0006** |
| Auth (admin, future) | Authentik via Traefik middleware (`authentik@kubernetescrd`) | **0006** / **0009** |
| Crons | 5× native K8s CronJob, all at 1-minute (or coarser) granularity — see ADR 0006 §2.6 for schedules | **0006** / **0009** |
| Background jobs | None for v0 (deferred; pg-boss reconsidered at v0.1 if non-cron jobs appear) | **0006** |
| Monorepo | pnpm workspaces, `apps/web` + `apps/server` + `packages/shared` + `packages/api-client` | **0007** |
| Linter / formatter | Biome (single tool) + lefthook pre-commit | **0008** |
| Cluster | Hetzner k3s (existing `lab` cluster, fsn1) — 3× cax21, Cilium, Longhorn, Traefik, cert-manager | **0009** |
| Postgres | CloudNativePG `Database` in shared `main` cluster, dedicated user/secret per app | **0009** |
| Redis | Per-app Bitnami Helm chart in `paper` namespace, cache-only | **0009** |
| Edge static + CDN | Cloudflare Pages | **0009** |
| Blob storage | Cloudflare R2 (zero egress; share-card hotlinks) | **0009** |
| DNS | Cloudflare-proxied A record → cluster ingress | **0009** |
| Container registry | GHCR (default; finalised when CI lands) | **0009** |
| CI/CD | Local `kubectl set image` from laptop in v0 → GitHub Actions push-style when team grows | **0009** |
| Image build | Multi-stage Dockerfile, ARM64 (cluster is ARM); same image for `paper-api` and all 5 CronJobs (different `CMD`) | **0009** |
| Local dev | docker-compose with `postgres:16`, `redis:7`, `minio/minio` | **0009** |
| Domain | `paper.lab.filipkastovsky.cz` for v0 stealth; public domain decided week 8 | **0009** |
| Testing | Vitest (unit/integration) + Playwright (E2E) + MSW (Kubb-generated handlers) | **0006** |
| Analytics + session replay + frontend errors | PostHog (single SDK) | **0006** |
| Server errors | Pino structured logs → Loki + OTel exception spans → Tempo | **0006** |
| Push notifications | `web-push` library + VAPID (PWA), inline send for v0 (no queue) | **0006** |

## 4. Amendments to the product spec

The product spec is otherwise unchanged. These small adjustments are made here so that implementation matches operational reality of the chosen platform.

### 4.1 Price ingestion frequency (spec §11.1)

> **Original:** `price_ingestion_cron — every 30s`
> **Amended:** `price_ingestion_cron — every 60s` (i.e. `* * * * *`)

**Why:** native K8s CronJob has a 1-minute minimum granularity. A 60s freshness on cached spot prices is invisible to the paper-trading user (no candlesticks, no order book — see spec §4 non-goals). The 30s figure was a sketch, not a constraint. Server-authoritative pricing integrity (spec §11.6) is preserved.

### 4.2 Server-authoritative trade execution timing

The amendment to 60s implies trades may execute at most-recent-minute prices rather than most-recent-30s prices. The leaderboard integrity argument (server prices trades, clients can't spoof) still holds at any cache TTL. No further action required.

## 5. What stays open (decided at implementation time, not now)

These are intentionally not pinned in this document — they're cheap to choose during implementation and irrelevant to the architecture:

- **Specific Drizzle schema layout** — single `schema.ts` vs. per-domain files. Decide when the first table is written.
- **Exact Zustand store granularity** — one big store vs. per-domain stores. Decide when the second store is needed.
- **CronJob image tagging strategy on first deploy** — `latest`, `sha-<git-sha>`, semver. Push-style deploys make this easy to revisit.
- **Public-launch domain** — punted to week 8 per the product spec timeline.
- **GHCR vs alternative registry** — punted; GHCR is the default fallback.

## 6. References

- Product spec: `docs/superpowers/specs/2026-04-23-neo-fintech-minimalist-exchange-design.md`
- Marshmallow design system: `docs/design/design-system.md`, `docs/design/tokens.css`, `docs/design/react/`
- ADR index: `docs/decisions/0001` through `0009`
- Cluster IaC repo: `../lab` (sibling to this repo) — `lab/stacks/paper/` will be added during implementation
