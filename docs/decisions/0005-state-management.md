# ADR 0005 — State management

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-07 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | CTO agent (Claude) |
| **Audience** | Implementation engineer |
| **Companion** | ADR 0006 (server stack — Kubb codegen depends on this), ADR 0002 (build target) |

---

## TL;DR

**Server state:** TanStack Query, exclusively via Kubb-generated hooks (per ADR 0006).
**UI state:** Zustand (~1 kB) for cross-component state — bottom sheet open/close, trade Buy/Sell toggle, draft prediction stake, onboarding step.
**URL state:** TanStack Router search params (per ADR 0002).
**Component-local state:** plain `useState` / `useReducer`.

No Redux, no Jotai, no React Context-as-state.

## Context

The product spec (§6) defines five tabs and several modal flows. State falls into four categories:

| Category | Examples | Lifetime | Owner |
|---|---|---|---|
| Server state | portfolio, trades, lessons, leaderboard, daily question, streak | Stale; refetch-driven | Server is source of truth |
| Cross-component UI state | sheet open/close, buy/sell pill, draft stake, draft trade amount, onboarding step | Session | Client-only |
| URL state | active tab, deep-link to lesson, share-card payload | Navigation | Browser address bar |
| Local state | form input focus, animation phase, hover state | Component | Component |

Kubb (per ADR 0006) auto-generates TanStack Query hooks from the OpenAPI spec, so server state has a fixed engine. The open question is what to use for cross-component UI state, and to confirm that lighter alternatives exist for everything else.

## Decision

### Server state — TanStack Query (auto-generated via Kubb)

Already implicit. Every API call is a Kubb-generated hook (`useGetPortfolio`, `useCreateTrade`, `useGetLeaderboard`, etc.) returning typed data and mutation helpers. No custom data-fetching layer.

Defaults set in `apps/web/src/lib/query-client.ts`:

- `staleTime: 30_000` (matches the product spec's 30s price cache TTL — but see §4.1 of the v0 stack spec, amended to 60s)
- `refetchOnWindowFocus: true` (mobile blur/focus is the natural "refresh me" signal)
- `retry: 1` for queries; `retry: 0` for mutations (idempotency keys handle replay)
- `gcTime: 5 * 60_000` (5 min in memory after last subscriber)

### UI state — Zustand

Per-domain stores under `apps/web/src/stores/`:

| Store | Purpose |
|---|---|
| `useUIStore` | global modal/sheet open state, toast queue, current celebratory animation phase |
| `useTradeDraftStore` | active asset, side (buy/sell), USD amount, slider step — clears on submit success |
| `usePredictionDraftStore` | active question id, predicted direction, stake — clears on submit success |
| `useOnboardingStore` | step index, draft handle, draft avatar — cleared on completion |

Each store is ~20–40 lines. No selector libraries, no immer middleware initially — flat state is fine for these surfaces.

### URL state — TanStack Router search params

Active tab on `Ranks` (`?view=friends|global`), deep-linked lesson (`/learn/$lessonId`), share-card payload (`?card=streak-7`). All typed via TanStack Router's search-param schemas.

### Component-local state — `useState` / `useReducer`

Default for everything that doesn't need to survive an unmount or be read from elsewhere.

## Rationale

1. **TanStack Query is the only sane choice** when Kubb is generating the hooks. Skipping it means rewriting every Kubb plugin.
2. **Zustand is the right size for our UI state.** ~1 kB, no provider, no boilerplate, no decisions about action vs reducer vs mutation. `create((set) => ({ open: false, openSheet: () => set({ open: true }) }))` is the entire mental model.
3. **Jotai's atomic model is a poor fit** for the surfaces we have. Our cross-component state is small (~4 stores), domain-bounded, and not deeply nested. Jotai pays off when state is fine-grained and atomically subscribed across many components.
4. **Redux Toolkit is overkill.** No time-travel debugging needs; no complex async middleware; no large team that benefits from action-log discipline. The tax is real (selectors, slices, ceremony) and unrecouped.
5. **React Context for state is rejected.** Good for theming and dependency injection, terrible for state — every consumer re-renders on every change. Zustand selectors avoid this for free.

## Consequences

### Positive

- New screen state goes in either a Kubb hook (server) or a Zustand store (client) — the choice is mechanical.
- Bundle cost: TanStack Query (~13 kB) + Zustand (~1 kB) ≈ 14 kB total runtime state cost.
- Tests: stores are plain modules, trivially mockable in Vitest. TanStack Query hooks are tested via the official `QueryClient` test wrapper.
- Devtools available for both (TanStack Query devtools + Zustand devtools middleware).

### Negative / accepted

- **Two state homes.** Mitigated by the clean rule above. The line stays sharp because Kubb generates server-state hooks and we never write `fetch()` directly.
- **No persistence layer prescribed for Zustand.** Onboarding step survival across cold-load is desirable. Mitigation: add `zustand/middleware/persist` to `useOnboardingStore` only if data shows users dropping mid-onboarding. Not v0 default.

## Alternatives considered

### A. Jotai (atomic state)
**Rejected.** Better mental model for fine-grained derived state, worse for domain-bounded UI state. Wrong shape for this product.

### B. Redux Toolkit
**Rejected.** Overkill at solo-dev scale. Tax not recouped.

### C. Recoil
**Rejected.** Unmaintained.

### D. XState for the onboarding flow
**Rejected for v0** (would have been a sensible alternative for `useOnboardingStore` specifically). Reconsider at v0.1 if onboarding gains complex branching.

### E. React Context + useReducer for UI state
**Rejected.** Re-render storms on each dispatch unless wrapped in selector hooks — at which point you've reinvented a worse Zustand.

### F. Just URL state for everything cross-component
**Rejected.** Ephemeral state (sheet open) doesn't belong in the URL — pollutes share links and history.

## References

- Product spec §6 (screen specs)
- ADR 0006 (Kubb generates TanStack Query hooks)
- TanStack Query: https://tanstack.com/query
- Zustand: https://github.com/pmndrs/zustand
