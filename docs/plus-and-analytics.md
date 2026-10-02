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
- **Trial reminder:** a local notification ~48 h before a free trial ends (daytime),
  skipped if the trial was cancelled or is family-shared.
- **Win-back:** once per lapse (RevenueCat's own expiry), at least 2 days after it,
  right after the user ticks a task on Today; counted as offered only when shown.
- The AI proxy's Plus check (RevenueCat REST, `ENTITLEMENT_MODE`) arrives in Phase 11b.

## Code map

- `lib/daily-tasks/plus.ts`: pure access rule (`hasPlusAccess`), plan labels, terms copy.
- `lib/daily-tasks/purchases.ts`: RevenueCat wrapper (lazy native module, entitlement `plus`).
- `lib/daily-tasks/plus-context.tsx`: `PlusProvider` (entitlement + which paywall is open).
- `components/daily-tasks/paywall-sheet.tsx`: the paywall; `PaywallHost` mounts it at the root.
- `lib/daily-tasks/analytics.ts`: PostHog HTTP capture, anonymous, allowlisted properties.

## Setup checklist (before a paywall build)

1. **App Store Connect:** sign the Paid Apps agreement (banking + tax). Create a
   subscription group "Three Today Plus" with `plus_annual` ($34.99/yr, 7-day free-trial
   introductory offer) and `plus_monthly` ($4.99/mo, 7-day free trial); plus a non-consumable
   `plus_lifetime` ($79.99, shown only from Settings). Enrol in the Small Business Program.
2. **RevenueCat:** create the project + iOS app (App Store Connect API key / in-app
   purchase key), entitlement **`plus`** attached to all three products, and a
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

`app_opened` (once per day), `onboarding_completed`, `task_completed`, `perfect_day`,
`brain_dump_sorted`, `break_down_used`, `plus_gate_hit`, `paywall_viewed`,
`paywall_closed`, `purchase_started`, `purchase_completed`, `purchase_failed`,
`restore_completed`, `redeem_code_opened`, `path_edited`, `path_regenerated`,
`rating_prompt_requested` (the system rating prompt was requested; `source` is the happy
moment that earned it: `focus_done`, `milestone`, `good_week` or `perfect_day`),
`rate_row_tapped` and `feedback_row_tapped` (Settings › Feedback). Properties are limited to `source`, `plan`, `outcome`, `trial`,
`count`, `skipped`, `feature`, `active`, `plus`, `step`, `timer` with short enum/number/boolean values. Never
task, goal or brain-dump text; no person profiles; `$ip` null, `$geoip_disable`, and
the project discards client IPs. Analytics starts off and is only enabled once the
saved Settings choice is loaded; resetting data keeps an opt-out and forgets the id.
