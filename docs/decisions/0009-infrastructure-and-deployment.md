# ADR 0009 — Infrastructure & deployment

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-07 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | CTO agent (Claude) |
| **Audience** | Implementation engineer + cluster operator (Filip) |
| **Companion** | ADR 0006 (server stack), product spec §11 |

---

## TL;DR

The v0 app deploys to **Filip's existing Hetzner k3s cluster** (`lab` repo, `fsn1` region). Postgres lives in the shared **CloudNativePG** cluster (per-app DB+user). Redis is **per-app, namespaced**, deployed by the app's Terragrunt stack. Static client + edge CDN is **Cloudflare Pages**. Blob storage is **Cloudflare R2**. DNS is **Cloudflare-proxied**. Cluster manifests live in **`lab/stacks/paper/`**, mirroring the established pattern (sure, immich, etc.). Image registry is **GHCR** (default; finalised when CI lands). v0 deploys are manual `kubectl set image` from a laptop; GitHub Actions push-style is added later.

## Context

The product spec §11 sketches a topology with managed Postgres, Redis-shaped cache, blob store, and a single always-on Node process. A cluster already exists at `../lab` — Hetzner k3s, CloudNativePG, Traefik, cert-manager, Authentik, Grafana Cloud monitoring — running multiple personal apps via OpenTofu+Terragrunt stacks.

Constraints:

| # | Constraint | Source |
|---|---|---|
| 1 | TikTok install spike profile (500k installs in 48h) | Spec §11.5 |
| 2 | Server-authoritative pricing colocated with DB | Spec §11.6 |
| 3 | Mobile-first, global audience (TikTok demand) | Spec §3, §11.5 |
| 4 | Solo dev, 50% of time on content | Spec §17 |
| 5 | Cluster already paid for, mature stacks pattern | `../lab/README.md` |
| 6 | Existing Grafana Cloud observability stack | `../lab/stacks/grafana-monitoring/` |
| 7 | CNPG pattern: per-app `Database` resource → mirrored secret in app namespace | `../lab/stacks/sure/main.tf` |

## Decision

### 3.1 Cluster topology

The cluster is unchanged. The new app adds one Terragrunt stack at `lab/stacks/paper/`, following the `sure` template:

```
lab/stacks/paper/
├── main.tf                             # namespace, CNPG Database, secrets, manifests
├── terragrunt.hcl                      # depends_on: cloudnative-pg
└── manifests/
    ├── 00-redis.yaml                   # per-app Redis Deployment + Service + PVC
    ├── 10-migrate-job.yaml             # drizzle-kit migrate, runs on each deploy
    ├── 20-paper-api-deployment.yaml    # Fastify Deployment
    ├── 21-paper-api-service.yaml
    ├── 22-paper-api-ingress.yaml       # Traefik IngressRoute, cert-manager, Cloudflare-proxied
    ├── 30-cronjobs.yaml                # 5× CronJob (per ADR 0006)
    └── 40-network-policies.yaml        # cilium NetworkPolicy: paper-api → redis, → main-rw.cnpg-system
```

### 3.2 Postgres — CloudNativePG, shared `main` cluster

Following the `sure` pattern (`../lab/stacks/sure/main.tf:23-46`):

- Terraform creates a `Database` resource in the `cnpg-system` namespace with `name: paper`, `owner: paper`, `cluster: main`.
- CNPG generates the user + secret in `cnpg-system` (`paper-db-password`).
- Terraform mirrors the secret into the `paper` namespace as `paper-db-password`.
- App connects via `host=main-rw.cnpg-system.svc.cluster.local`, `db=paper`, `user=paper`, password from the mirrored secret.

`main-rw` is the read-write service; `main-ro` exists for read replicas (none in v0).

### 3.3 Redis — per-app, namespaced

Follows the `sure` pattern of a per-app Redis. Bitnami Redis Helm chart, 1 replica, no persistence required (cache + leaderboard snapshot are reproducible from Postgres + Binance). 64 MB RAM request.

The Redis password is generated via `random_password` and stored in the `paper-app` Kubernetes secret alongside other app secrets. Cilium NetworkPolicy restricts access to the `paper-api` Deployment.

Reasons not to use a shared cluster Redis: there isn't one in the cluster today, and per-app isolation matches the established pattern.

### 3.4 Edge layer — Cloudflare Pages + Cloudflare R2 + Cloudflare DNS

