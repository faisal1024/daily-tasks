# Momentum — Master Plan (Profitability + AI Goals)

> Merges `momentum_prd_v8.docx` (PRD) + `docs/product-roadmap.md` (roadmap) into one strategy
> aimed at making the app profitable, built around AI-driven goal achievement.
> Companion docs: `Plan.md` (PRD status), `AI_INTEGRATION_PLAN.md` (AI plumbing).
> Last updated: 2026-05-30

---

## 1. Strategy in one line

**"Tell Momentum a big goal. It gives you 3 doable tasks a day to get there — and adjusts every
day so you never fall off."**

Calm 3-task simplicity (today) + Finch-style emotional warmth (retention) + AI goal-decomposition
(the reason to pay). That blend is an unoccupied position in the market.

### Where we sit vs. the market (research-backed)
| App | Strength | Weakness we exploit | Price |
|---|---|---|---|
| **Finch** (~$30M ARR, bootstrapped, best-in-class D30 retention) | Emotional, gamified, non-judgmental daily loop | Doesn't help achieve real goals | ~$40/yr |
| **Motion** | Powerful AI auto-scheduling | Cold, complex, expensive | $29–49/mo |
| **Sunsama** | Calm intentional daily ritual (profitable) | Manual, pricey, pro-user only | $20–25/mo |
| **Dreamfora / Mentor** | AI breaks big goal → steps | Weak daily ritual + emotional hook | freemium |
| **Momentum (us)** | **Big goal → 3 calm daily tasks + warmth + daily AI adaptation** | (new entrant) | **$2–5/mo target** |

**Takeaways baked into this plan**
- Finch proves the *emotional, non-judgmental* loop out-retains clinical/cold productivity apps. Tone is a moat — keep it.
- AI raises revenue-per-payer **+41%** but churns **~30% faster** → pair the AI hook with a Finch-grade retention layer or it leaks.
- **Hard/direct paywalls convert 5× better than freemium** in productivity/lifestyle (10–38% vs ~2%) → lean toward a free-trial-then-paywall model, not an indefinitely-free app.

---

## 2. The core new feature: Goals (AI goal → daily 3)

This is the headline feature and the primary reason to subscribe. It's **toggleable** so the app
still works as the simple 3-task tool for people who want that.

