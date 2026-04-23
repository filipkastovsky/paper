# Neo-Fintech Minimalist Exchange — v0 Design Spec

**Status:** Approved via brainstorming, ready for implementation planning.
**Date:** 2026-04-23
**Author:** Filip Kaštovský (founder) + Claude (brainstorming partner)

---

## 1. Context & pitch

A mobile-first paper-trading + crypto-education app for beginners. Users get simulated funds, place paper trades, learn via bite-sized pastel lesson cards, answer daily market predictions, and compete on weekly leaderboards.

**One-liner:** *The Duolingo of crypto — beautiful, beginner-friendly, and screenshot-worthy.*

**Business model:** Free product. Revenue (deferred to v0.2) via affiliate referrals to real crypto exchanges — users who complete the Fundamentals track and sustain a 30-day streak are invited to graduate to a partner exchange with a small starter deposit.

**Why this shape:** Real regulated exchanges require licenses, custody, KYC, and banking — a multi-year, multi-million path. A paper-trading app with affiliate monetization has zero regulatory burden, ships in weeks, and has a credible path to 1M users via content-led acquisition.

---

## 2. Strategic choices (with rationale)

Each decision below was weighed against alternatives during brainstorming; the rationale is recorded so future trade-offs can be judged against the original intent.

| Choice | What it means | Rationale |
|---|---|---|
| **Paper-only, no real money in v0** | No custody, no KYC, no licensing | Regulatory burden would delay launch by 12–18 months minimum |
| **Duolingo-for-crypto as retention loop** | Daily lessons, streaks, bite-sized content | Builds a compounding content moat; dodges gambling optics of competition-first designs |
| **Founder-as-creator on TikTok for acquisition** | Founder (Filip) personally films and posts 1–2 videos/day | Hired content ops drift corporate within 60 days; founder voice is the only version that sustains |
| **App-as-hero content strategy** | TikToks show the app itself; "What app is this?" in comments drives installs | PRD's pastel aesthetic is deliberately screenshot-friendly; lowest content-production cost |
| **Global + Friend leaderboard, composite scoring** | Weekly reset, score blends return% + lessons + streak | Pure return% leaderboards attract YOLO-degens and poison culture |
| **PWA first, native wrap later** | Zero install friction from TikTok bio link | Validate funnel before committing to App Store review cycles |
| **Server-authoritative trade execution** | Server prices trades at its own cached spot | Leaderboard integrity — clients cannot spoof prices |
| **Client-side share-card rendering** | Canvas-rendered 1080×1920 PNGs on device | Scales infinitely during viral spikes; no server hot path |

---

## 3. Four product loops

Every feature must justify itself against one of these loops.

**Acquisition loop.** Founder films a crypto concept with the app on screen → viewer comments *"what app is this?"* → link in bio → PWA install (near-zero friction) → 30-second onboarding → first lesson (~60s) + first paper trade → total time-to-value under 3 minutes from TikTok tap.

**Retention loop (daily, 2-minute ritual).** Push ping (streak at risk / daily question live) → open Dashboard → answer Daily Market Question (20s) → complete one Learn card (60s) → glance at paper portfolio → done.

**Virality loop.** Every celebratory moment — streak milestone, portfolio gain, weekly rank, track completion — auto-generates a one-tap pastel share card. Posted back to TikTok / IG / X, surfaces the app, closes the loop.

**Monetization loop (wiring present v0, CTA shown v0.2).** User completes Fundamentals track AND has ≥30-day streak AND opts in → prompted to graduate to affiliate partner → deep-link out → conversion postback → attribution.

---

## 4. Non-goals (v0)

Explicitly cut. Any of these being added in v0 is a scope violation.

- Candlesticks, TA, order books — the absence IS the differentiation
- Real money, KYC, custody — deferred indefinitely; paper-only is the product
- Wallet screen — folded into Dashboard in v0
- Dark mode — contradicts the brand
- Desktop, tablet, landscape — mobile-first to the exclusion of all else
- In-app chat, DMs, comments — moderation cost = zero, always
- More than ~15 assets — BTC, ETH, SOL, USDC, and the next-tier majors; expansion driven by TikTok demand signals
- News snippets in Learn — v0.1 at earliest
- AI monthly recap — v0.2 at earliest
- Affiliate CTA — v0.2 at earliest (retention must be proven first)
- Paid subscription tier — not planned; monetization is affiliate

---

## 5. Information architecture

