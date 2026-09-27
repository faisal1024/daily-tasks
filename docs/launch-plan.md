# Three Today: launch plan (Phase 12)

What happens between "the code is done" and "people are paying", in order.
Things only the owner can do are marked **(you)**.

## 1. Before the paywall build ships (you)

App Store Connect (appstoreconnect.apple.com):
1. **Agreements, Tax and Banking** → accept the **Paid Apps** agreement → add the
   bank account → fill in the **W-9** tax form. (Plus can't be sold until this
   shows "Active".)
2. **Users and Access → Integrations → In-App Purchase** → generate an
   **In-App Purchase key** (.p8). Download it once; keep it safe.
3. **Apps → Three Today → Subscriptions**: create a subscription group
   "Three Today Plus" with two products, and one non-consumable:
   | Product | Product ID | Price | Offer |
   |---|---|---|---|
   | Monthly | `plus_monthly` | $4.99 | 7-day free trial (introductory offer) |
   | Yearly | `plus_annual` | $34.99 | 7-day free trial (introductory offer) |
   | Lifetime (In-App Purchase, non-consumable) | `plus_lifetime` | $79.99 | none |
   Give each a display name and a short description ("AI helpers for your daily three").
4. **App Store Small Business Program**: developer.apple.com → Programs →
   enrol (Apple's commission becomes 15% instead of 30%).

RevenueCat (app.revenuecat.com):
5. Confirm the account email. Create the project → add the iOS app
   (bundle `com.faisalislam.dailytasks`) → upload the In-App Purchase key.
6. Create the entitlement **`plus`**, attach all three products, and an offering
   "default" with packages `$rc_monthly`, `$rc_annual`, `$rc_lifetime`.
7. Copy the **public Apple API key** (starts `appl_`) into EAS:
   `eas env:create --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --environment production --visibility plaintext --value appl_...`
8. Create a **V1 secret key** (starts `sk_`) for the server (used later, step 11).
9. App Store Connect → App Information → App Store Server Notifications →
   paste the URL from RevenueCat → App settings → Apple Server Notifications.

## 2. The release (me, once 1 is done)

10. Build 1.1.0 with the RevenueCat key, send it to TestFlight, and test a sandbox
    purchase, restore, and the trial reminder.
11. Server: set `REVENUECAT_SECRET_KEY` and `GRANDFATHER_GRANTS_UNTIL` (about 6 weeks
    after release) on Render; later move to Cloudflare (docs/momentum-ai-proxy.md).
12. Listing: paste `docs/app-store-listing.md` (or `eas metadata:push`), upload the
    screenshots from `~/Downloads/three-today-appstore-screenshots/`, update the App
    Privacy label as listed there, add the review notes, submit.

## 3. First month

- **Week 1**: server `ENTITLEMENT_MODE=log`; watch PostHog: first-run completion,
  trial starts, D1.
- **Week 2**: `ENTITLEMENT_MODE=enforce` if the "id without Plus" count is near zero.
- **Targets** (from the deep dive): D1 ≥ 30%, D7 ≥ 15%, ≥ 10% of installs start a
  trial, ≥ 35% trial → paid, annual ≥ 70% of subscriptions.
- Answer every App Store review in the first month.

## 4. Getting the first users (organic first, then small ads)

### Short videos (TikTok, Instagram Reels, YouTube Shorts)
Format that works for this category: a messy "before" and a calm "after" in under
20 seconds, filmed on the phone with the screen recorder, captioned, no voiceover
needed. Post 3–4 a week for a month; keep what gets watched past 3 seconds.

| # | Hook (first 2 s, on screen) | What the video shows |
|---|---|---|
| 1 | "My to-do list had 47 things on it." | Scroll a long notes list → paste it into the first screen → the three appear → "the other 44 can wait". |
| 2 | "The app that tells me what NOT to do today" | Brain dump → untick one → "saved for later". |
| 3 | "No overdue tasks. Ever." | Next morning: yesterday's unfinished task → "Start fresh". |
| 4 | "ADHD brain vs 3 tasks" | Talk-to-type a ramble into the dump → three clean tasks. |
| 5 | "My whole day on my Lock Screen" | The widget; tick a task off from the Home Screen. |
| 6 | "It wrote tomorrow's list for me" | Evening check-in: tap "Hard" → tomorrow's three appear. |
| 7 | "Day 30" | The Day N counter and Progress page. |

Captions: plain, lowercase-friendly, one idea per video, end with "Three Today, free
on the App Store". Hashtags: #todolist #adhdtips #productivity #3things.

### Communities (be a person, not an ad)
- r/ADHD, r/productivity, r/getdisciplined: read each subreddit's self-promotion rules;
  most allow it only in weekly threads. Share what you learned building a 3-task app,
  not a download link.
- Indie Hackers / X (#buildinpublic): monthly numbers (installs, trials, revenue).

### Apple Search Ads (only after the listing converts organically)
- Start with **Search Results**, a $5–10/day cap, exact match only, max CPT $1–1.50,
  and a target of ≤ $3 per install.
- Keywords: `3 things`, `three things app`, `daily focus`, `top 3 tasks`,
  `daily priorities`, `adhd planner simple`, `simple to do list`, `brain dump app`.
- Negative keywords: `todoist`, `things 3`, `notion` (expensive, low intent).
- Pause any keyword above $3 per install after 50 taps.

## 5. The screenshots

`scripts/make-store-screenshots.py` adds the captions to simulator captures.
Order and captions are in `docs/app-store-listing.md`.
