# Momentum Plus (paywall) and analytics

Phase 4 of the revamp (docs/Momentum_Master_Plan.md §0.6). Both features are
**dormant until their keys are set**: a build without them behaves exactly like
1.0.10 (everyone has every feature, nothing is sent).

## What's free and what's Plus

| Free | Plus |
|---|---|
| Today's three, set/change, rollover, history, streaks, reminders, progress | AI brain dump sorting, Break it down, AI goal ideas ("New ideas", "Refresh with AI"), AI evening close, plan around your calendar |
| Brain dump: the first-run sort + 3 AI sorts to try (per install, `lib/daily-tasks/free-uses.ts`), then the simple on-device split | |
| Goal ideas from the on-device template plan | |
| Home/lock-screen widgets (view today, progress, next task) | Tick tasks off from the widget |
| Weekly review, including patterns (Progress tab), free since Phase 11a | |

- **Grandfathering:** anyone whose saved data predates the paywall, or who used an iOS
  build older than `GRANDFATHER_BEFORE_VERSION` (1.1.0) without a RevenueCat key, keeps
  Plus for free (`AppState.plusGrandfathered`). Resetting data keeps the flag. From 1.1.0
  on, a build missing the key never grandfathers anyone. Android isn't grandfathered
  (no Android paywall yet).
- **While RevenueCat is still answering at launch** nobody is gated (a subscriber must
  never see the paywall by mistake); the automatic AI fetch waits for a confirmed answer.
- After the paywall closes, the gated action resumes: Break it down runs if the user now
  has Plus, and the brain dump / ideas sheet reopens.
- **Paywall placement:** once at the end of first run (closable), and at value moments:
  Break it down, "Get Plus" in the brain dump (only after the free sorts), "New ideas",
  the calendar setting, and Settings › Plus. Lifetime is shown only from Settings.
  Restore purchases is on the paywall and in Settings.
- **Onboarding paywall (1.3):** echoes what first run just did ("Your three are set." with
  three tasks, "Today's set." with one or two, then "Want help like this every
  morning?"); with no tasks set ("I'll add my own") it falls back to the generic
  headline. The count is passed with `openPaywall("onboarding", { taskCount })`.
- **Trial timeline (1.3):** when the selected plan has a free trial the user is eligible
  for, a 3-step timeline sits under the plans: "Today · All of Plus, free", "Day N−2 · We
  remind you, with time to cancel", "Day N · {price}/year (or /month) starts. Cancel
  before then and you won't pay." (never "cancel anytime": Apple needs cancelling at
  least 24 h before the trial ends). The reminder step is left out when notifications
  aren't allowed or the trial is under 3 days (the reminder couldn't be sent). Never for
  lifetime, plans without a trial, or month/year-unit trials (only DAY/WEEK intro
  periods have a fixed day count). The reminder offset is `TRIAL_REMINDER_DAYS_BEFORE_END`,
  shared with `trial-reminder.ts`. VoiceOver reads it as
  one element (`trialTimeline` / `trialTimelineLabel` in `plus.ts`).
- **Aha paywall (1.3, source `aha`):** a gentle second offer, at most once per install,
  at the first real win after install day: using last night's draft, setting the day
  (Set, even with one or two tasks: it's a deliberate "my day is set" moment), or a
  brain dump that actually filled the day's three (checked against the task count
  after the add). Typing the third task by hand doesn't trigger it (too interruptive).
  Never on install day, never for Plus/trial/grandfathered or still-checking users,
  never within 24 h of any other paywall shown, never during first run, a rollover, a
  focus session (even paused), a sheet, another paywall, or with the app in the
  background (a pending offer is dropped when the app is backgrounded). Judged 1.2 s
  after the moment (so a closing sheet is gone). Rule: `lib/daily-tasks/aha-paywall.ts`; install day, "aha shown" and the last
  paywall time are kept in their own AsyncStorage keys (`plus-context.tsx`), so "Reset
  all data" doesn't re-arm it. Counted as shown only once iOS presents it.
- **Reset all data keeps the aha keys** (install day, aha shown, last paywall time),
  like the win-back flag: a reset never brings back the aha offer or the install-day
  grace.
