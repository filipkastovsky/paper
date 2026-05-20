# Marshmallow → React

Drop-in primitives for consuming the Marshmallow design system in any React project.

## What this is

Not a runnable app — a **copy-paste-ready skeleton**. Lift these files into your real client when you scaffold it (Vite / Next.js / Remix all fine).

```
docs/design/
├── tokens.css                      ← canonical source of truth (don't fork)
└── react/
    ├── globals.css                 ← Tailwind v4 entry, maps tokens to utilities
    ├── lib/
    │   ├── cn.ts                   ← clsx + tailwind-merge
    │   └── format.ts               ← Intl USD / pct / qty formatters
    └── components/
        ├── ui/
        │   ├── button.tsx          ← cva variants, trailing chip
        │   ├── card.tsx            ← tone × elevation × padding
        │   ├── balance-numeral.tsx ← hero number type
        │   ├── eyebrow.tsx         ← uppercase display label
        │   ├── heading.tsx         ← display / h1–h3 with fluid clamp
        │   └── phone-frame.tsx     ← preview frame for galleries
        └── screens/
            └── welcome-screen.tsx  ← reference composition
```

## Why this stack

| Approach | Verdict |
|---|---|
| **Tailwind v4 + cva + tokens.css** ← recommended | Single source of truth, zero runtime, typed variants, framework-agnostic |
| Plain CSS Modules | Verbose for a token-heavy system; no utility velocity |
| vanilla-extract | Type-safe but build-heavy; overkill for a solo project |
| styled-components / emotion | Runtime cost on a PWA; declining trajectory |
| Panda CSS | More abstraction than this project needs at v0 |

The win: change a value in `tokens.css`, every Tailwind utility AND every primitive updates. No duplicate definitions in a `tailwind.config`, no JS-side theme object.

## Setup (any React framework)

1. **Copy the files.** `cp -r docs/design/react/* your-app/src/` and `cp docs/design/tokens.css your-app/src/styles/`. Adjust the `@import "../tokens.css"` path in `globals.css` to match.

2. **Install runtime deps** (~3.5 kB minified gzip total):
   ```sh
   npm i clsx tailwind-merge class-variance-authority
   ```

3. **Install Tailwind v4** for your build tool:
   ```sh
   # Vite
   npm i -D tailwindcss @tailwindcss/vite
   # Next.js (App Router)
   npm i -D tailwindcss @tailwindcss/postcss
   ```

4. **Wire it in:**
   - **Vite** (`vite.config.ts`):
     ```ts
     import { defineConfig } from "vite";
     import react from "@vitejs/plugin-react";
     import tailwindcss from "@tailwindcss/vite";
     export default defineConfig({ plugins: [react(), tailwindcss()] });
     ```
   - **Next.js** (`postcss.config.mjs`):
     ```js
     export default { plugins: { "@tailwindcss/postcss": {} } };
     ```

5. **Import `globals.css` once** at app entry (`main.tsx` for Vite, `app/layout.tsx` for Next).

6. **Add the fonts** to your HTML head (Vite: `index.html`, Next: in `<head>` of `app/layout.tsx`):
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com" />
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
   <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
   ```

That's it. The primitives now consume your tokens via Tailwind utilities like `bg-mint`, `text-ink-soft`, `rounded-pill`, `shadow-pop`, `font-display`.

## Usage example

```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Eyebrow } from "@/components/ui/eyebrow";

export function PortfolioHero({ value }: { value: number }) {
  return (
    <Card tone="ink" padding="lush" elevation="float" className="relative">
      {/* pastel decoration blobs */}
      <span aria-hidden className="absolute -top-10 -right-10 h-36 w-36 rounded-full bg-peach opacity-35" />
      <span aria-hidden className="absolute -top-2 -right-5 h-20 w-20 rounded-full bg-mint opacity-45" />

      <div className="relative">
        <Eyebrow className="text-paper/55">Total portfolio</Eyebrow>
        <BalanceNumeral value={value} size="md" className="mt-1.5 text-paper" softDecimal={false} />
        <Eyebrow rule className="mt-3 text-mint">+ $482.14 · 4.82% today</Eyebrow>
      </div>

      <Button trailing="→" fullWidth className="mt-5">
        See holdings
      </Button>
    </Card>
  );
}
```

## Picking the build setup

The spec leaves the React build target open (§18). For a solo-founder PWA-first product, lean **Vite + React + `vite-plugin-pwa`**:

- Smallest bundle, fastest dev rebuilds.
- `vite-plugin-pwa` generates the service worker + manifest with one config block.
- No SSR cost on an authenticated app.

Next.js works too if marketing pages later need SSR — the components above are framework-agnostic and use no Server-only or Client-only APIs.

## Adding more primitives

When you find yourself writing the same Tailwind class string twice, extract it. Common Marshmallow patterns to anticipate:

- `<NavBar />` — floating bottom nav (5 items, ink active pill)
- `<TopMover />` — horizontal-scroll asset chip
- `<DailyQuestionTile />` — lilac question prompt
- `<ShareCard />` — 9:16 ink card with pastel decoration blobs (will need Canvas at runtime per spec §7.3, but the static React preview here is fine for editing)
- `<Streak />` — peach pill with the 🔥 glyph

Keep them all under `components/ui/` and follow the cva pattern for variants.
