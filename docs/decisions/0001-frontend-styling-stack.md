# ADR 0001 — Frontend styling stack

| | |
|---|---|
| **Status** | Accepted (focused decision — CTO may supersede in a follow-up ADR if broader stack constraints require it) |
| **Date** | 2026-04-23 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | Marshmallow design-system author (Claude) |
| **Audience** | CTO agent designing the v0 tech stack |
| **Supersedes** | — |
| **Superseded by** | — |

---

## TL;DR

The v0 client styles itself with **Tailwind CSS v4** consuming the canonical `docs/design/tokens.css` via `@theme inline`, plus a thin component layer using **`class-variance-authority` (cva)** for typed variants and **`clsx + tailwind-merge`** for className composition. React is the UI library. **No specific React framework is locked** — Vite, Next.js, Remix, or TanStack Start are all compatible.

This ADR locks **only** the styling architecture. The framework, server stack, DB, hosting, and PWA tooling remain open for the CTO to decide.

---

## 1. Context

The product (a paper-trading + crypto education PWA — see `docs/superpowers/specs/2026-04-23-neo-fintech-minimalist-exchange-design.md`) has converged on the **Marshmallow** design system, documented in `docs/design/design-system.md` with portable tokens at `docs/design/tokens.css`.

The remaining open question is *how the React client should consume those tokens* — the styling architecture. Multiple viable options exist (CSS Modules, vanilla-extract, Tailwind, runtime CSS-in-JS, Panda, etc.); a decision is needed before component implementation begins so the CTO can plan the broader stack around it.

### Constraints driving this decision

| # | Constraint | Source |
|---|---|---|
| 1 | Mobile-first PWA, light mode only, portrait-only | Spec §4, §11.2 |
| 2 | `tokens.css` MUST stay canonical — no fork of values into a JS theme object or framework config | `docs/design/design-system.md` §12 |
| 3 | Bundle size matters: TikTok-driven install funnel needs fast first-paint; viral-spike scenarios hit 500k installs in 48h | Spec §11.5 |
| 4 | Solo-founder velocity: tooling cost should be near zero. Founder spends 50% time on content, ~30% on product (spec §17). | Spec §17 |
| 5 | TypeScript preferred — the spec's data model and event taxonomy (§8, §9) imply rigour at the boundary | Implied |
| 6 | Marshmallow has 30+ tokens (8 neutrals, 8 pastels with deep pairs, 2 semantic, 5 fluid type steps, 8 spacing, 6 radii, 4 shadows). The styling layer must scale to all of them without hand-mapping each. | `docs/design/tokens.css` |
| 7 | Designer-engineer is the same person at v0; can change later. | Project state |

---

## 2. Decision

### 2.1 Styling layer — **Tailwind CSS v4 with `@theme inline`**

`docs/design/tokens.css` defines all design values as CSS custom properties on `:root`. A second file, `docs/design/react/globals.css` (already shipped), re-exports those variables to Tailwind v4:

```css
@import "../tokens.css";
@import "tailwindcss";

@theme inline {
  --color-paper:   var(--paper);
  --color-mint:    var(--mint);
  --color-ink:     var(--ink);
  --font-display:  var(--font-display);
  --radius-pill:   var(--r-pill);
  --shadow-pop:    var(--shadow-pop);
  /* …30+ tokens, see globals.css for full list */
}
```

Tailwind generates utility classes from these (`bg-mint`, `text-ink-soft`, `rounded-pill`, `shadow-pop`, `font-display`, etc.) at build time. Tokens.css remains the only place values live.

**No `tailwind.config.{js,ts}` file is needed.** Tailwind v4's CSS-first configuration replaces the JS config object entirely.

### 2.2 Component layer — **`class-variance-authority` + cn helper**

Six primitives shipped at `docs/design/react/components/ui/`:

| Primitive | Variants |
|---|---|
| `<Button>` | variant × size × fullWidth, optional trailing chip |
| `<Card>` | tone × elevation × padding |
| `<BalanceNumeral>` | size, soft-decimal, no-decimal — formats USD via Intl |
| `<Eyebrow>` | rule (yes/no) — uppercase display label |
| `<Heading>` | level (display, h1, h2, h3) — fluid clamp sizing |
| `<PhoneFrame>` | preview-only, used in galleries and marketing pages |