### 2.1 Two modes (one toggle)
- **Free-form mode (current app):** user picks any 3 tasks. Calm, manual, no goal attached.
- **Goal mode (new, premium):** user sets a larger goal; AI builds a path; each day some/all of the
  3 tasks are auto-suggested steps toward that goal. Toggle in Settings and per-day ("focus on my
  goal today?  yes / not today").

### 2.2 Goal lifecycle
1. **Capture the goal.** User types a goal in plain language ("Run a 5K", "Launch my Etsy shop",
   "Read 12 books this year") or picks a template. AI asks **1–3 smart follow-up questions** only
   (deadline? current level? time/day?) — Mentor-style, but capped to protect the <3-min feel.
2. **AI generates a plan.** Output = `Goal → Milestones (3–6) → Task pool`. Show the milestones as a
   visible "path" so the user *sees* the journey (Goalscape/Dreamfora lesson: visualizing the path
   increases commitment).
3. **Daily decomposition.** Each morning AI picks **1–3 tasks** from the current milestone, sized to
   the user's time/energy/struggle. User can keep, swap, or add their own — never auto-locked.
4. **Daily adaptation (the magic).** The next day's prompt is rebuilt from recent performance:
   - missed yesterday / 2+ misses → **smaller, easier** next step + encouraging note
   - completing consistently → **advance the milestone / raise challenge**
   - reflection text feeds tone & focus ("felt overwhelmed" → simplify)
   - This is the PRD §4 adaptive logic, made real. It's also the retention engine — the plan feels
     *alive*, which is what justifies a recurring subscription.
5. **Progress & payoff.** Milestone completion = a celebration moment (Finch-style: warm, a small
   visual reward). Calendar already shows daily 0–3; add a per-goal progress bar.

### 2.3 Multiple goals
- Free tier (if free mode kept): 0 active goals, or 1 trial goal.
- Premium: up to ~3 active goals (keeps with the "few things matter" philosophy — don't become a
  backlog tool). Only one goal is "today's focus" at a time.

### 2.4 Data model (extends `lib/daily-tasks/types.ts`)
```ts
interface Goal {
  id: string;
  title: string;            // "Run a 5K"
  why?: string;             // optional motivation, used in prompts + reminders
  targetDate?: string;
  cadence: "daily" | "weekday" | "flexible";
  milestones: Milestone[];
  taskPool: string[];       // AI-generated candidate steps
  status: "active" | "paused" | "done";
  createdAt: string;
}
interface Milestone { id: string; title: string; order: number; done: boolean; }
// AppState additions:
goals: Goal[];
goalModeEnabled: boolean;     // the on/off toggle
focusGoalId: string | null;   // today's goal in focus
```

### 2.5 The "daily prompt that updates itself"
Each day a fresh `/daily` request is built from: goal + current milestone + last 3–5 days of
completion + missed streak + last reflection + time/energy/struggle. The model returns 1–3 right-
sized tasks + one encouraging line. See `AI_INTEGRATION_PLAN.md` §Prompts for the exact contract.
The *self-updating prompt* is literally the loop in §2.2 step 4.

---

## 3. Monetization model

### 3.1 Recommended: free trial → paywall (not indefinite freemium)
Research: hard/direct paywalls convert 5× better with similar retention; AI raises revenue-per-payer.
Goal mode is expensive to give away (AI cost) and is the clearest value — gate it.

- **Free (no trial needed):** the current simple app — manual 3 tasks/day, calendar, streaks,
  reminders, lock, rollover. Genuinely useful, builds trust, drives word-of-mouth. Keep ~7–14 days
  of history free.
- **Trial:** **14-day** full-access trial of Goal mode on first goal creation (research: 17–32-day
  trials convert best; our AI cost is mostly the one-time plan + cheap Haiku dailies, so 14 days is
  affordable). No credit card to start if possible, then paywall at end. A/B toward 21 days later.
- **Premium ("Momentum+"):** AI Goal mode, multiple goals, full history, weekly insights, widgets,
  themes, focus timer, advanced reminders.

### 3.2 Pricing (LOCKED for launch)
- **$4.99/mo · $29.99/yr (hero) · lifetime deferred.** Above the roadmap's old $1.99/$14.99 because
  goal-achievement + AI carries higher willingness-to-pay than a checkbox app.
- **Anchor the annual plan** (~50% off monthly, best LTV); monthly for low-commitment.
- **Lifetime deferred** until AI cost/user is measured — a one-time payment against perpetual AI
  inference is a margin trap. Revisit ~$79.99 with an AI "fair-use" cap once we have real numbers.
- Unit economics: **Haiku for `/daily`, Sonnet for one-time `/plan`**; cache; **one `/daily` call
  per user per day max**. AI cost/user/day must stay well under daily revenue.

### 3.3 Paywall placement (no dark patterns — protects the calm brand)
- Trigger the paywall at **moments of demonstrated value**: after the AI generates a compelling plan,
  after first milestone completion, when adding a 2nd goal. Not on launch.
- Always allow restore purchases; clear, honest premium screen.

---

## 4. Retention design (steal Finch's playbook, keep our calm)

AI churns faster, so retention must be deliberate. Finch's loop = emotional care + gentle daily
reason to return, *without* guilt or spam. **Decision: lean into gamification** as the primary
retention moat, tuned to keep the calm tone.

**The "Journey" system (core gamification layer):**
- **A growth visual that advances with progress.** Each goal has a visual journey/path (or a small
  growing companion à la Finch) that visibly moves forward every time the user completes tasks. This
  is the emotional payoff — the user *sees* themselves getting closer to something they actually want.
- **"Showed up" streak** — counts days the user engaged at all (not perfection). Non-judgmental:
  missing a day pauses, never resets to zero with shame; a "streak freeze"/grace day protects it.
- **Milestone celebrations** — completing a milestone triggers a warm, earned moment (confetti +
  copy + the journey visual leveling up). These are the dopamine beats that pace a long goal.
- **XP / levels (light)** — small XP for finishing tasks → levels that unlock cosmetic rewards
  (themes, journey skins, companion accessories). Cosmetic-only, never pay-to-win, no daily energy
  walls. Ties directly into premium (more skins/themes for subscribers).
- **A warm identity beat daily** ("You showed up today." / "Two steps closer to your 5K.").
- **Recovery, not punishment:** after misses, AI *shrinks* the task and reassures, and the journey
  shows "back on the path," not failure. This anti-guilt loop is the differentiator.

**Guardrail:** gamification must never add pressure, noise, or clutter to the core 3-task screen —
rewards live in their own surface (a "Journey" tab/sheet), and the Today screen stays calm.

---

## 5. Release roadmap (re-sequenced for profit)

Status legend: `[x]` done · `[~]` partial · `[ ]` todo
Last updated: 2026-06-02 · Live on the App Store at **v1.0.10**.

### ✅ Shipped (v1.0 — the full free product is live)
- [x] **Onboarding** — Welcome + Get Started, custom + suggested goals, experience/
      struggle + 3 enrichment questions (motivation, best time, cadence), name field, First Win.
- [x] **AI foundation** — provider-agnostic proxy (OpenAI/Anthropic) deployed on Render,
      offline template fallback, `summarizeRecentPerformance` + recent-tasks summary.
- [x] **Goals + core loop** — Goal/Milestone model, AI plan (milestones + task pool),
      daily 1–3 suggestions (pick/regenerate), self-updating adaptation, milestone
      auto-advance + celebration.
- [x] **Gamification** — XP, levels, "showed up" streak w/ freezes, Journey screen,
      cosmetics, celebration overlay.
- [x] **AI = Claude Haiku 4.5** (cheapest), prompt-caching hook, "your own tasks" awareness.
- [x] **UX** — bold gamified redesign, hourly reminders, update prompt, keyboard fix.

### 🔴 v1.1 — THE MONEY RELEASE (do next; nothing else first)
- [ ] **Live-ops hardening (do TODAY, before more users):** Anthropic console spend
      limit + alerts; rotate the API key; enable `PROXY_SHARED_SECRET`; upgrade Render
      to paid ($7/mo) to kill the 50s cold start on the headline feature.
- [ ] **RevenueCat + StoreKit** integration, restore purchases.
- [ ] **14-day trial → paywall on AI Goal mode**, shown at value moments (right after
      the AI generates a compelling plan / first milestone).
- [ ] **Grandfather existing users** — anyone who onboarded pre-paywall keeps AI access
      (protects the young listing from 1-star "you took my feature" reviews).
- [ ] **Analytics** (RevenueCat metrics + lightweight privacy-friendly tracker, e.g.
      Aptabase/PostHog): trial-start, trial→paid, D1/D7/D30, activation. Ship WITH the paywall.
- [ ] **Merge the premium look** — real bundled fonts (PR #30) so the paid tier feels premium.
- [ ] Pricing at launch: **$4.99/mo · $29.99/yr** (lifetime deferred).

### 🟡 v1.2 — THE "WORTH IT" RELEASE (justify the subscription)
- [ ] Weekly insights (completion rate, best days, goal velocity) — as premium content.
- [ ] Widgets (home + lock screen), themes, alt icons, focus timer — as premium content.
- [ ] Advanced reminders (quiet hours, tone).
- [ ] **ASO pass** — keyword-tuned title/subtitle, benefit-led screenshots captured on a
      REAL device (avoids the simulator emoji-box issue), prompt-for-rating after a perfect day.

### 🟢 v1.3 — Android (doubles the market)
- [ ] Google Play account ($25 one-time), adaptive icon, `.aab` build + submit.
- [ ] Android update-prompt manifest, POST_NOTIFICATIONS permission, on-device QA.

### 🔵 v2.0+ — Differentiated scale (later)
- [ ] Multiple goals + Goal-mode on/off toggle (currently single-goal, always-on).
- [ ] Two-model AI split (`/plan` Sonnet + `/daily` Haiku) if quality warrants the cost.
- [ ] iCloud sync, Apple Watch, Siri Shortcuts, brain-dump→3, marketing site.

---

## 6. KPIs to instrument from day one
- Activation: % new users who create a goal; % who complete day-1 first win.
- Engagement: D1/D7/D30 retention (benchmark against Finch-class loop, not generic productivity).
- Monetization: trial-start rate, trial→paid %, monthly vs annual mix, ARPU, AI cost/user/day, margin.
- Goal health: avg milestones completed, % goals reaching a milestone, miss-recovery rate.
- Guardrail: churn (watch the AI +30% churn risk), uninstall reasons, reminder opt-out rate.

---

## 7. Key risks & how the plan handles them
- **AI cost > revenue** → cheap model for daily, cache, one call/day, gate behind paywall.
- **AI churns fast** → Finch-grade emotional retention + visible goal progress.
- **Complexity kills the calm** → Goal mode is a toggle; default stays dead-simple; cap at ~3 goals.
- **Generic AI tasks feel hollow** → strong structured prompts w/ goal+history; user can always edit.
- **Privacy positioning vs. cloud AI** → proxy (no key in app), send minimal data, opt-in, disclose.
- **Offline / API down** → always fall back to the local catalog; app never breaks.

---

## 8. Locked decisions (2026-05-30)
1. **Model:** Free simple app (manual 3 tasks) + **paywalled Goal mode**. Free tier stays genuinely useful.
2. **AI:** Anthropic Claude — **Haiku for `/daily`**, **Sonnet for one-time `/plan`**. Backend proxy holds the key.
3. **Pricing:** **14-day trial → $4.99/mo · $29.99/yr (hero)**; lifetime deferred until AI cost/user is measured.
4. **Gamification:** **Lean in** — the "Journey" system (growth visual, showed-up streak, milestone
   celebrations, light cosmetic XP/levels), isolated from the calm Today screen.

See `Momentum_Build_Spec_Phase2-3.md` for the concrete Phase 2–3 implementation spec.

---

### Sources (research)
- RevenueCat — State of Subscription Apps 2026 (Productivity): https://www.revenuecat.com/state-of-subscription-apps-2026-productivity/
- Business of Apps — App Subscription Trial Benchmarks: https://www.businessofapps.com/data/app-subscription-trial-benchmarks/
- Adapty — State of in-app subscriptions: https://adapty.io/blog/state-of-in-app-subscriptions-2025-in-10-minutes/
- Finch $30M ARR teardown: https://blog.sparrowapps.io/p/finch-how-a-self-care-app-hit-30m-arr-without-vc-money
- Reclaim — Best goal tracker apps (Dreamfora, Mentor, Motion, etc.): https://reclaim.ai/blog/goal-tracker-apps
- Hatch Tribe — AI goal-setting apps: https://www.hatchtribe.com/blog/10-ai-goal-setting-apps-that-actually-help-you-achieve-your-goals-guide
- Sunsama / Motion pricing: https://www.sunsama.com/pricing
