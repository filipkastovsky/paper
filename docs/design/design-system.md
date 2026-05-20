# Marshmallow — v0 Design System

**Status:** Canonical. Supersedes Appendix A of `docs/superpowers/specs/2026-04-23-neo-fintech-minimalist-exchange-design.md`.
**Chosen:** 2026-04-23
**Reference showcase:** `tmp/design-explorations/01-marshmallow/index.html`

---

## 1. One-sentence brief

Warm cream paper, a rotating four-way pastel palette, oversized tabular display numerals, and plump radii. Soft enough to poke; confident enough to trust with (fake) money.

## 2. Principles

1. **Celebrate, don't overwhelm.** Every win gets one big beautiful moment, not a page of stats.
2. **Numbers are hero typography.** Balances, prices, streaks — tabular, oversized, tight tracking.
3. **No hue owns a category.** Pastels rotate across surfaces; peach ≠ down, mint ≠ up. Colour is flavour, not signal.
4. **Coral, never red.** Loss colour is oklch(68% 0.17 28). Users who are learning should not feel punished.
5. **Light mode only.** Dark is a non-goal — see spec §4.
6. **Screenshot-first.** Every celebratory moment must survive being cropped to 9:16 on TikTok, muted.

## 3. Colour tokens

All values in OKLCH. Reduce chroma when approaching extreme lightness — light-but-saturated is garish.

### Neutrals (warm, tinted)

| Token             | OKLCH                  | Role                                   |
|-------------------|------------------------|----------------------------------------|
| `--paper`         | `oklch(98% 0.008 85)`  | App background — cream, warm           |
| `--surface`       | `oklch(100% 0 0)`      | Elevated cards, bottom nav             |
| `--surface-2`     | `oklch(96% 0.012 85)`  | Recessed / segmented chips / toggles   |
| `--ink`           | `oklch(22% 0.022 275)` | Primary text + primary button fill     |
| `--ink-soft`      | `oklch(40% 0.018 275)` | Secondary text                         |
| `--muted`         | `oklch(58% 0.012 275)` | Captions, placeholder text             |
| `--line`          | `oklch(90% 0.008 275)` | Hairlines, dividers                    |

Neutrals are deliberately **tinted toward warm yellow (h≈85)** to cohere with the pastel accents. No pure white / black anywhere.

### Pastels (rotating accents)

| Token           | OKLCH                  | Deeper pair (for numerals / hover)    |
|-----------------|------------------------|----------------------------------------|
| `--mint`        | `oklch(84% 0.095 160)` | `--mint-deep`  = `oklch(68% 0.14 160)` |
| `--peach`       | `oklch(86% 0.085 35)`  | `--peach-deep` = `oklch(72% 0.14 35)`  |
| `--sky`         | `oklch(87% 0.075 230)` | `--sky-deep`   = `oklch(68% 0.14 230)` |
| `--lilac`       | `oklch(86% 0.085 300)` | `--lilac-deep` = `oklch(68% 0.14 300)` |

**Usage rule:** rotate pastels across feature surfaces. The daily question tile is lilac; the streak pill is peach; asset-icon chips cycle through all four based on asset index. Never encode meaning into a hue.

### Semantic

| Token    | OKLCH                  | Role                                   |
|----------|------------------------|----------------------------------------|
| `--up`   | `oklch(62% 0.17 155)`  | Positive change, gain                  |
| `--down` | `oklch(68% 0.17 28)`   | Negative change — coral, **not red**   |

Loss is coral at hue 28°. Red (hue 20–25°, chroma ≥0.20) is banned in-product.

## 4. Typography

### Fonts

- **Display:** `'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif` — variable font, opsz `12..96`, weights 400–800. Used for all headings, balances, UI labels.
- **Body:** `'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif` — weights 400–700. Used for prose, lesson copy, long descriptive strings.

Both are free on Google Fonts. Load with `display=swap`.

### Type scale

Fluid via `clamp()`. Steps follow a 1.25 ratio.

```css
--step-0: clamp(0.95rem, 0.9rem + 0.2vw, 1.05rem);   /* Body */
--step-1: clamp(1.10rem, 1.0rem + 0.4vw, 1.30rem);   /* Lede */
--step-2: clamp(1.40rem, 1.2rem + 0.8vw, 1.85rem);   /* Card title */
--step-3: clamp(2.00rem, 1.6rem + 1.6vw, 3.00rem);   /* Section */
--step-4: clamp(3.00rem, 2.0rem + 3.5vw, 5.50rem);   /* Display */
```

### Numerals

Balance figures are the product's hero typography. Rules:
- `font-family: var(--display)` (Bricolage)
- `font-weight: 800`
- `font-variant-numeric: tabular-nums`
- `letter-spacing: -0.04em` (tighten at scale)
- Dollar sign is `font-weight: 500`, `font-size: 50%`, vertical-align: top, colour `--ink-soft`

## 5. Spatial system

4pt base. Tokens use semantic names, not pixel counts.

```css
--space-xs:  4px;
--space-sm:  8px;
--space-md:  12px;
--space-lg:  16px;
--space-xl:  24px;
--space-2xl: 32px;
--space-3xl: 48px;
--space-4xl: 64px;
```

Prefer `gap` over margins for sibling spacing. Use container queries (`@container`) for component responsiveness.