- **Cloudflare Pages** hosts the static PWA shell built by `pnpm --filter @paper/web build`. Atomic, immutable deploys; free tier; global edge cache. Service worker shipped with the bundle. Direct upload via `wrangler pages deploy` from laptop in v0.
- **Cloudflare R2** stores share-card PNGs (per spec §7.3). Bucket `paper-share-cards`. Zero egress; critical for TikTok hotlinks. AWS S3 SDK against `https://<account>.r2.cloudflarestorage.com`.
- **Cloudflare DNS** with **orange-cloud proxy** in front of `paper.lab.filipkastovsky.cz` (or final brand domain). Adds DDoS protection, edge rate limiting, hides cluster IP. Fall-through to the Hetzner ingress IP. Cluster's existing cert-manager + Let's Encrypt issues the origin cert; Cloudflare terminates the public-facing TLS.

Local dev mirrors via docker-compose:

- `postgres:16` for Neon/CNPG
- `redis:7` for Upstash/Bitnami Redis
- `minio/minio` for R2 (S3-compatible API; same SDK works against both)

### 3.5 Ingress + TLS

- **Traefik** is the cluster ingress controller. Use IngressRoute CRDs over plain Ingress for parity with other lab stacks.
- **cert-manager + Let's Encrypt ClusterIssuer** (existing, in `lab/stacks/cluster-tools`) issues `paper.lab.filipkastovsky.cz` cert.
- **Authentik middleware** (`authentik@kubernetescrd`) is **not** applied to the public app routes — those are end-user facing. It IS applied to:
  - Any future `/admin/*` route on the API (none in v0)
  - The Swagger UI at `/docs` and the OpenAPI JSON at `/openapi.json` in non-dev environments — administrators only
- A second Cloudflare DNS record (`docs.paper.lab.filipkastovsky.cz` or path-routed `/docs` behind Authentik) exposes the OpenAPI docs to the founder for inspection.

### 3.6 Image registry — GHCR (default)

GitHub Container Registry is the default. Public-or-private toggle: private (no benefit to public for a closed-source product).

This is a **soft commitment** — the user explicitly punted finalising it. Implementation can proceed against `localhost:5000` or directly via `kind load docker-image` until a registry is wired into CI.

### 3.7 Build + deploy

- **Multi-stage Dockerfile** in `apps/server/Dockerfile`:
  1. `node:22-alpine` base for pnpm install + build
  2. Production stage: distroless or `node:22-alpine` with only `dist/`, `node_modules` (prod only), and `package.json`
  3. ARM64 target — the cluster nodes are `cax21` (ARM). Local builds on Apple Silicon Macs are native; CI must use `--platform=linux/arm64` or a buildx ARM runner.
- **Image tag scheme:** `ghcr.io/<owner>/paper:<git-sha>`. `latest` not used in v0 — explicit SHAs only.
- **Deploy command in v0:** `kubectl --kubeconfig=lab/lab_kubeconfig.yaml -n paper set image deployment/paper-api paper-api=ghcr.io/<owner>/paper:<sha> && kubectl ... rollout status …` from a laptop. Rolled back via `kubectl rollout undo`.
- **CronJob image bumps** require the same `set image` against each CronJob's PodTemplate.

A wrapper script at `lab/stacks/paper/scripts/deploy.sh` is added during implementation to script the rollout: build → push → set image → rollout status (paper-api Deployment + 5 CronJob PodTemplates).

### 3.8 CI/CD

**v0:** none. Local builds and local deploys.

**When CI lands** (likely v0.1 or earlier if friction shows up):

- GitHub Actions workflow on push to `main`:
  1. Install pnpm + Node 22
  2. `pnpm install --frozen-lockfile`
  3. `pnpm lint && pnpm typecheck && pnpm test`
  4. `docker buildx build --platform=linux/arm64 -t ghcr.io/.../paper:<sha> --push .`
  5. `kubectl set image …` with kubeconfig from `KUBECONFIG_BASE64` GHA secret
- No GitOps tool in v0 (no Argo CD, no Flux). Reconsider when a second engineer joins or when manual deploys fail more than once.

### 3.9 Migrations

Drizzle migrations run as a Kubernetes Job (`10-migrate-job.yaml`) before the API rollout completes. Helm-style hook is not used; the Terragrunt stack applies the Job manifest manually and checks completion before declaring the rollout done.

Rollback: forward-only migrations. If a migration is bad, write a corrective forward migration. No down-migrations.

### 3.10 Backups

Postgres: handled by CNPG's existing backup configuration in `lab/stacks/cloudnative-pg` (S3-compatible target — confirm during implementation; out of scope for this app).

Redis: not backed up; data is reproducible from Postgres + Binance.

R2: bucket-level versioning enabled at creation time. Share cards are immutable per blob ID anyway.

### 3.11 Domain

- v0 stealth: `paper.lab.filipkastovsky.cz` and `api.paper.lab.filipkastovsky.cz`
- TikTok launch (week 9 per spec §13): public root domain decided by week 8, pointed via Cloudflare to the same cluster ingress and same Pages project. Zero re-deploy required to swap; only DNS + Ingress hostname update.

