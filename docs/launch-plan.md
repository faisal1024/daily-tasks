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
3. **Apps → Three Today → Monetization → Subscriptions**: create a subscription
   group **"Three Today Plus"** (give the group itself a localization: display
   name "Three Today Plus"). In it, create two auto-renewable subscriptions:
   | Product | Product ID | Duration | Price |
   |---|---|---|---|
   | Monthly | `plus_monthly` | 1 month | $4.99 |
   | Yearly | `plus_annual` | 1 year | $34.99 |
   For **each** subscription:
   - Localization: display name ("Plus Monthly" / "Plus Yearly") and description
     ("AI helpers for your daily three").
   - Subscription Prices → set the price (all territories).
   - Subscription Prices → **Set Up Introductory Offer** → Free, **1 week**, all territories.
   - **Review Information → Screenshot**: a picture of the paywall (use any Plus
     screen from TestFlight) and a short note ("Opened from Settings › Plus").
   Then **Monetization → In-App Purchases → + → Non-Consumable**: `plus_lifetime`,
   reference name "Plus Lifetime", price $79.99, the same localization and review
   screenshot. (Lifetime is not a subscription, so it lives here.)
   Every product must show **"Ready to Submit"**, not "Missing Metadata".
4. **App Store Small Business Program**: developer.apple.com → Programs →
   enrol (Apple's commission becomes 15% instead of 30%).

RevenueCat (app.revenuecat.com):
5. Confirm the account email. Create the project → add the iOS app
   (bundle `com.faisalislam.dailytasks`) → upload the In-App Purchase key.
6. Create the entitlement **`plus`**, attach all three products, and an offering
   "default" with packages `$rc_monthly`, `$rc_annual`, `$rc_lifetime`. Make
   "default" the **Current** offering (the app reads the current one).
7. Copy the **public Apple API key** (starts `appl_`) into EAS:
   `eas env:create --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --environment production --visibility plaintext --value appl_...`
8. Create a **V1 secret key** (starts `sk_`) for the server (used later, step 11).
9. In RevenueCat → Project → the iOS app → copy the **Apple Server Notification
   URL**. In App Store Connect → App Information → App Store Server Notifications,
   paste it for both **Production** and **Sandbox**, choosing Version 2.

## 2. The release (me, once 1 is done)

10. **(you)** App Store Connect → Users and Access → **Sandbox** → add a Sandbox
    tester (any email you control). Then I build 1.1.0 with the RevenueCat key and
    send it to TestFlight, and we test a sandbox purchase, restore, and the trial
    reminder with that tester.
11. Server: set `REVENUECAT_SECRET_KEY` and `GRANDFATHER_GRANTS_UNTIL` on Render.
    Use an exact date about 6 weeks after release, written like `2026-12-15`; the
    same date goes in What's New: `python3 scripts/build-store-config.py --until 2026-12-15`
    fills it in (until then store.config.json has no What's New). Later move to
    Cloudflare (docs/momentum-ai-proxy.md).
12. Listing: paste `docs/app-store-listing.md` (or `eas metadata:push`), upload the
    screenshots from `~/Downloads/three-today-appstore-screenshots/`, update the App
    Privacy label as listed there, add the review notes.
    **Before Submit:** on the 1.1.0 version page, open **In-App Purchases and
    Subscriptions** and select `plus_monthly`, `plus_annual` and `plus_lifetime`.
    First-ever in-app purchases must be submitted with an app version; if this is
    skipped, the reviewer sees an empty paywall and rejects the build. Then submit.

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
| 5 | "My whole day on my Lock Screen" | The widget (ticking off from the Home Screen is a Plus feature: say so on screen). |
| 6 | "It wrote tomorrow's list for me" | Evening check-in: tap "Hard" → tomorrow's three appear. |
| 7 | "Day 30" | The Day N counter and Progress page. |

Captions: plain, lowercase-friendly, one idea per video, end with "Three Today, free
on the App Store". Hashtags: #todolist #adhdtips #productivity #3things.

### Communities (be a person, not an ad)
- r/ADHD, r/productivity, r/getdisciplined: read each subreddit's self-promotion rules;
  most allow it only in weekly threads. Share what you learned building a 3-task app,
  not a download link.
- Indie Hackers / X (#buildinpublic): monthly numbers (installs, trials, revenue).

### Apple Ads (a small, capped test, not a growth channel)
The maths: at the targets (10% of installs start a trial, 35% of trials pay), a
$3 install costs about **$86 per paying user**, while a yearly subscriber brings
about $29.70 in the first year (after the 15% commission). Paid installs only
pay back below roughly **$1**. So treat ads as a learning budget:
- **$300 total, stop after 4 weeks.** Search Results campaign, exact match,
  max cost per tap $0.75–1.
- Keywords: `3 things`, `three things app`, `top 3 tasks`, `daily priorities`,
  `simple to do list`, `brain dump app`, `adhd planner simple`.
- Pause a keyword with no trial after 25 taps.
- Keep only keywords that come in under about $1 per install; the rest of the
  growth is organic (videos, communities, reviews).

Filming tip for the videos: use a demo data set (made-up tasks), never your real list.

## 5. The screenshots

`scripts/make-store-screenshots.py` adds the captions to simulator captures.
Order and captions are in `docs/app-store-listing.md`.