- **Monthly nudge (1.3):** backing out of the yearly purchase (StoreKit "cancelled") shows
  one quiet line under the button, "Prefer to start small? Monthly, 7 days free." (the
  monthly plan's real trial; its price when it has none). Tapping selects monthly, it
  never buys. Once per paywall open; hidden once monthly is selected.
- **Trial reminder:** a local notification ~48 h before a free trial ends (daytime),
  skipped if the trial was cancelled or is family-shared.
- **Win-back:** at most two showings per lapse (RevenueCat's own expiry), each right
  after the user ticks a task on Today and counted only once iOS shows it:
  1. **Plain**, once, at least 2 days after the lapse. Apple's offer usually isn't
     eligible yet (see the lapse rule below), so this one normally shows the normal prices
     (if an offer is already eligible it shows it, and that spends showing 2 as well).
  2. **Offer**, once, later: for a lapsed user the app checks Apple's eligibility at most
     once a day, at that same post-tick moment, and opens the win-back paywall again only
     when an offer is available and no offer has been shown this lapse. No offer, no
     second showing. Seeing the offer on any paywall also spends it.
  The flags (plain shown, offer shown, last check day) are stored per lapse and survive
  "Reset all data", so neither showing is repeated.
- **Day-5 note:** during a free trial, from day 5 until it ends, Today shows one calm,
  dismissible note with what Plus did during the trial (counts only: brain dumps sorted,
  tasks broken down, coach notes, evening plans; `lib/daily-tasks/trial-note.ts`), the
  day the trial ends, and **Manage** (Apple's subscription sheet). Once per trial, in-app
  only (never a notification); nothing to set up. Day 5 = local midnight of the start day
  + 4 days, but never later than 4/7 of the trial (so a 3-minute sandbox trial shows it
  after ~2 minutes). Uses are counted only while a trial is running (kind and time only,
  kept 14 days, on this device); "Reset all data" removes them and the note's record.

## Win-back offer (App Store Connect, owner)

The app asks Apple (through RevenueCat, iOS 18+) whether a lapsed subscriber is eligible
for a win-back offer. If one exists, the paywall shows it, e.g. "3 months for $9.99, then
$34.99/year", and buys with it. With no offer (not created yet, iOS 17, not eligible, or
no answer within 1.5 s) the paywall shows the normal prices, exactly as before. An offer
with an unexpected shape (e.g. free for several cycles, no period, under one cycle) is
ignored and the plan shows its plain price. If buying with the offer fails (it may have
expired meanwhile) the paywall reloads the plans and says "That offer isn't available any
more. Here are the current prices."; it never buys at full price on the user's behalf.

1. App Store Connect › Three Today › Subscriptions › Three Today Plus › **plus_annual** ›
   Subscription Prices › Win-Back Offers › **Create** (the Paid Apps agreement must be active).
2. Suggested defaults (all editable later; change them any time in App Store Connect):
   - Reference name `winback_annual_3m`, offer ID `winback_annual_3m`.
   - Payment: **Pay up front**, **3 months** for **$9.99** (then the normal $34.99/year).
   - Eligibility: paid for at least **1 month** before; lapsed for the **shortest time
     App Store Connect allows that you're comfortable with; we suggest 1 week** (the
     plain win-back has already shown at day 2, so the offer is the second showing, and a
     long wait like 1 month means most lapsed users never see it while they still open
     the app); can redeem again after **1 year**. Leave "Promotion in the App Store" off
     at first.
   - Start now, no end date; all territories.
3. Optional: the same on `plus_monthly` (e.g. 2 months at $1.99/month, pay as you go).
4. RevenueCat: confirm the **In-App Purchase Key** is uploaded (Project settings › Apps ›
   Three Today › In-app purchase key configuration). StoreKit 2 purchases, and so
   win-back offers, need it. Otherwise RevenueCat picks offers up automatically: no
   offering change, no app update.
5. **Before relying on it:** buy the offer once in an iOS 18 sandbox (an account whose
   Plus has expired and meets the eligibility) and check the paywall's wording ("3 months
   for $9.99, then $34.99/year", the terms line, "Continue with offer") matches what
   Apple's sheet charges.

Analytics: a lapsed subscriber's `paywall_viewed` carries `offer` = true or false (whether
an offer was on screen; sent at the latest 3 s after the sheet shows); purchase events
bought with it carry `offer: true`.
- The AI proxy's Plus check (RevenueCat REST, `ENTITLEMENT_MODE`) arrives in Phase 11b.

## Code map

- `lib/daily-tasks/plus.ts`: pure access rule (`hasPlusAccess`), plan labels, terms copy.
- `lib/daily-tasks/purchases.ts`: RevenueCat wrapper (lazy native module, entitlement `plus`).
- `lib/daily-tasks/plus-context.tsx`: `PlusProvider` (entitlement + which paywall is open).
- `components/daily-tasks/paywall-sheet.tsx`: the paywall; `PaywallHost` mounts it at the root.
- `lib/daily-tasks/trial-note.ts` + `components/daily-tasks/trial-note.tsx`: the day-5 trial note.
- `lib/daily-tasks/analytics.ts`: PostHog HTTP capture, anonymous, allowlisted properties.