Floating bottom nav, exactly 5 tabs. Nothing earns a sixth slot.

```
Home (Dashboard) · Trade · Learn · Ranks · You (Profile)
```

---

## 6. Screen specifications (v0)

### 6.1 Onboarding (~30 seconds, 4 steps)

1. **Welcome** — pastel hero, one-liner, "Get started" pill
2. **Handle pick** — unique @handle (identity, not username; appears on leaderboards and share cards)
3. **Starting balance reveal** — "Here's your $10,000 in practice cash" — big pastel moment, itself a share-bait frame
4. **First-lesson nudge** — "What is Bitcoin?" (~2-minute card); completion triggers the first share card

No email required. Device-only account (device UUID + server-issued JWT). Optional email-add later for recovery.

### 6.2 Dashboard

PRD as written, plus three additions:

- **Daily Market Question card** pinned at top of asset list (one tap → prediction modal)
- **Streak flame** icon in top-right of hero balance area (tap → streak detail + share)
- **Top movers strip** (horizontal scroll) below hero balance showing 5 biggest % movers today

Cut from PRD: horizontal quick-action row (Deposit/Withdraw make no sense without Wallet). Replaced by the Daily Market Question card.

### 6.3 Trade

PRD as written, two edits:

- Submit opens a **confirmation sheet** before executing (1 tap to confirm) — "savor the moment" beat
- Success modal generates a share card automatically ("I just bought $100 of BTC on $AppName")

No separate Sell screen — Buy/Sell pill toggle at top of same screen.

### 6.4 Learn

PRD as written, scoped curriculum for v0:

- **20 hand-crafted concept cards** organized into 3 tracks:
  - Fundamentals (10): what is crypto, wallet, keys, stablecoins, gas, etc.
  - Markets (5): volatility, liquidity, bid/ask, market cap, dominance
  - Safety (5): scams, phishing, 2FA, cold storage, rug pulls
- Track completion = big share card moment + cosmetic unlock (color theme or avatar badge)
- News snippets from PRD: **cut**, add in v0.1

### 6.5 Ranks

Two tabs: `Friends` (invited via link) and `Global` (weekly reset).

**Composite score formula:**

```
score = (portfolio_return_pct × 0.5)
      + (lessons_completed_this_week × 2)
      + (streak_days × 1)
```

Weighting prevents YOLO-degen dominance. Top 3 get pastel-gradient avatar frames (cosmetic, TikTok-able). Weekly reset: Sunday 00:00 UTC.

### 6.6 You / Profile

Minimal: handle, avatar (pick a pastel blob, no uploads), streak, total trades, lessons completed, share-card history, settings (notification toggles, reset account, about).

No bio, no followers, no DMs.

---

## 7. Cross-cutting systems

### 7.1 Daily Market Question

- One question per day globally; creation cron runs at 00:00 UTC, resolution cron runs at 00:00 UTC the following day
- Users see the active question from the moment it's created until resolution; "today's question" is defined by UTC day
- Format v0: "Will `{ASSET}` close up or down vs. yesterday?" (close = Binance 00:00 UTC daily close)
- Stake: 100–500 Prediction Points (separate currency from paper cash)
- Streak: consecutive days you *answered* (not consecutive correct); protects engagement over skill
- Correct-streak milestones (10, 25, 50, 100) trigger share cards
- Auto-generated from top-15 asset rotation; zero manual content work

### 7.2 Unified Daily Streak

- One primary streak for all users
- Satisfied by ANY daily action: completed lesson OR answered prediction OR placed a paper trade
- "Perfect Day" cosmetic badge when all three done
- 7-day and 30-day perfect streaks trigger special share cards
- Expires 24h after last qualifying action

### 7.3 Share-card system

Load-bearing for virality loop. Non-negotiable for v0.