## 6. Radii (plump)

```css
--r-xs:   10px;  /* tiny chips */
--r-sm:   16px;  /* input fields, small cards */
--r-md:   24px;  /* cards */
--r-lg:   32px;  /* hero cards, modals */
--r-xl:   44px;  /* onboarding sheets */
--r-pill: 9999px;
```

**Plump > sharp.** Marshmallow skews toward larger radii. Default card radius is 24px, not 12px.

## 7. Shadows (soft, tinted)

Shadows carry the brand hue — no pure-grey drops.

```css
--shadow-pop:    0 10px 24px -8px oklch(50% 0.05 275 / 0.22);
--shadow-float:  0 18px 40px -18px oklch(50% 0.05 275 / 0.25);
--shadow-inset:  inset 0 -3px 0 0 oklch(30% 0.05 275 / 0.10); /* plump button bottom */
--shadow-phone:  0 40px 80px -30px oklch(30% 0.04 275 / 0.40),
                 0 10px 24px -12px oklch(30% 0.04 275 / 0.20);
```

Primary CTAs use `--shadow-inset` on the bottom edge — gives buttons a soft-3D "poke me" affordance without a skeuomorphic bevel.

## 8. Motion

- Standard ease: `cubic-bezier(.2, .9, .2, 1)` (ease-out-quart-ish)
- Entry duration: `400ms`
- Micro-interaction: `200ms`
- Celebratory moments (streak milestone, trade success): staggered reveal, `80ms` per element, up to 5 elements
- **No elastic / bounce easing.** Real objects decelerate smoothly.
- Reduced-motion: respect `prefers-reduced-motion`, fall back to fade-only.

## 9. Component patterns

### Primary CTA button

```
background: var(--ink);
color: var(--paper);
padding: 18px 24px;
border-radius: var(--r-pill);
font: 700 15px var(--display);
letter-spacing: 0.02em;
box-shadow: var(--shadow-inset);
display: flex; justify-content: space-between; align-items: center;
/* trailing arrow chip */
.arrow { background: var(--peach); colour: var(--ink); width: 32px; height: 32px; border-radius: 50%; }
```

### Hero portfolio card (Dashboard)

- Base: `--ink` background with `--paper` text (the one dark moment in the UI)
- Decorative pastel blobs inside — peach top-right, mint below-right, radial at low opacity (`0.35`–`0.45`)
- Balance in display 800, tabular, tight tracking
- Change row: `▲` or `▼` glyph + `--up` / `--down` colour + tinted chip for percentage

### Floating bottom nav

- 5 items, always visible except on trade-execution success
- Background `--surface`, `--shadow-float`
- Active item: `--ink` pill, `--paper` text
- Radius: `--r-pill`, 16px inset from screen edge

### Daily question tile (Dashboard)

- Background: `--lilac`
- Circular icon left: `--ink` fill with `?` glyph in `--paper`
- Single-line headline in display 700
- Stake caption in `--ink-soft`

### Asset-icon chip

- 34px circle, pastel fill cycling by asset index (BTC=peach, ETH=sky, SOL=lilac, AVAX=mint, USDC=mint, ...)
- Single-letter glyph in display 800, `--ink` colour
- No real logos in v0 — deliberately branded. If a partner requires their logo, add a slot; until then, the pastel chips are the look.

### Share card (1080×1920)

- Dark `--ink` base with peach + mint decorative blobs (same primitives as hero card, amplified)
- Top strip: `@handle · category · subcategory`
- Hero numeral in display 800, tabular, white (`--paper`)
- Caption: one sentence in italic-esque body weight
- Footer: `$AppName` mark + "→ get the app" CTA
- **Generated client-side** via Canvas (see spec §7.3)

## 10. Accessibility targets

- Text contrast ≥ 4.5:1 for body, ≥ 3:1 for large (18px+ / 14px+ bold). Ink on paper hits this comfortably.
- Pastels are **never** used behind body text without an ink overlay — they're surfaces, not text grounds.
- Hit targets: minimum 44×44px for anything tappable.
- Focus rings: 2px outline in `--ink`, offset 2px. Never `outline: none`.
- Respect `prefers-reduced-motion` (see §8).
- Dyslexic-friendly body font consideration: Hanken Grotesk chosen partly for open terminals and clear `a` / `g` forms.

## 11. What Marshmallow deliberately rejects

Saved here so future-us doesn't drift back into these:

- **Candlestick charts / TA.** Absence is the differentiation.
- **Red-for-down.** Coral (hue 28°) or nothing.
- **Green-to-blue tech-bro gradients** behind hero content.
- **Glassmorphism.** Frosted glass blurred everything reads as cheap AI output.
- **Side-stripe accent borders** on cards / callouts (`border-left: 4px solid red` etc).
- **Gradient text** — solid colour only, hierarchy from weight + size.
- **Inter / Plus Jakarta Sans / Space Grotesk** — all training-reflex fonts, out.
- **Dark mode.** Explicit spec non-goal.

## 12. Where the tokens live

- Canonical CSS: `docs/design/tokens.css` — drop into any framework, `@import` it from the app's root stylesheet.
- When the v0 client framework is chosen (Next.js / SvelteKit / etc.), these tokens feed the framework's theming layer directly (Tailwind config, CSS Modules, vanilla-extract — all consume OKLCH variables without translation).