## Setup checklist (before a paywall build)

1. **App Store Connect:** sign the Paid Apps agreement (banking + tax). Create a
   subscription group "Three Today Plus" with `plus_annual` ($34.99/yr, 7-day free-trial
   introductory offer) and `plus_monthly` ($4.99/mo, 7-day free trial); plus a non-consumable
   `plus_lifetime` ($79.99, shown only from Settings). Enrol in the Small Business Program.
2. **RevenueCat:** create the project + iOS app (App Store Connect API key, and upload the
   **In-App Purchase Key**: needed for StoreKit 2 and win-back offers), entitlement **`plus`** attached to all three products, and a
   current offering with the `$rc_annual`, `$rc_monthly` and `$rc_lifetime` packages.
3. **PostHog:** create a project (US cloud), turn on *Discard client IP data*, copy the
   project API key. (Done: project 630531; key is in EAS production env.)
4. **EAS env (production):** `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (public SDK key) and
   `EXPO_PUBLIC_POSTHOG_KEY` (optionally `EXPO_PUBLIC_POSTHOG_HOST`).
5. **Privacy, before shipping that build:** update the published policy (analytics
   section: anonymous usage events, what's never sent, the Settings switch; purchases
   handled by Apple + RevenueCat with an anonymous id) and the App Privacy label
   (add Purchases › Purchase History and Usage Data › Product Interaction, both
   "not linked to you", "not used for tracking"). Add Apple's standard EULA link
   (https://www.apple.com/legal/internet-services/itunes/dev/stdeula/) to the App
   Description (App Review guideline 3.1.2 wants it in the metadata too).
6. Test with a Sandbox Apple ID: trial purchase, cancel, restore, Ask to Buy (pending).

## Events

`paywall_viewed` / `paywall_closed` carry `source`: `onboarding`, `aha`, `settings`,
`brain_dump`, `break_down`, `new_ideas`, `calendar`, `win_back`.

`app_opened` (once per day), `onboarding_completed`, `task_completed`, `perfect_day`,
`brain_dump_sorted`, `break_down_used`, `plus_gate_hit`, `paywall_viewed`,
`paywall_closed`, `paywall_monthly_nudge_tapped` (`source`), `purchase_started`, `purchase_completed`, `purchase_failed`
(failed or pending/Ask to Buy, with `outcome`), `purchase_cancelled` (the user backed
out of Apple's purchase sheet; `plan`, `source`, `trial`), `restore_completed`,
`redeem_code_opened`, `path_edited`, `path_regenerated`,
`rating_prompt_requested` (the system rating prompt was requested; `source` is the happy
moment that earned it: `focus_done`, `milestone`, `good_week` or `perfect_day`),
`rate_row_tapped` and `feedback_row_tapped` (Settings › Feedback),
`trial_note_shown` (`count` = Plus uses during the trial), `trial_note_dismissed`
(`action` = close or manage). Properties are limited to `source`, `plan`, `outcome`, `trial`,
`count`, `skipped`, `feature`, `active`, `plus`, `step`, `timer`, `offer` with short enum/number/boolean values. Never
task, goal or brain-dump text; no person profiles; `$ip` null, `$geoip_disable`, and
the project discards client IPs. Analytics starts off and is only enabled once the
saved Settings choice is loaded; resetting data keeps an opt-out and forgets the id.

Funnels: until 1.2 and older installs are gone, count a cancelled purchase as
`purchase_cancelled` OR (`purchase_failed` AND `outcome` = cancelled); 1.1/1.2 still
send the old shape.

## Subscription numbers (trials, renewals, refunds)

These happen server-side, so they're read in **RevenueCat Charts** (trial conversion,
initial conversion, active subscriptions, MRR, churn, refunds), not PostHog. The weekly
dashboard pairs RevenueCat Charts with the PostHog in-app funnel (installs → paywall →
purchase started/completed/cancelled).

We deliberately don't enable RevenueCat's PostHog integration: for customers without a
`$posthogUserId` attribute it falls back to the RevenueCat app user id, so purchase data
would reach PostHog even for people who turned "Share anonymous usage stats" off, and
the privacy policy and App Privacy answers say PostHog only gets usage counts. Revisit
only together with a privacy-policy and App Privacy update.
