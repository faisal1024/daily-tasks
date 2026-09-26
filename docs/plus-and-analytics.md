# Momentum Plus (paywall) and analytics

Phase 4 of the revamp (docs/Momentum_Master_Plan.md §0.6). Both features are
**dormant until their keys are set**: a build without them behaves exactly like
1.0.10 (everyone has every feature, nothing is sent).

## What's free and what's Plus

| Free | Plus |
|---|---|
| Today's three, lock, rollover, calendar, streaks, reminders, journey | AI brain dump sorting, Break it down, AI goal ideas ("New ideas", "Refresh with AI") |
| Brain dump with the simple on-device split | |
| Goal ideas from the on-device template plan | |

- **Grandfathering:** anyone whose saved data predates the paywall, or who used any
  build without a RevenueCat key, keeps Plus for free (`AppState.plusGrandfathered`).
  Resetting data keeps the flag.
- **Paywall placement:** once at the end of first-run onboarding (closable), and at
  value moments: Break it down, "Get Plus" in the brain dump, "New ideas", and
  Settings › Plus. Restore purchases is on the paywall and in Settings.
- The AI proxy does not check Plus yet (RevenueCat webhook → server check is a
  later step). The app just doesn't call the AI for free users.

## Code map

- `lib/daily-tasks/plus.ts`: pure access rule (`hasPlusAccess`), plan labels, terms copy.
- `lib/daily-tasks/purchases.ts`: RevenueCat wrapper (lazy native module, entitlement `plus`).
- `lib/daily-tasks/plus-context.tsx`: `PlusProvider` (entitlement + which paywall is open).
- `components/daily-tasks/paywall-sheet.tsx`: the paywall; `PaywallHost` mounts it at the root.
- `lib/daily-tasks/analytics.ts`: PostHog HTTP capture, anonymous, allowlisted properties.

## Setup checklist (before a paywall build)

1. **App Store Connect:** sign the Paid Apps agreement (banking + tax). Create a
   subscription group "Momentum Plus" with `plus_annual` ($29.99/yr, 7-day free-trial
   introductory offer) and `plus_monthly` ($4.99/mo); plus a non-consumable
   `plus_lifetime` (~$59.99). Enrol in the Small Business Program.
2. **RevenueCat:** create the project + iOS app (App Store Connect API key / in-app
   purchase key), entitlement **`plus`** attached to all three products, and a
   current offering with the `$rc_annual`, `$rc_monthly` and `$rc_lifetime` packages.
3. **PostHog:** create a project (US cloud), copy the project API key.
4. **EAS env (production):** `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (public SDK key) and
   `EXPO_PUBLIC_POSTHOG_KEY` (optionally `EXPO_PUBLIC_POSTHOG_HOST`).
5. **Privacy, before shipping that build:** update the published policy (analytics
   section: anonymous usage events, what's never sent, the Settings switch; purchases
   handled by Apple + RevenueCat with an anonymous id) and the App Privacy label
   (add Purchases › Purchase History and Usage Data › Product Interaction, both
   "not linked to you", "not used for tracking").
6. Test with a Sandbox Apple ID: trial purchase, cancel, restore, Ask to Buy (pending).

## Events

`app_opened` (once per day), `onboarding_completed`, `task_completed`, `perfect_day`,
`brain_dump_sorted`, `break_down_used`, `plus_gate_hit`, `paywall_viewed`,
`paywall_closed`, `purchase_started`, `purchase_completed`, `purchase_failed`,
`restore_completed`. Properties are limited to `source`, `plan`, `outcome`, `trial`,
`count`, `feature`, `active`, `plus` with short enum/number/boolean values. Never
task, goal or brain-dump text; no person profiles; `$ip` is dropped.