`cva` provides typed variant APIs (`<Button variant="primary" size="lg" />`) without a runtime CSS-in-JS layer. `clsx + tailwind-merge` (combined as `cn()`) handles className composition and dedupes conflicting Tailwind utilities.

### 2.3 Runtime cost

Total dependencies added to the client bundle:

| Lib | Min+gzip | Purpose |
|---|---|---|
| `clsx` | ~0.5 kB | conditional className composition |
| `tailwind-merge` | ~2.5 kB | dedupes conflicting Tailwind utilities |
| `class-variance-authority` | ~0.5 kB | typed variant API |
| **Total** | **~3.5 kB** | |

Tailwind utilities themselves emit dead-code-eliminated CSS at build time — typically 8–15 kB on a screen-rich app. This is materially smaller than runtime CSS-in-JS alternatives (styled-components ~12 kB, Emotion ~15 kB).

### 2.4 What this ADR does NOT decide

These remain open for the CTO. Each may need its own ADR:

- **React framework**: Vite + vite-plugin-pwa | Next.js App Router | Remix / React Router 7 | TanStack Start
- **PWA service-worker generator**: vite-plugin-pwa | next-pwa | hand-rolled Workbox
- **Headless primitive library**: à la carte Radix UI primitives (for a11y on dialogs, popovers, sliders) vs hand-rolled
- **State management**: TanStack Query for server state alone | + Zustand or Jotai for UI state
- **Server framework + DB + cache + blob store** — see spec §11
- **Monorepo tooling**: pnpm workspaces is specified (spec §11.4); package layout still TBD
- **Linter / formatter / pre-commit**: not yet decided

A non-binding recommendation on the framework appears in §6 below.

---

## 3. Rationale

### 3.1 Why Tailwind v4 over alternatives

Tailwind v4's `@theme inline { --color-mint: var(--mint); }` directive is purpose-built for the exact case where CSS variables are defined elsewhere and need to drive utility classes. This satisfies constraint 2 (canonical tokens) more cleanly than any other styling solution.

Build-time CSS generation satisfies constraint 3 (bundle size). Zero JS config (constraint 4). First-class `data-*` and arbitrary-value support means we rarely need to escape the system. The cva + cn idiom is the dominant React UI pattern in 2026 and well-understood.

### 3.2 Why the framework is left open

The styling stack is **architecturally orthogonal** to the framework choice. All six shipped primitives are pure-React components with no Server-only or Client-only API dependencies. They render identically under Vite, Next.js App Router, Remix, and TanStack Start. The CTO should pick the framework based on *non-styling* requirements (SSR needs, deployment target, marketing-page strategy, team familiarity).

---

## 4. Consequences

### Positive

- **Single source of truth.** A change in `tokens.css` propagates to every Tailwind utility, every primitive, every screen with one file edit. No JS theme object to drift out of sync.
- **Lean PWA bundle.** Zero CSS-in-JS runtime. ~3.5 kB of helpers + Tailwind's tree-shaken CSS output. Critical for the TikTok install-spike scenario (constraint 3).
- **Typed variants.** `cva` flags invalid prop combinations at compile time without forcing styles into TypeScript.
- **Familiar idiom.** The Tailwind + cva + cn triad is widely adopted; future hires (if any) ramp up fast.
- **Framework-agnostic.** Decision can survive a framework swap with zero rework of the design system.

### Negative / accepted trade-offs

- **Long class strings on complex components.** Mitigated by extracting recurring patterns into primitives early (the six already shipped cover ~80% of typical screens).
- **Tailwind v4 recency risk.** GA in 2024–25. If a build-tool integration bug blocks us, fallback path is Tailwind v3 (with a JS config file) — migration effort ~1 day.
- **Class-string handoff from designer to engineer.** Mitigated because Marshmallow has one author and one engineer at v0. If the team grows, we may need a Storybook + Figma Code Connect pairing — defer until ≥3 frontend devs.
- **No automatic dark mode.** Design system is light-mode only by spec (§4); not a regression.

---

## 5. Alternatives considered

### A. CSS Modules + tokens.css imported globally
Per-component `.module.css` files, raw CSS using `var(--ink)` etc.

- **Pro:** Zero new tooling; very explicit.
- **Con:** Verbose for a 30-token system. Every component re-declares spacing/colour usages by hand. Loses the speed of utility classes during the W3–W5 screen build-out.

