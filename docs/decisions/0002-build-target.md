# ADR 0002 — Build target

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-07 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | CTO agent (Claude) |
| **Audience** | Implementation engineer (also Filip), future contributors |
| **Supersedes** | — |
| **Superseded by** | — |
| **Companion** | ADR 0001 (styling), ADR 0003 (PWA SW), ADR 0009 (infrastructure) |

---

## TL;DR

The v0 client is a **Vite 5 + React 18 single-page application** built with `@vitejs/plugin-react` and `@tailwindcss/vite`. No SSR, no React Server Components, no framework wrapper.

## Context

ADR 0001 §6 made a non-binding recommendation for Vite over Next.js / Remix / TanStack Start. Constraints driving the choice:

| # | Constraint | Source |
|---|---|---|
| 1 | Mobile-first PWA, light-mode only, portrait-only | Spec §4, §11.2 |
| 2 | Service-worker-owned shell with offline cold-load (last portfolio snapshot) | Spec §11.2 |
| 3 | The product is overwhelmingly authenticated — no SEO surface in v0 | Spec §6 (5 of 5 tabs are post-auth) |
| 4 | Solo founder spending 50% time on content; build-tool friction must be near zero | Spec §17 |
| 5 | TikTok-driven install funnel — first-paint speed matters under viral spike | Spec §11.5 |
| 6 | Marketing pages, blog, SEO landing pages — none in v0; affiliate CTA + content marketing arrive at v0.2 | Spec §12 |

## Decision

- **Build tool:** Vite 5
- **UI library:** React 18 (no concurrent-mode features required for v0)
- **Vite plugins:** `@vitejs/plugin-react`, `@tailwindcss/vite` (already prescribed by ADR 0001), and `vite-plugin-pwa` (per ADR 0003)
- **Routing:** TanStack Router (file-based, type-safe routes)
- **Output target:** static SPA bundle deployed to Cloudflare Pages (per ADR 0009). No SSR, no edge functions.
- **TypeScript:** strict mode on, `noUncheckedIndexedAccess` on, `verbatimModuleSyntax` on

## Rationale

1. **No SSR cost.** RSC / SSR would pay for content the v0 product doesn't have. An authenticated app behind device-UUID auth gets nothing from server-rendered first paint.
2. **Smallest bundle, fastest dev.** Vite's dev server cold-starts in <500 ms; HMR is sub-100 ms. Next.js App Router's RSC runtime adds ~30 kB even on auth'd pages.
3. **Service worker integration is first-class.** `vite-plugin-pwa` generates manifest + Workbox-based SW from a single config block. Next.js's PWA story (`next-pwa`, hand-rolled Workbox) is significantly more setup.
4. **Vendor neutrality.** The Vite output is plain HTML+JS — host on Cloudflare Pages today, swap to any static CDN tomorrow with zero rework.
5. **Marshmallow primitives are framework-agnostic.** ADR 0001 §3.2 already established this. Vite is the cheapest framework that consumes them.
6. **TanStack Router is best-in-class for type-safe SPA routing.** File-based routes auto-generate a typed route tree; search params are typed; route-level data loaders pair cleanly with TanStack Query.

## Consequences

### Positive

- Smallest possible JS payload at first paint; matches the TikTok-spike profile in the product spec.
- Dev velocity: instant HMR, no framework recompile penalty on schema/route changes.
- One build tool across client, server tests (Vitest uses Vite plugin pipeline), and shared packages.
- Decision survives a future Capacitor/Expo wrap (month 4 per spec §16) — Capacitor consumes a static SPA bundle natively.

### Negative / accepted

- **No SSR for marketing pages later.** When v0.2 introduces a marketing surface, options are: (a) add a sibling Astro site for marketing, or (b) migrate the auth'd app to a framework that supports both. Option (a) is preferred and trivial. The styling layer (ADR 0001) ports identically.
- **No file-based routing without a plugin.** TanStack Router fills this; if it's swapped later for React Router 7, code-splitting and typed routes need re-establishing.
- **Deeplinking on the SPA requires SPA fallback rewrites.** Cloudflare Pages handles this via `_redirects` (`/* /index.html 200`).

## Alternatives considered

### A. Next.js (App Router)
**Rejected.** RSC runtime cost on auth'd pages. PWA service-worker story is third-party. Vendor-tilted DX (Vercel-leaning). Forces React Server Components mental model on a fully-client product.

### B. Remix / React Router 7 (framework mode)
**Rejected.** Built around server-driven data loading; for a fully-client PWA this is overkill. Genuinely good if marketing surface arrived in v0 — it doesn't.

### C. TanStack Start
**Rejected for v0** (would have been a strong contender otherwise). Still pre-1.0 at the time of decision; more risk than warranted on a 4-week sprint. Reconsider in 12 months.

### D. SvelteKit / Solid Start
**Rejected.** Team experience (Q1 of brainstorm) is React. Velocity beats elegance.

### E. Astro + React islands
**Rejected.** Optimised for content-heavy mostly-static sites. v0 is the inverse — small content surface, large interactive surface.

## Open questions deferred

- **Capacitor vs Expo for native wrap** (month 4 per spec §16) — both consume a Vite SPA bundle; decision can wait.
- **Marketing surface framework** when v0.2 adds one — likely Astro, but punt.

## References

- Product spec §4, §11.2, §11.5, §12, §17
- ADR 0001 §6 (recommendation)
- Vite docs: https://vitejs.dev
- TanStack Router: https://tanstack.com/router
- vite-plugin-pwa: https://vite-pwa-org.netlify.app