- **Format:** 1080×1920 PNG (IG story / TikTok vertical)
- **Rendering:** client-side via Canvas — infinite scaling, ~50ms latency
- **Triggers:** streak milestones (7/14/30/100), lesson-track completion, weekly Top-N rank, portfolio gain milestones (+20%/+50%/+100%), daily-question correct-streak milestones, every paper trade success (optional, one tap)
- **Design:** pastel gradient, @handle, $AppName watermark, specific achievement
- **Storage:** generated on-demand; blob-stored only when user taps Export (we don't persist every generated card)

### 7.4 Push notifications

Three categories, intentionally few:

- `streak_at_risk` — 8pm local time if no qualifying action that day
- `daily_question_live` — 9am local time
- `milestone_unlocked` — event-driven

iOS PWA push is unreliable pre-iOS 16.4 and still shaky. Accept ~50% iOS push reach in v0; fix in native wrap. Android PWA push works well.

---

## 8. Logical data model

Vendor-agnostic entity definitions. Physical schema chosen during implementation.

### 8.1 Identity

- `User` — `id`, `handle`, `avatar_blob_id`, `device_uuid`, `email?`, `created_at`
- `Friendship` — `user_a`, `user_b`, `created_at` (accepted)

### 8.2 Paper economy

- `Portfolio` — `user_id`, `cash_usd`, `holdings: {asset_id: {qty, cost_basis}}`; starting cash $10,000
- `Trade` — `id`, `user_id`, `asset_id`, `side`, `usd_amount`, `qty`, `price_at_execution`, `idempotency_key`, `created_at`
- `PredictionPoints` — `user_id`, `balance`; starts 1,000; non-spendable; separate from cash

### 8.3 Content & learning

- `Track` — `id`, `title`, `order`, `color_theme`
- `Lesson` — `id`, `track_id`, `title`, `order`, `content_md`, `est_minutes`, `quiz_questions: []`
- `LessonProgress` — `user_id`, `lesson_id`, `completed_at`, `quiz_score`

### 8.4 Daily engagement

- `DailyQuestion` — `id`, `date`, `asset_id`, `question_type`, `resolves_at`, `resolved_direction?`, `resolved_at?`
- `UserPrediction` — `id`, `user_id`, `daily_question_id`, `predicted_direction`, `stake`, `idempotency_key`, `status`, `payout?`
- `Streak` — `user_id`, `current_days`, `longest_days`, `last_qualifying_action_at`, `perfect_days_count`

### 8.5 Virality

- `ShareCard` — `id`, `user_id`, `card_type`, `payload`, `rendered_png_blob_id?`, `created_at`, `exported_at?`
- `InviteLink` — `id`, `inviter_user_id`, `short_code`, `installs_attributed`, `created_at`

### 8.6 Rankings

- `LeaderboardSnapshot` — `user_id`, `week_starting_date`, `composite_score`, `rank_global`, `rank_friends`; recomputed every 5 min; weekly reset Sunday 00:00 UTC

### 8.7 Analytics

- `Event` — `user_id`, `event_name`, `properties (json)`, `client_ts`, `server_ts`, `session_id`, `source`

---

## 9. Event taxonomy

Every event below is required v0. Without them, the four loops cannot be measured.

**Acquisition:** `app_opened`, `onboarding_step_completed`, `onboarding_finished`, `first_lesson_completed`, `first_trade_placed`

**Retention:** `session_started`, `session_ended`, `daily_question_answered`, `daily_question_resolved`, `lesson_completed`, `trade_placed`, `streak_maintained`, `streak_lost`, `streak_milestone_reached`

**Virality:** `share_card_generated`, `share_card_exported`, `invite_link_created`, `invite_link_opened`, `friend_added`

**Monetization (wiring v0, CTA v0.2):** `affiliate_cta_shown`, `affiliate_cta_tapped`, `affiliate_conversion`

Every screen mount fires a named event. Events are the only way to prove the funnel works.

---

## 10. External dependencies

- **Prices:** Binance public API (`/api/v3/ticker/price`, `/api/v3/klines`) — free, no key required. Cached server-side, 30s TTL. Fallback: CoinGecko free tier.
- **Push:** Web Push + VAPID keys (PWA). APNs/FCM added at native wrap.
- **Analytics:** PostHog (cheaper than Mixpanel, self-hostable, session replay for onboarding debugging)
- **Hosting:** Cloudflare Pages (client), managed Node/Bun process (server), managed Postgres (primary DB), Redis-shaped cache (prices + leaderboard), S3-shaped blob store (cards + avatars) — specific vendors chosen during implementation

---

## 11. Architecture

### 11.1 Topology

```
[ TikTok viewer's phone browser ]
            │
            ▼
[ Static CDN edge ] ──── PWA shell + service worker
            │
            ▼
[ API layer ]       ──── auth, trades, predictions, lessons, leaderboards
            │
            ├──► [ Primary relational DB ]  users, trades, predictions, progress
            ├──► [ Fast cache ]             prices, leaderboard snapshot, session
            ├──► [ Blob store ]             rendered share cards (exported only)
            └──► [ Analytics sink ]         PostHog events

[ Background workers ]
   ├── price_ingestion_cron     every 30s
   ├── daily_question_creator   00:00 UTC daily
   ├── daily_question_resolver  00:00 UTC daily
   ├── leaderboard_recompute    every 5 min
   └── streak_reaper            hourly
```

### 11.2 Client (PWA)

- Framework TBD (Next.js / SvelteKit / Solid Start / Vite+vanilla all viable)
- Service worker handles asset caching, offline shell, web push
- State: small client store for UI + portfolio; server is source of truth for writes
- IndexedDB for cached lesson content + last-seen portfolio snapshot (instant cold-load). Trades and predictions require connectivity (server-authoritative pricing) — fail fast with a clear retry prompt if offline. Lesson completion can queue and sync on reconnect.
- Share cards rendered client-side via Canvas

### 11.3 API layer

- REST-ish JSON; framework TBD
- Auth: device UUID at install → refresh token (90d) + JWT (1h)
- **Server-authoritative trade execution**: client POSTs `{asset_id, side, usd_amount, idempotency_key}`; server prices at own cached spot, writes Trade + Portfolio in one transaction, returns executed price
- Same for predictions: server stamps stake, locks question window

### 11.4 Deployment

- Monorepo (pnpm workspaces): `client`, `server`, `shared` (types + event constants)
- Single always-on Node/Bun server process — avoid all-serverless for crons and streak logic
- Managed Postgres; managed Redis-shaped cache; managed blob store
- CI: staging + prod only, no PR previews in v0

### 11.5 Scale profile at 1M users

At 25% D1 retention → ~250k DAU; ~1.5–2M writes/day (~20–30 rps avg, ~150 rps peak). Trivial for a small Postgres instance.

The only real hot path: viral TikTok spike causing 500k installs in 48h. Mitigations:
- Edge-cached PWA shell (no origin hit for asset load)
- Auth endpoint rate-limited per-IP
- Optimistic UI keeps the client fast even under API load

### 11.6 Security posture

- Leaderboard integrity via server-authoritative pricing (above)
- Rate limiting: 20 trades/min per device UUID; 1 prediction/question/day (schema-level)
- Handle squatting: ~500-handle blocklist + profanity filter
- Multi-accounting accepted in v0 (low incentive without real money); add fingerprinting + invite-link abuse detection in v0.2

---

## 12. Launch plan (three named releases)

| Version | Ships | Gate |
|---|---|---|
| **v0** (launch) | Everything above. No affiliate CTA. | Prove the 4 loops work, especially retention |
| **v0.1** (~week 12) | 40 lessons total, refined share-card templates (data-driven), iOS push fixes, leaderboard season-reset moment | Only ship what events say is working |
| **v0.2** (~week 16) | Affiliate wiring (partner TBD, conversations start week 8), qualifier gate (Fundamentals complete + ≥30-day streak), monthly AI recap card | Only monetize once retained cohort is clear |

---

## 13. 90-day week-by-week

**Weeks 1–4 — Build v0**
- W1: monorepo, PWA shell, design tokens, Binance pipeline, auth
- W2: Dashboard, Trade, server-authoritative trading, portfolio math, analytics wiring
- W3: Learn, curriculum (20 lessons), streak, onboarding
- W4: Daily Market Question, Ranks, share-card renderer, push

**Week 5 — Polish**
- Fix onboarding drop-off (install → first lesson <90s end-to-end)
- Verify every event fires in PostHog
- Accessibility sweep
- Load-test price cache + trade execution

**Week 6 — Stealth launch (50–200 invite-only)**
- Personal network + 2–3 crypto-Twitter mutuals
- Catch UX landmines, confirm retention shape
- Feature flags on all risky components

**Weeks 7–8 — Pre-TikTok content pipeline**
- Film 20 videos (3-week buffer)
- A/B three hook formats: (i) teaching with app on screen, (ii) streak/milestone reveal, (iii) building-in-public
- Write founder bio + pinned comment template

**Weeks 9–12 — TikTok launch**
- W9 D1: first public video, install link live
- 1–2 posts/day, 7 days/week, non-negotiable
- Monday morning: cohort analysis, kill losing formats, double down on winners
- By end of W12: either a reliable install-driving format exists, or pivot strategy

---

## 14. Success metrics (phase gates)

| Gate | Metric | Threshold |
|---|---|---|
| End of W5 | Onboarding reaches first lesson | ≥70% |
| End of W5 | Trade execution error rate | <0.1% |
| End of W5 | All 4-loop events in PostHog | 100% coverage |
| End of W8 | D7 retention (stealth cohort) | ≥25% |
| End of W8 | Share card / DAU / week | ≥15% generate ≥1 |
| End of W12 | Total installs from TikTok | ≥5,000 |
| End of W12 | Install → first-lesson-complete | ≥50% |
| End of W12 | D7 retention (TikTok cohort) | ≥20% |
| End of W12 | ≥1 video with ≥100k views | yes/no |

Missing a gate is not a reason to push harder — it's a signal to diagnose before shipping forward.

---

## 15. Pre-committed kill criteria

Written down now to prevent in-the-moment rationalization.

- **Stop posting TikToks if:** 30 days pass with no video crossing 10k views AND no install spike → founder-as-creator thesis is wrong, pivot channel
- **Kill the leaderboard if:** global leaderboard users show >2× churn vs. non-leaderboard users → it's attracting degens who bounce
- **Kill the Daily Market Question if:** <15% of DAU engages by week 10 → dead weight
- **Pivot the product if:** D7 <10% after two onboarding redesigns → core retention loop is broken

---

## 16. Deferred (beyond 90 days)

Backlog, not forgotten:

- Wallet screen (when it earns its slot)
- AI monthly recap (v0.2 or later)
- Native wrap via Capacitor/Expo + App Store launch (target month 4 — unblocks iOS push)
- News snippets in Learn
- Portfolio-diversity gamification (badges for 3+ holdings)
- Creator partnerships (v2 thinking, get organic loop working first)

---

## 17. Founder time allocation (from week 9 forward)

- **50% content** — filming, editing, posting, replying in comments
- **30% product iteration** — weekly cohort analysis → ship loop
- **15% community & support** — DM the first 100 users personally; this is growth
- **5% everything else** — fundraising, admin, infra

If this allocation isn't sustainable, the founder-as-creator thesis falls apart and the product needs a different acquisition path (creator-partnership model from brainstorming option D).

---

## 18. Open decisions (pushed past v0)

- **Specific tech-stack choices** (client framework, API framework, DB vendor, cache vendor) — decide during implementation planning
- **Affiliate partner selection** (Coinbase / Kraken / Zero Hash / MoonPay / Bitstamp-as-a-service) — BD conversations start week 8, decision by week 12
- **Native wrap technology** (Capacitor vs. Expo) — month 3

---

## Appendix A — Design system (from PRD, unchanged)

### Color palette

- **Primary:** `#0F172A` — main buttons, primary interactions
- **Background:** `#F8FAFC` — app background
- **Surface:** `#FFFFFF` — cards, modals, bottom nav
- **Text:** `#1E293B` — headings, primary body
- **Muted:** `#94A3B8` — secondary text, borders, inactive
- **Accent Up:** `#34D399` — positive price action, success
- **Accent Down:** `#FB7185` — negative price action
- **Pastel Brand:** `#E0E7FF` — soft indigo for learning cards, highlight backgrounds

### Typography

- **Headings:** Cabinet Grotesk, 700/800, 24–36px
- **Body:** Plus Jakarta Sans, 500, 16px
- **Small:** Plus Jakarta Sans, 500, 14px
- **Buttons:** Cabinet Grotesk, 700, 16px
- **Numerals:** Space Grotesk, 500, 14–48px (balances and prices)

### Design tokens

```css
:root {
  --color-primary: #0F172A;
  --color-background: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-text: #1E293B;
  --color-muted: #94A3B8;
  --color-accent-up: #34D399;
  --color-accent-down: #FB7185;
  --color-pastel: #E0E7FF;

  --font-heading: 'Cabinet Grotesk', sans-serif;
  --font-body: 'Plus Jakarta Sans', sans-serif;
  --font-mono: 'Space Grotesk', sans-serif;

  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-pill: 9999px;

  --shadow-soft: 0 10px 40px rgba(0,0,0,0.03);
  --shadow-float: 0 20px 40px rgba(15, 23, 42, 0.08);
}
```

Style notes: heavy use of `border-radius: 24px` on primary cards. Floating nav bars, not edge-to-edge. Large, diffuse, low-opacity shadows. No hard borders — separation via white space and subtle shadows.
