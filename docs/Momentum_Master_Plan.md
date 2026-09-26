# Momentum — Master Plan (Profitability + AI Goals)

> Merges `momentum_prd_v8.docx` (PRD) + `docs/product-roadmap.md` (roadmap) into one strategy
> aimed at making the app profitable, built around AI-driven goal achievement.
> Companion docs: `docs/momentum-ai-proxy.md` (AI plumbing), `docs/momentum-prd-roadmap.md` (PRD roadmap).
> Last updated: 2026-09-26. **§0 (September 2026 review) is the current plan. Where it conflicts
> with §1–§8, §0 wins; the conflicting parts of §3, §5 and §8 have been updated to match.**

---

## 0. September 2026 review: revamp plan to start making money

### 0.1 Where we actually are (data, 2026-09-26)
- **App Store Connect, last 30 days:** 2 first-time downloads, ~100 impressions, 15 product-page
  views. The 30 days before: ~14 downloads. (The developer-account lapse overlaps this window, so
  it is somewhat understated, but the run-rate is ~10–20 installs/month.)
- **Live version is still 1.0.1.** 1.0.10 (build 34) was submitted for review on 2026-09-26 with
  new screenshots, an updated privacy policy (gist) and an App Privacy label of
  "Other User Content: App Functionality, not linked, no tracking".
- **No payments and no analytics exist yet**, so there is no revenue and no way to see what works.