### B. vanilla-extract
TypeScript-typed CSS, build-time compilation, can read CSS variables.

- **Pro:** Strong type-safety on style values themselves (not just variants).
- **Con:** Significant build-tool integration. Another DSL to learn. Type-safety on tokens is achievable via Tailwind autocomplete + cva variant types at lower cost.

### C. styled-components / Emotion
Runtime CSS-in-JS, theme via React Context.

- **Pro:** JS-native API, dynamic theming, mature ecosystems.
- **Con:** 12–15 kB runtime cost (constraint 3). Both ecosystems are stagnating in 2026 — newer projects rarely choose them. Unnecessary re-render cost on theme changes (irrelevant in light-mode-only, but still a smell).

### D. Panda CSS
Build-time atomic CSS-in-JS with strong TypeScript integration.

- **Pro:** Best-in-class type-safety; codemod-friendly; zero runtime.
- **Con:** Adds a DSL on top of the styling layer. Team is one engineer at v0; the abstraction cost isn't recouped until ≥3 frontend devs.

### E. Adopt the full shadcn/ui kit
Use shadcn primitives, theme them with Marshmallow tokens.

- **Pro:** 30+ accessible primitives (Dialog, Popover, Tooltip, etc.) out of the box.
- **Con:** shadcn is built around Radix UI. Re-skinning every primitive to Marshmallow's plump-pastel aesthetic is more work than building the six we need ourselves. We can still adopt **individual** Radix primitives à la carte for a11y-critical interactions (e.g., `@radix-ui/react-dialog` for the daily-question bottom sheet) — see §7 open questions.

---

## 6. Recommendation on the open framework choice (non-binding)

For a solo-founder PWA-first product, the recommendation is **Vite + React + `vite-plugin-pwa`**:

| Factor | Vite + PWA plugin | Next.js App Router |
|---|---|---|
| Bundle size at first paint | Smallest | Adds React Server Components runtime even on auth'd pages |
| Dev-rebuild speed | <100 ms typical | 200–400 ms typical |
| Service-worker generation | First-class via plugin | Requires next-pwa or hand-rolled Workbox |
| SSR for marketing pages | Add later via separate static-gen | Built-in |
| Vendor lock-in | None | Vercel-tilted DX |

The product is overwhelmingly an authenticated app (spec §6.2, §6.3, §6.5) — SSR isn't recouped, so Vite's smaller surface is preferred. If the CTO's broader plan introduces marketing pages, blog content, or SEO needs that justify SSR, Next.js is a fine alternative — the styling stack works identically there.

---

## 7. Open questions / hand-off to the CTO

Please decide and capture in subsequent ADRs:

1. **ADR 0002 — Build target.** Vite vs Next.js vs Remix vs TanStack Start. Recommendation in §6.
2. **ADR 0003 — PWA service worker strategy.** Generator + caching policy. Depends on (1).
3. **ADR 0004 — Headless primitives.** À la carte Radix UI primitives for a11y-critical interactions, or hand-roll? The current Marshmallow gallery has a hand-rolled bottom sheet (Daily Question screen 7) — Radix `Dialog` would give a11y, focus management, and ESC handling for free at ~3 kB.
4. **ADR 0005 — State management.** TanStack Query alone vs adding Zustand/Jotai for UI state.
5. **ADR 0006 — Server stack.** Spec §11 sketches the topology; specific framework / ORM / DB / cache / blob vendor choices remain open.
6. **ADR 0007 — Monorepo layout.** Spec §11.4 specifies pnpm workspaces with `client / server / shared` packages — internal layout, lockfile policy, CI matrix all TBD.
7. **ADR 0008 — Linter / formatter / pre-commit hooks.** ESLint + Prettier is the conventional default; the cva pattern is compatible with all major configs.

---

## 8. References

- **Product spec:** `docs/superpowers/specs/2026-04-23-neo-fintech-minimalist-exchange-design.md`
- **Design system:** `docs/design/design-system.md`
- **Canonical tokens:** `docs/design/tokens.css`
- **Skeleton implementation:** `docs/design/react/` (globals.css + 6 primitives + 1 example screen + integration README)
- **External:**
  - Tailwind CSS v4 — CSS-first config introduced 2024
  - `class-variance-authority` — https://cva.style/docs
  - `tailwind-merge` — dedupes conflicting Tailwind classes
