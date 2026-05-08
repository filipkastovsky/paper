# ADR 0004 — Headless primitives

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-05-07 |
| **Decision owner** | Filip Kaštovský |
| **Drafted by** | CTO agent (Claude) |
| **Audience** | Implementation engineer |
| **Companion** | ADR 0001 (styling), Marshmallow design system |

---

## TL;DR

Use **Radix UI primitives à la carte** (per-package install, ~3–6 kB each gzipped) for accessibility-critical interactive surfaces — Dialog, Tabs, Popover, Toast, Slider. Skin them with `cva` against Marshmallow tokens. Hand-roll everything else.

## Context

ADR 0001 §5.E rejected the **full shadcn/ui kit** because re-skinning every primitive to Marshmallow's plump-pastel aesthetic costs more than building the few we need. ADR 0001 §7 left **which** Radix primitives we use, and which interactive surfaces remain hand-rolled, open for the CTO.

Marshmallow has six hand-rolled primitives shipped in `docs/design/react/components/ui/`: Button, Card, BalanceNumeral, Eyebrow, Heading, PhoneFrame. None of them require complex a11y semantics (focus trapping, ARIA roving tabindex, dialog ESC handling).

The product spec includes several interactive surfaces that DO need real a11y work:

- **Trade confirmation sheet** (§6.3) — modal dialog, focus trap, ESC, body scroll lock
- **Daily Market Question modal** (§7.1) — modal dialog
- **Share-card preview modal** (§7.3) — modal dialog
- **Buy/Sell pill toggle** (§6.3) — tab semantics, keyboard arrow navigation
- **Friends/Global tab toggle** (§6.5) — same
- **Trade success toast** (§6.3) — live region + queue management
- **Streak-saved confirmation** — toast
- **Trade amount stepper** (§6.3) — slider with keyboard increments

## Decision

### Adopt à la carte

| Package | v0 use case |
|---|---|
| `@radix-ui/react-dialog` | trade confirmation sheet; daily question modal; share-card preview modal |
| `@radix-ui/react-tabs` | Buy/Sell on Trade; Friends/Global on Ranks |
| `@radix-ui/react-popover` | handle picker validation hint; top-mover detail tooltip |
| `@radix-ui/react-toast` | trade success; streak saved; copy-to-clipboard confirmation |
| `@radix-ui/react-slider` | trade amount stepper |

Each is wrapped in a Marshmallow-skinned component under `apps/web/src/components/ui/`, e.g.:

```tsx
// apps/web/src/components/ui/sheet.tsx
import * as Dialog from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const sheet = cva(
  "fixed inset-x-0 bottom-0 z-50 rounded-t-[var(--r-xl)] bg-surface shadow-float",
  { variants: { tone: { paper: "bg-surface", lilac: "bg-lilac" } }, defaultVariants: { tone: "paper" } }
);

export const Sheet = ({ tone, ...props }: VariantProps<typeof sheet> & Dialog.DialogContentProps) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
    <Dialog.Content {...props} className={cn(sheet({ tone }), props.className)} />
  </Dialog.Portal>
);
```

### Hand-roll the rest

Everything else stays hand-rolled:

- Floating bottom nav (5 tabs, ink active pill)
- Asset-icon chips
- Daily Question tile (lilac surface with `?` glyph)
- Streak pill (peach with 🔥)
- Hero portfolio card
- Top mover horizontal scroller
- Onboarding step indicator
- Share-card render frame (Canvas-driven, not a styled primitive)

These are either Marshmallow-specific visual primitives or simple presentation-only components — Radix wouldn't help.

### Skipped Radix primitives

- `@radix-ui/react-select` — no native select needed in v0; pickers are bottom sheets.
- `@radix-ui/react-dropdown-menu` — no menus in the IA (spec §5).
- `@radix-ui/react-tooltip` — hover-only UX is wrong for a mobile-only product. Inline help text instead.
- `@radix-ui/react-accordion` — not in the IA.
- `@radix-ui/react-radio-group` — not in v0; reconsider at v0.1.

## Rationale

1. **A11y is non-negotiable** for Dialog (focus trap, ESC, body scroll lock, ARIA labelling) and Tabs (keyboard arrow navigation, roving tabindex). Hand-rolling these is several weeks of work and will have bugs.
2. **À la carte keeps bundle size honest.** Five packages × ~5 kB ≈ 25 kB; the full shadcn-Radix surface is closer to 80–120 kB if all 30+ primitives ship.
3. **cva fits Radix natively.** Radix exposes class-friendly slots; cva on top of those slots yields type-safe variants without runtime CSS-in-JS (matches ADR 0001 §2.3).
4. **Marshmallow's distinct visual primitives stay hand-rolled.** Replacing a hand-rolled Marshmallow bottom sheet with Radix-Dialog-skinned-as-bottom-sheet is the same code with one extra dependency layer — accept the case-by-case judgment.
5. **Future primitives bias toward addition.** When v0.1 needs (e.g.) a date picker or radio group, add the Radix package and skin it. No big-bang library adoption.

## Consequences

### Positive

- A11y-critical UI is solved by a battle-tested library; Filip doesn't write focus-trap logic.
- Bundle stays tight (~25 kB additional).
- Marshmallow primitives evolve independently of any external library version.
- Hand-rolled surfaces remain editable without library escape hatches.

### Negative / accepted

- **Two patterns coexist** — Radix-skinned vs hand-rolled. Mitigation: a one-paragraph rule in `apps/web/src/components/ui/README.md` ("if it's a focus-managed interaction, wrap a Radix primitive; else hand-roll").
- **Radix CSS reset assumptions** can clash with Tailwind defaults. Mitigation: use `unstyled` mode where available; otherwise scope reset overrides per primitive.

## Alternatives considered

### A. Full shadcn/ui kit
**Rejected** by ADR 0001 §5.E. Re-skinning 30+ primitives to Marshmallow is more work than the surface area justifies.

### B. Hand-roll everything (no Radix)
**Rejected.** Focus management and dialog a11y are too easy to ship broken. Spec §10 (accessibility targets) demands proper focus rings, ESC handling, ARIA — Radix delivers all of these.

### C. Ark UI / Park UI primitives
**Rejected.** Smaller ecosystem and community than Radix; Radix is the de facto React primitive layer in 2026.

### D. Base UI (MUI's unstyled line)
**Rejected.** Sound technically; Radix has more widespread production usage and tighter Tailwind affinity.

### E. Headless UI (Tailwind's official)
**Rejected.** Smaller surface than Radix (no Slider, no Toast); Radix covers our list completely.

## References

- ADR 0001 §5.E
- Product spec §6.3, §6.5, §7.1, §7.3, §10
- Radix UI: https://radix-ui.com
- cva: https://cva.style/docs
