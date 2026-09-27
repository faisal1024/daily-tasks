# Deep dive: what it takes for people to use this daily and pay for it

_27 September 2026. State of the app: v1.0.11 (Phases 1–7) on TestFlight. Four
independent audits (product/monetization, UX/design on the real app, architecture/code,
market/growth with sources), combined here into one plan. Supersedes §0.6 of the master
plan from Phase 8 on._

## 0. Status (updated as phases land)

Legend: ✅ done · 🔄 in progress · ⬜ not started · ⏸ blocked on the owner

### Done
- ✅ **Phase 1** — AI proxy hardening: shared secret (log mode), rate limits, testable server (PR #34)
- ✅ **Phase 2** — Today-screen revamp, rating prompt, UI test infrastructure (PR #35)
- ✅ **Phase 3** — AI helpers: brain dump → three, break it down (PR #36)
- ✅ **Phase 4** — Plus paywall (RevenueCat, dormant until keys), grandfathering, anonymous analytics (PR #37)
- ✅ **Phase 5** — Home + lock-screen widgets with tap-to-complete (PR #38)
- ✅ **Phase 6** — Weekly review, iPad two-column Today, shorter AI steps (PR #39)
- ✅ **Phase 7** — New app icon everywhere (PR #40)
- ✅ **Live ops** — proxy secret on Render, Anthropic key rotated, $20/mo spend cap, PostHog project (IP discard on)
- ✅ **Release** — 1.0.10 live on the App Store; 1.0.11 (build 38) on TestFlight
- ✅ **Phase 8** — Foundation fixes: data safety, one day rule (travel / midnight / wrong dates), error screen, reminders ahead, UX quick wins (PR #44); privacy policy published 27 Sept 2026

### Left
| Phase | Status | Notes |
|---|---|---|
| 8 — Foundation fixes | ✅ done | PR #44; TestFlight build after merge |
| 9 — The ritual | ✅ Done (PRs #47, #48) | 9a: morning hero + draft, evening close, coach memory, Day N, milestones; 9b: onboarding + Calendar/Reminders |
| 10 — Today revamp + IA | 🔄 10a done (PR #49), 10b next | decisions made (§6) |
| 11 — Money & cost controls | ⏸ | code can start; going live needs App Store Connect setup (Paid Apps agreement, tax form, In-App Purchase key) and a Cloudflare account |
| 12 — Name, listing, launch | ⬜ | name chosen: **Three Today** (§6) |

### Owner to-dos outside the code
- ⏸ App Store Connect: renew the Paid Apps Agreement, W-9 tax form (after bank processing), generate the In-App Purchase key (.p8) for RevenueCat
- ⏸ RevenueCat: confirm the account email; connect the App Store app once the key exists
- ⬜ Test 1.0.11 on your phone via TestFlight (widget layout on device, next-morning widget ticks)
- ✅ Answer the decisions in §6 (27 Sept 2026)
- ⬜ Create a free Cloudflare account (for Phase 11's proxy move)

## 1. Diagnosis (where all four audits agree)

**The product has one real differentiator, and it's hidden.** The thing Things, Todoist,
Structured and Tiimo don't do is *decide for you*: dump everything → the app picks three →
lock → the day resets tomorrow with no overdue debt. Reviews of the tiny "3 things" apps
name exactly this hook ("the daily reset removes the snowball of shame", "the first one that
stuck"). In our app it lives behind two buttons under three empty slots, and onboarding
spends five screens and eight required inputs before showing any of it.

**Nobody with scale owns "AI picks your three, calm, with widgets."** Structured (4.8★, 167K)
and Tiimo (~$80/yr) are time-block-heavy and users complain about rigidity; Finch owns the
companion; the "3 things" apps are hobby-grade (no AI, weak widgets, ≤$12/yr). The gap is
"Structured's polish, Finch's gentleness, Goblin's breakdown, in a 3-slot loop."

**The Plus bundle is "helpers", and helpers don't convert.** Ranked by willingness to pay,
the current Plus features are medium-to-low: widget tick-off, break-it-down, AI brain dump
(the free on-device split satisfies the free user), weekly patterns (needs 4 weeks of data),
regenerate ideas. People subscribe to a *system that keeps working for them*, not to buttons.

**Paywall placement matters more than price.** RevenueCat 2026: hard/early paywalls
convert 10.7% of downloads to paid at day 35 vs 2.1% for freemium, with equal 1-year
retention; revenue per install $3.09 vs $0.38. A solo dev in this category found
onboarding-before-paywall "tanked conversion". Our plan shows the paywall after a 5-screen
form and before the user has seen the app.

**The UI looks like a good free app, not a $30/yr one.** Generic indigo template palette,
three typefaces, emoji as iconography, a Today screen that is ~40% empty with no visual
idea, XP/levels/"Looks" that do nothing, four tabs where two are both "history". The
anti-guilt copy in `coach-messages.ts`, our best asset, is barely used on screen.

**Engineering is solid; no rewrite.** `tsc` clean, 657 tests green, pure domain modules.
The problems are ceilings: single-blob storage that silently wipes on corruption, a
midnight duplication bug, no crash reporting, no server-side entitlement, Render cold
starts on the headline feature, reminders that only cover today.

**The name has to change.** "Momentum", "Just Three" and "Three Things" are all taken on
the App Store. "3 Daily Tasks Manager" reads like a utility.

## 2. The product we're building

**Wedge:** "3 things a day for overwhelmed minds." ADHD-friendly in keywords, description
and screenshots, never in the name, no clinical claims (Apple and r/ADHD both punish it).
Not "ADHD scheduling" (Tiimo/Structured own it): **"ADHD deciding"** — the app decides
what matters, you just do it.

**The daily ritual is the product:**
- **Morning (30 s):** one screen, "What's on your mind?" (voice or text) → three tasks with
  a one-line "why now" and a time estimate, the rest parked → one tap to set the day. The
  prompt knows yesterday's carry-over, today's calendar/Reminders (EventKit read), the goal,
  and a rolling coach memory.
- **Day:** the widget *is* the app. Next task as the hero; tick off from the Home/Lock
  Screen; Live Activity for the current task (later).
- **Evening (20 s):** always available, especially on a 0/3 day. One question, three faces.
  The coach writes a two-line note and pre-drafts tomorrow's three. Next morning: "Because
  yesterday was hard, today is lighter: …" — proof the coach remembers is the subscription
  justification.
- **Never punished:** streak counts *planning* as showing up; daily reset; no overdue badges.

**What's free vs Plus (soft-hard paywall):** free = manual three, lock, reset, calendar,
view-only widget, 3 AI brain dumps total. Plus = the morning AI plan every day, evening
close that drafts tomorrow, break-it-down, widget tick-off, insights. Trial: 7 days, full
access, started right after the first "aha" in onboarding.

**Pricing:** $4.99/mo · **$34.99/yr** (test $29.99 vs $39.99 once PostHog has data) ·
lifetime **$79.99**, shown only on the Settings paywall (at $59.99 it cannibalises annual).
Day-5 "2 days left" notification; day-7 win-back with a 3-month intro offer ($9.99).
Existing users stay grandfathered.

## 3. The plan (in order)

Each phase = one PR, tester agent + 3 reviewers, merge, TestFlight when noted.

### Phase 8 — Foundation fixes (~1 week) → TestFlight
Engineering quick wins:
- ✅ Backup + quarantine: corrupt data is set aside (never overwritten) and the backup restored;
  unreadable storage → use the backup and don't write that session; the backup is refreshed only
  after a session runs fine.
- ✅ One day rule (`storeDayFor`): clock ahead → new day; one day back (travel) → hold the saved
  day; 2+ days back (a fixed wrong date) → follow the clock. Used at launch, at midnight and in
  rollover. Taps and the evening check-in made just after midnight count for the day on screen.
- ✅ Root ErrorBoundary (calm fallback, anonymous `app_error` event). ⏸ Sentry: needs a
  Sentry account + DSN; add when created.
- ✅ Reminder syncs run one at a time; a morning nudge is scheduled for each of the next 6 days.
- ✅ Privacy policy reconciled with PostHog + RevenueCat + widget and published (gist,
  27 Sept 2026). ⬜ App Store privacy label: add Usage Data › Product Interaction and
  Purchases › Purchase History (not linked, not tracking) before the next App Store submission.
UX quick wins:
- ✅ Saved brain-dump ideas reachable when the day is full ("Saved for later (N)").
- ✅ Inline **Unlock** next to the lock status (was Settings-only); lock copy updated.
- ✅ Rating prompt waits for a later app open (≥ 1 h after the perfect day); "Missed" removed
  from the perfect-day check-in.
- ✅ Emoji → icons in titles/sections; "Looks" cosmetics removed; tabs "Today" / "Progress";
  after-midnight greeting "Hello" (was "Good night"), 9 pm–midnight is "Good evening".
- ✅ Follows system Light/Dark live; header uses live window width.

### Phase 9 — The ritual (~2–3 weeks) → TestFlight
- **Onboarding rebuilt:** dump → three → set → "want a nudge?" (notification) → "add the
  widget" → paywall with trial. Goal/name/struggle asked later, in context. Step events.
- **Morning plan as the Today hero:** the single conversational entry replaces the
  "Need ideas / Brain dump" buttons; suggestions become the primary flow.
- **Evening close, always available**, with a persisted `coachMemory` (rolling summary)
  that pre-drafts tomorrow and explains "because yesterday…" next morning.
- **Content-bearing morning notification** ("Your three for Tuesday: …").
- **Streak counts planning as showing up**; XP/levels collapse into one "Day N" chip.
- **Milestones you complete yourself** (checkbox + "what did you do?"), no auto-advance.
- **EventKit read** of today's Reminders/Calendar into the plan prompt.

### Phase 10 — Today revamp + information architecture (~2 weeks) → TestFlight
- Today as **one calm card** (three rows, not three cards), large-title "Today" with the
  date, no gradient header. Once set: the *next undone task* is the hero, done rows collapse;
  "Break it down" and "Not today" as small secondary actions. Evening/perfect-day state gets
  the one gradient in the app. Rows: swipe to delete, tap to edit, no pencil/trash icons.
- **Progress tab = Calendar + Journey merged:** weekly review, month grid, milestone path.
- One typeface family (SF Rounded/Nunito; Fredoka only for the hero number, or dropped);
  accent colour reserved for the "done" moment; Dynamic Type via text styles; Reduce Motion;
  `DatePicker` for the auto-lock time; today's list and lock toggle out of Settings.
- Rollover sheet simplified (one decision, not six controls); lock vocabulary unified ("Set").

### Phase 11 — Money & cost controls (~1–2 weeks) → TestFlight
- Paywall right after the aha; AI brain dump into Plus with 3 free uses; drop the
  weekly-review gate; pricing above; day-5 nudge + win-back offer.
- **Server-side entitlement:** app sends RevenueCat `appUserID`; proxy checks
  `/v1/subscribers/{id}` (1 h cache), keys rate limits by user, `SECRET_MODE=enforce`;
  promotional entitlement for grandfathered users.
- **Proxy to Cloudflare Workers** (no cold starts, KV rate limits + plan cache, upstream
  timeout, cost logging). Alternative: Render Starter $7/mo.
- Trim the plan schema, few-shot examples per tone.

### Phase 12 — Name, listing, launch (~1 week)
- New name + subtitle (candidates below), captioned benefit screenshots (screenshot 1 says
  "daily reset, no overdue debt"; widgets featured), ASO keywords, EULA link in description,
  Small Business Program, "What's New".
- Organic TikTok/Reels "wall of tasks → 3" transformation clips; Apple Ads only on
  "3 things"/"daily focus" long-tail at ≤$3 CPI.

### Later (measure first)
Live Activity (native, after widgets prove signing/adoption) → Apple Watch complication →
CloudKit sync (private DB, per-record `updatedAt`; prerequisite: split the storage blob) →
localization + purchasing-power pricing (drove a peer to $1K MRR) → Android.
Not now: accountability partners, multiple goals, companion art (illustration budget).

## 4. Name candidates (verify in App Store Connect + USPTO before committing)
Taken: Momentum, Just Three, Three Things, Daily Three (confusingly close).
Available-looking: **Trio — 3 Tasks a Day** · **Threefold — Daily Focus** ·
**Three Today — Focus Planner** · **Rule of Three — Daily Tasks** · **Enough — 3 tasks a day**.
Subtitle pattern: keyword-rich, ≤30 chars, e.g. "Brain dump to 3 tasks".

## 5. Targets (unchanged from §0.7, now instrumented)
D1 ≥ 30%, D7 ≥ 15%; ≥ 10% of installs start a trial; ≥ 35% trial → paid; annual ≥ 70% of
subscriptions (category norm 77%). Watch AI monthly churn (36% worse in RC data): keep AI
the accelerator, not the whole value.

## 6. Decisions (made 27 Sept 2026)
1. **Name: Three Today** — App Store name "Three Today: 3 Tasks a Day", subtitle "Brain dump
   to your daily three" (verify availability in App Store Connect in Phase 12). Chosen for the
   sunrise icon, search terms "three"/"today", and clarity; "Trio" clashes with an existing
   app, "Enough" has no search intent.
2. **Pricing:** $4.99/mo, $34.99/yr (7-day trial), $79.99 lifetime shown only in Settings.
3. **Paywall:** morning AI plan behind the 7-day trial; 3 free AI brain dumps.
4. **Calendar/Reminders read access:** yes (Phase 9).
5. **XP/levels/"Looks":** dropped; one "Day N" chip (Looks removed in Phase 8, chip in Phase 9).
6. **Proxy hosting:** Cloudflare Workers — its free tier (100k requests/day, no cold starts)
   is cheaper than Render Starter ($7/mo). Phase 11.

## Sources
Audit reports: product (internal), UX walk-through (20 screenshots), engineering, and market
brief citing RevenueCat State of Subscription Apps 2026 (productivity), RevenueCat trial-length
and hard-paywall analyses, App Store listings/reviews for Structured, Tiimo, Llama Life, Focus
Bear, Finch, 3ThingsPal, "To do list – 3 Things", Sparrow's Finch teardown, AppTweak Apple Ads
benchmarks, Grand View ADHD-apps market report, and Reddit self-promotion rule studies.