### 3.12 Observability — uses existing Grafana Cloud

The cluster's `lab/stacks/grafana-monitoring` stack already ships:

- Prometheus scrape via Grafana Alloy
- Loki log shipping via promtail/alloy
- Tempo traces via OTel collector

The app inherits these for free:

- `pino` JSON logs → Loki (label `app=paper`)
- OTLP traces from `@fastify/otel` → Tempo (service name `paper-api`)
- `/metrics` from `fastify-metrics` → Prometheus (Pod annotation `prometheus.io/scrape: 'true'`)

Dashboards: a starter `paper-overview` dashboard is added during implementation (request rate, p50/p95 latency, error rate, queue depth for nothing-yet, Postgres connection count, Redis ops/s).

Alerting: deferred. v0 has no PagerDuty / no on-call. Filip eyeballs Grafana when something feels off. Reconsider at v0.1 once retention shows the app deserves wake-up alerting.

### 3.13 Cost

Hetzner cluster cost is unchanged (already operating). Marginal additions:

- Cloudflare Pages: free
- Cloudflare R2: $0–$5/mo at v0 scale
- Cloudflare DNS proxy: free
- GHCR: free for personal accounts

Total marginal cost of running v0: **<$5/mo** beyond the existing cluster spend.

## Rationale

1. **Reuse the cluster.** Cluster is paid, observed, and operationally proven. Spinning up Fly + Neon + Upstash adds 4 vendors, 4 dashboards, 4 monthly bills, and zero capability.
2. **Edge layer at Cloudflare** absorbs the TikTok burst. Cluster only sees authenticated API traffic, which is small even at viral scale.
3. **Per-app Redis** matches the lab pattern. Shared Redis across apps invites blast-radius incidents.
4. **CNPG `Database` per app** matches the lab pattern. Onboarding a new tenant of the cluster is one Terraform resource.
5. **Manual deploys for v0** match solo-dev velocity. CI/CD is a v0.1 concern; not having it doesn't block the 4-week sprint.

## Consequences

### Positive

- Marginal v0 spend under $5/mo.
- All existing observability lights up on first deploy.
- Disaster recovery story already exists at the cluster level.
- Pattern consistency: `paper` is the next sibling of `sure`, `immich`, `n8n`, etc.

### Negative / accepted

- **Single-region (fsn1)** is fine for v0 (audience starts in EU/US TikTok); high-latency-from-Asia is a deferred concern. Cloudflare Pages absorbs the static-asset latency globally; only the API takes the EU-origin penalty.
- **Manual deploys can drift** from local builds. Mitigation: SHA-tagged images make this debuggable; `kubectl describe deployment` shows what's actually running.
- **No PR previews** without CI. Accepted v0 cost; preview environments matter at team-of-3+ size.
- **Cluster network capacity** is finite. A pathological TikTok spike (>50k concurrent authed sessions on the API) might saturate the Hetzner LB. Mitigation: scale `paper-api` replicas + Cloudflare's request-coalescing rate-limit rules; reconsider only if observed.

## Alternatives considered

### A. Fly.io + Neon + Upstash + R2 (the original brainstorm Q4 D)
**Rejected after Q6 pivot.** User has an existing cluster; reusing it costs $0 marginal vs. ~$15–40/mo of cloud PaaS. PaaS shape is fine if the cluster ever goes away.

### B. Self-host MinIO on the cluster instead of R2
**Rejected.** Egress cost of MinIO on Hetzner = bandwidth bill on a hotlinked share card. R2's zero-egress is the killer feature for spec §3 virality loop.

### C. Self-host static client on the cluster instead of Cloudflare Pages
**Rejected.** Cluster is single-region; first paint from Asia/Australia would be 200–400ms slower than from a Cloudflare edge. Pages is free and faster.

### D. Cloudflare Workers for the API (instead of Fastify on K8s)
**Rejected.** Workers have a 10ms CPU budget per request on free, 50ms on paid; the trade execution + leaderboard endpoints exceed this. Cron support is via Workers Cron Triggers but doesn't fit the "single always-on process" constraint from the spec. Worker rewrites would constrain framework choices contrary to ADR 0006.

### E. ArgoCD / Flux for GitOps deployment from day one
**Rejected for v0.** Adds a tool surface to learn for zero gain at solo-dev scale. Reconsider when CI/CD lands.

## References

- Product spec §3, §11
- v0-stack-decisions.md §2, §4
- ADR 0006
- `../lab/README.md`, `../lab/CLAUDE.md`
- `../lab/stacks/sure/main.tf` (template for the new stack)
- CloudNativePG: https://cloudnative-pg.io
- Cloudflare R2: https://developers.cloudflare.com/r2/
- vite-plugin-pwa: https://vite-pwa-org.netlify.app