**The money math.** Revenue ≈ installs × download→paid % × price. Paywalled productivity apps
typically turn ~2–4% of installs into payers in the first month; at $29.99/yr less Apple's 15%
that is **~$500–1,000 in first-year revenue per 1,000 installs** (with the Small Business
Program's 15%). Reaching ~$2k/month needs **~2,000–4,000
installs/month, ~100–400× today**. A paywall alone won't get there: **acquisition is the main job.**

### 0.2 What works (keep)
- **Clear, explainable core:** "just 3 things today", lock, rollover. Anti-backlog. It fits the
  *overwhelmed* user, which is the best-paying planner niche (Tiimo, Apple's 2025 iPhone App of
  the Year, and Structured both sell on "ADHD-friendly").
- **The AI works:** specific, relevant suggestions in ~8s via Claude Haiku (when the Render free
  tier is warm; a cold start adds ~50s, fixed by the paid tier in §0.6).
- **AI is cheap:** ~$0.004 per call, so ~$0.10–1 per user per month even for heavy use. The earlier
  worry that AI cost eats margin (and the reason for deferring lifetime pricing) doesn't hold up.
- **No sign-up, data stays on device**, so there's little friction to start.
- **Solid engineering:** TypeScript, 127 tests, two-reviewer PR process. Cheap to revamp.

### 0.3 What's holding it back
1. **Three names.** "3 Daily Tasks Manager" (store), "Daily Tasks" (home screen), "Momentum"
   (in app; also a crowded name on the App Store). The store name reads as a utility, not
   something worth paying for.
2. **Today screen buries the product.** On an iPhone Pro Max the hero, the lock card, the AI
   suggestions card (before the day is locked) and the check-in card push the tasks below the fold;
   task 3 isn't visible. The copy mixes a warm coach with stern
   "accountability" language.
3. **Thin AI value.** Three suggested tasks a day is something people can think of themselves.
4. **Weak emotional hook.** The Journey is emoji plants and XP numbers; Finch's hook is a character
   people care about.
5. **Lives only inside the phone app.** For a 3-item app the widget should be the product. No
   widgets, Live Activity, Watch, Mac or sync, and iPad is the phone layout stretched.
6. **No payments, no analytics.**

### 0.4 Changes to the earlier plan
- **Paywall at the end of onboarding, with a close button** (replaces "value moments only",
  §3.3). Most trials start on install day; waiting days for a value moment loses most conversions.
- **Sell a bundle, not "AI goal mode":** AI helpers + widgets + cross-device sync + companion
  cosmetics.
- **Offer lifetime now** (~$59.99–79.99) for upfront cash; AI cost doesn't justify deferring it.
- **Acquisition starts now** (listing work this week, new listing ships with v1.1), not after v1.2.

### 0.5 The revamp

**Positioning & brand**
- Target the overwhelmed: "3 things a day, for busy or overwhelmed brains."
- **One name everywhere** (store, home screen, in app) with a keyword-rich subtitle, e.g.
  "Just Three: ADHD Daily Planner". Check availability before committing.

**Today screen**
- The three tasks become the hero: big cards, one-tap complete with animation, haptic and sound.
- Streak/level shrink to one small chip; lock and check-in collapse into one line.
- Suggestions move into a "Need ideas?" sheet.

**Companion (replaces emoji Journey visuals)**
- An illustrated plant or creature that grows as you finish days and lives on the Today screen.
- Paid cosmetics for it are a natural premium item. Budget ~$500–2,000 freelance
  (illustration + Rive animation).

**The daily ritual (this is the product)**
- **Morning, ~30s:** brain dump by voice or text → AI picks your 3 and parks the rest → lock.
- **Evening, ~20s:** check-in that tunes tomorrow.

**AI features worth paying for**
- **Brain dump → 3** (above).
- **"Break it down":** any task → 3–5 tiny steps (proven with ADHD users).
- **Weekly letter** from the coach.
- **Goal plan shown as a visible path** you move along.

**Devices (most of the retention and premium value)**
1. **Interactive home & lock-screen widgets:** see and check off tasks without opening the app.
   Top priority. Needs a native widget extension + App Group shared storage (Expo supports this
   via a config-plugin target); today's state lives in AsyncStorage, which a widget can't read.
2. **Live Activity / Dynamic Island** for the current focus.
3. **Mac:** enable "iPhone & iPad apps on Apple Silicon Macs" in App Store Connect (nearly free).
4. **iCloud sync** + a real two-column iPad layout.
5. **Later:** Apple Watch complication, Android (Expo already supports it).

**Pricing**
- **Free:** the 3-task core + one basic widget.
- **Plus:** $4.99/mo or $29.99–39.99/yr with a 7-day trial on annual, plus lifetime
  ~$59.99–79.99. Includes AI helpers, all widgets + Live Activity, sync with iPad/Mac, the
  companion, history & insights.
- **Grandfather existing users** (a few dozen) so they keep AI access.
- **Enroll in Apple's Small Business Program** (15% commission instead of 30%).

**Acquisition**
- **Listing:** new name, subtitle, keywords, and captioned benefit screenshots (the 1.0.10 set is
  plain captures).
- **Rating prompt** after a perfect day.
- **Short video:** 30 days of daily TikTok/Reels on "I only do 3 things a day" + the companion.
- **Communities:** Product Hunt launch; Reddit productivity/ADHD communities within their
  self-promotion rules.
- **Apple Search Ads** only once the paywall works: ~$10–20/day to measure cost per install vs.
  revenue per user.
- **Later:** localization (Spanish, German, Japanese), referrals.

### 0.6 Phased plan

| When | What |
|---|---|
| **This week (1–2 days)** | **Live-ops hardening:** Anthropic spend cap + alerts, rotate the API key, enable `PROXY_SHARED_SECRET` (the endpoint is currently open to anyone: no shared secret, only a 30/min per-IP rate limit), Render paid tier ($7/mo, kills the ~50s cold start). Analytics: default **PostHog** (§0.9). Small Business Program. Mac availability. Decide name + subtitle after an availability check and prepare captioned screenshots; these ship with the first version after 1.0.10 is approved. |
| **Weeks 1–3: v1.1 "money MVP"** | RevenueCat + onboarding paywall + trial + restore purchases. Grandfather pre-paywall users. Instrument the §6 KPI events alongside the paywall. Today-screen revamp. Brain dump + break-it-down. First interactive widget. Rating prompt. New name/subtitle/screenshots. |
| **Weeks 4–8: v1.2** | Companion revamp. Live Activity. iCloud sync + iPad layout. Weekly review. Start daily short videos and a small Search Ads test. |
| **Months 3–4** | Android, Watch, localization, referrals. |

### 0.7 Targets that tell us it's working
Instrument the §6 KPIs with the paywall; these are the pass/fail lines:
- Day-1 retention ≥30%, day-7 ≥15%.
- ≥10% of installs start a trial; ≥35% of trials convert to paid.
- Growth spend per install below what an average user pays.

### 0.8 Skip for now
Multiple goals, the Sonnet/Haiku two-model split, heavier gamification. Measure first.

### 0.9 Open decisions
- Final app name + subtitle: decide this week after an App Store availability check.
- Annual price point: launch at $29.99; test $39.99 once analytics exist.
- Analytics tool: default PostHog; TelemetryDeck if a lighter, privacy-first tool is preferred.

### 0.10 Housekeeping found in the review
- PR #30 (Baloo 2 fonts) is superseded by PR #27's Fredoka/Nunito fonts. Close it.
- `Momentum_Build_Spec_Phase2-3.md` (referenced in §8) is not in the repo.
- `docs/privacy-policy.md` is out of date vs. the published gist policy.
- Calendar on iPad: dates are correct (fixed in PR #32) but cells are oversized.

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
> **Deferred (§0.8):** stay single-goal until the core loop is monetizing.

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
sized tasks + one encouraging line. See `docs/momentum-ai-proxy.md` and `server/providers/plan-contract.mjs` for the exact contract.
The *self-updating prompt* is literally the loop in §2.2 step 4.

---

## 3. Monetization model

### 3.1 Recommended: free trial → paywall (not indefinite freemium)
> **Revised 2026-09-26 (§0.4–0.5):** premium is a bundle (AI helpers + widgets + sync +
> companion), not only AI Goal mode; trial is 7 days on the annual plan.

Research: hard/direct paywalls convert 5× better with similar retention; AI raises revenue-per-payer.
Goal mode is expensive to give away (AI cost) and is the clearest value — gate it.

- **Free (no trial needed):** the current simple app — manual 3 tasks/day, calendar, streaks,
  reminders, lock, rollover. Genuinely useful, builds trust, drives word-of-mouth. Keep ~7–14 days
  of history free.
- **Trial:** ~~**14-day**~~ *(superseded: 7-day on annual, §0.5)* full-access trial of Goal mode on first goal creation (research: 17–32-day
  trials convert best; our AI cost is mostly the one-time plan + cheap Haiku dailies, so 14 days is
  affordable). No credit card to start if possible, then paywall at end. A/B toward 21 days later.
- **Premium ("Momentum+"):** AI Goal mode, multiple goals, full history, weekly insights, widgets,
  themes, focus timer, advanced reminders.

### 3.2 Pricing (LOCKED for launch)
> **Revised 2026-09-26 (§0.5):** $4.99/mo · $29.99–39.99/yr · **lifetime ~$59.99–79.99 offered
> now**. Haiku costs ~$0.004/call (~$0.10–1/user/month), so AI cost no longer justifies deferring
> lifetime. **Haiku only for now** (both plan and daily); the Sonnet split is deferred (§0.8).

- **$4.99/mo · $29.99/yr (hero) · lifetime deferred.** Above the roadmap's old $1.99/$14.99 because
  goal-achievement + AI carries higher willingness-to-pay than a checkbox app.
- **Anchor the annual plan** (~50% off monthly, best LTV); monthly for low-commitment.
- **Lifetime deferred** until AI cost/user is measured — a one-time payment against perpetual AI
  inference is a margin trap. Revisit ~$79.99 with an AI "fair-use" cap once we have real numbers.
- Unit economics: **Haiku for `/daily`, Sonnet for one-time `/plan`**; cache; **one `/daily` call
  per user per day max**. AI cost/user/day must stay well under daily revenue.

### 3.3 Paywall placement (no dark patterns — protects the calm brand)
> **Revised 2026-09-26 (§0.4):** show the paywall at the **end of onboarding, with a clear close
> button** (most trials start on install day), and keep it at the value moments below as well.

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
Last updated: 2026-09-26 · Live on the App Store at **v1.0.1**; **v1.0.10 (build 34) submitted for
review 2026-09-26**. **The v1.1+ sections below are superseded by the phased plan in §0.6**; they
are kept for their detail.

### ✅ Built (v1.0.10 — in App Review as of 2026-09-26)
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
- [ ] ~~**14-day trial → paywall on AI Goal mode**, shown at value moments~~ *(superseded: 7-day
      annual trial, onboarding paywall with close button, bundle — see §0.4–0.5)*
- [ ] **Grandfather existing users** — anyone who onboarded pre-paywall keeps AI access
      (protects the young listing from 1-star "you took my feature" reviews).
- [ ] **Analytics** (RevenueCat metrics + lightweight privacy-friendly tracker, e.g.
      Aptabase/PostHog): trial-start, trial→paid, D1/D7/D30, activation. Ship WITH the paywall.
- [x] ~~**Merge the premium look** (PR #30)~~ *(done: fonts shipped in PR #27; close PR #30 — §0.10)*
- [ ] Pricing at launch: **$4.99/mo · $29.99/yr** · ~~lifetime deferred~~ *(superseded: lifetime
      offered now — §0.5)*

### 🟡 v1.2 — THE "WORTH IT" RELEASE (justify the subscription)
- [ ] Weekly insights (completion rate, best days, goal velocity) — as premium content.
- [ ] Widgets (home + lock screen), themes, alt icons, focus timer — as premium content
      *(revised: one basic widget is free; the first interactive widget moves to v1.1 — §0.5–0.6)*.
- [ ] Advanced reminders (quiet hours, tone).
- [ ] ~~**ASO pass**~~ *(moved to this week / v1.1 — §0.6. Screenshots: iOS 18.6 simulators render
      emoji correctly, so a real device isn't required.)*

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
> **Revised 2026-09-26:** decision 3 (pricing) is superseded by §0.5 (bundle, 7-day annual trial,
> lifetime offered now). Decision 1 stands but the paywall sells a bundle, not Goal mode alone
> (§0.4). Decision 2 is **Haiku only for now**; the Sonnet `/plan` split is deferred (§0.8).
> Decision 4 stands, with the Journey visuals evolving into the companion (§0.5).

1. **Model:** Free simple app (manual 3 tasks) + **paywalled Goal mode**. Free tier stays genuinely useful.
2. **AI:** Anthropic Claude — **Haiku for `/daily`**, **Sonnet for one-time `/plan`**. Backend proxy holds the key.
3. **Pricing:** **14-day trial → $4.99/mo · $29.99/yr (hero)**; lifetime deferred until AI cost/user is measured.
4. **Gamification:** **Lean in** — the "Journey" system (growth visual, showed-up streak, milestone
   celebrations, light cosmetic XP/levels), isolated from the calm Today screen.

(The Phase 2–3 build spec, `Momentum_Build_Spec_Phase2-3.md`, was never added to the repo.)

---

### Sources (research)
- RevenueCat — State of Subscription Apps 2026 (Productivity): https://www.revenuecat.com/state-of-subscription-apps-2026-productivity/
- Business of Apps — App Subscription Trial Benchmarks: https://www.businessofapps.com/data/app-subscription-trial-benchmarks/
- Adapty — State of in-app subscriptions: https://adapty.io/blog/state-of-in-app-subscriptions-2025-in-10-minutes/
- Finch $30M ARR teardown: https://blog.sparrowapps.io/p/finch-how-a-self-care-app-hit-30m-arr-without-vc-money
- Reclaim — Best goal tracker apps (Dreamfora, Mentor, Motion, etc.): https://reclaim.ai/blog/goal-tracker-apps
- Hatch Tribe — AI goal-setting apps: https://www.hatchtribe.com/blog/10-ai-goal-setting-apps-that-actually-help-you-achieve-your-goals-guide
- Sunsama / Motion pricing: https://www.sunsama.com/pricing
