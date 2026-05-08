# ADR 0003 — PWA service worker strategy

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-07 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | CTO agent (Claude) |
| **Audience** | Implementation engineer |
| **Companion** | ADR 0002 (build target), product spec §7.4, §11.2 |

---

## TL;DR

The PWA shell uses **`vite-plugin-pwa`** (Workbox under the hood), in **auto-update mode**, with **network-first** caching for API requests and **stale-while-revalidate / precache** for static assets and lesson content.

## Context

The product spec requires:

- Zero install friction from a TikTok bio link (§3 acquisition loop)
- Service worker handles asset caching, offline shell, web push (§11.2)
- IndexedDB for cached lesson content + last-seen portfolio snapshot for instant cold-load (§11.2)
- Trades + predictions require connectivity (server-authoritative); fail fast with a retry prompt offline (§11.2)
- Push notifications via Web Push + VAPID; iOS PWA push reach ~50% in v0 (§7.4)

## Decision

### Plugin

`vite-plugin-pwa` ≥ 0.20, configured in `apps/web/vite.config.ts`:

- `registerType: 'autoUpdate'` — new SW skips waiting and claims clients on activate. No "Reload to update" UX in v0.
- `injectRegister: 'auto'` — single import line in `main.tsx`.
- `devOptions.enabled: true` — SW active in dev for faithful behaviour testing.

### Manifest

Generated via the plugin from a `manifest` block:

- `name: 'paper'` (app identity placeholder until brand is finalised — see ADR 0009)
- `display: 'standalone'`, `orientation: 'portrait'`
- Icons from `apps/web/public/icons/` — 192px + 512px PNGs at minimum, 384px for Android adaptive
- `theme_color: oklch(98% 0.008 85)` (Marshmallow `--paper`)
- `background_color: oklch(98% 0.008 85)` (matches splash to app)

### Caching strategies

Workbox runtime caching configured per request pattern:

| Pattern | Strategy | Reason |
|---|---|---|
| App shell (HTML, JS, CSS) | **Precache** at install | Instant cold-load, offline-capable. Bundle size matters; precache the minimal critical path. |
| Fonts (Bricolage, Hanken from Google Fonts) | **Cache-first**, 1 year | Fonts are immutable; never re-fetch. |
| Lesson content (`/api/lessons/*`, mostly text+md) | **Stale-while-revalidate** | Lessons change rarely; instant render from cache, refresh in background. |
| Read-only API (`/api/portfolio`, `/api/me`, `/api/leaderboard`) | **Network-first**, 5s timeout, fall back to cache | Cold-load shows last-seen state immediately; spec §11.2 requirement. |
| Write API (`POST /api/trades`, `POST /api/predictions`) | **Network-only**, no cache | Server-authoritative; offline = retry, never silently succeed. |
| Static images (R2-hosted) | **Cache-first**, 30 days | Share cards and avatars are immutable per blob ID. |
| PostHog, Sentry, etc. third-party telemetry | **Network-only** | Don't poison the cache with analytics responses. |

### Push notifications

- VAPID keypair generated once, public key shipped to client via env var, private key stored as Kubernetes secret on the server.
- Client subscribes via `pushManager.subscribe()` after explicit user opt-in in onboarding step 4 or first qualifying action.
- Server uses `web-push` npm library to dispatch.
- No queue in v0 — pushes sent inline from the request that triggers them (low volume; queue reconsidered at v0.1 if fan-out grows).

## Rationale

1. **`vite-plugin-pwa` is the canonical Workbox wrapper for Vite.** Single source of truth for manifest + SW; no hand-rolled Workbox config.
2. **Auto-update keeps users on the freshest version.** The product is in heavy iteration during weeks 5–12; a "reload to update" prompt would slow the feedback loop.
3. **Network-first for read API matches spec §11.2's contract.** Cold-loads show last-seen state instantly while the network call completes in the background.
4. **Network-only for writes preserves server-authoritative pricing** (spec §11.6).
5. **Inline push send for v0** avoids over-engineering; pg-boss / queue is reconsidered at v0.1 once non-cron background work materialises.

## Consequences

### Positive

- TikTok install → first paint is genuinely sub-second after the first visit (precached shell).
- Offline cold-load shows the last-seen portfolio (acceptable degraded experience).
- No "stale app" complaints — SW auto-updates silently.

### Negative / accepted

- **iOS PWA push reach ~50% in v0** — a known constraint (spec §7.4); native wrap (Capacitor/Expo) at month 4 fixes it.
- **Auto-update can race with in-progress trade submits** in pathological cases (SW activates mid-POST). Mitigation: write requests are network-only and idempotent (idempotency keys per spec §8.2); a SW swap during a trade just means the next request lives on a new SW. Acceptable.
- **Cached lesson content can drift** if lessons are edited server-side. Stale-while-revalidate guarantees freshness on second view; first view may show 1 stale revision. Acceptable for content that changes ~weekly.

## Alternatives considered

### A. Hand-rolled Workbox
**Rejected.** Adds maintenance burden for zero feature gain over the Vite plugin.

### B. `next-pwa`
**N/A** — ruled out by ADR 0002's choice of Vite over Next.js.

### C. Skip the SW in v0, add later
**Rejected.** Push notifications and offline cold-load are core to the retention loop (spec §3 retention loop, §7.4). Adding the SW later is more painful than starting with it.

### D. "Update available" toast UX (manual update mode)
**Considered, deferred.** Cleaner for established apps but slows the iteration loop in weeks 5–12. Reconsider at v0.1 once feature flags and gradual rollout matter.

## References

- Product spec §3, §7.4, §11.2, §11.5, §11.6
- vite-plugin-pwa: https://vite-pwa-org.netlify.app
- Workbox runtime caching: https://developer.chrome.com/docs/workbox/caching-strategies-overview
- Web Push (RFC 8030) + VAPID (RFC 8292)
