# App Store listing: Three Today 1.1.0

Everything to paste into App Store Connect for the first "Three Today" release
(the first release with Plus). Character counts are checked against Apple's
limits. The same copy is in `store.config.json` for `eas metadata:push`.

## Name and subtitle

| Field | Text | Limit |
|---|---|---|
| Name | **Three Today: 3 Tasks a Day** | 26 / 30 |
| Subtitle | **Brain dump to your daily three** | 30 / 30 |

Check the name is free: App Store Connect → the app → App Information → Name.
If Apple says it's taken, use **Three Today – Daily Focus** (25).

## Keywords (98 / 100)

```
todo,list,planner,focus,adhd,priority,simple,minimal,checklist,goal,organizer,routine,reminder,top
```

Words already in the name and subtitle (three, today, tasks, day, brain, dump,
daily) are left out on purpose: Apple indexes those already.

## Promotional text (119 / 170)

```
Three tasks a day, and every morning starts fresh with no overdue pile. Dump what's on your mind and get today's three.
```

## Description

```
Your whole to-do list can wait. Today is three things.

Three Today turns the pile in your head into the three tasks that matter today. Dump everything on your mind, by typing or talking, and get your three. The rest is saved for later, not stacked on top of tomorrow.

EVERY DAY STARTS FRESH
There's no overdue list and no red badges. Anything you didn't finish waits for one tap: bring it into today, or let it go.

A MORNING, A FEW WINS, AN EVENING
• Morning: pick your three, or use the ones your coach drafted last night.
• Day: tick them off. The next one is always the only one in front of you.
• Evening: say how the day felt in one tap, and tomorrow starts with what's still open (with Plus, your AI coach drafts tomorrow's three).

MADE TO KEEP GOING
• A day count that only goes up: every day you plan counts.
• Streak freezes, so one missed day doesn't wipe out a good run.
• A weekly review that shows what's working.
• Home Screen and Lock Screen widgets.

THREE TODAY PLUS
Plus adds the AI helpers: AI brain dump sorting (3 free to try), Break it down (turn a stuck task into tiny steps), fresh AI ideas for your goal, a coach that drafts tomorrow in the evening, and planning around today's Calendar and Reminders. Your three tasks stay free forever.

• Monthly and yearly plans include a free trial for new subscribers.
• Payment is charged to your Apple ID at confirmation of purchase (or when the trial ends).
• Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in iPhone Settings › your name › Subscriptions.
• A one-time Lifetime purchase is available in the app's Settings.

Private by design: your tasks are stored on your device, with no account and no ads. AI features send only the text they need, and nothing is kept on our server.

Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://gist.githubusercontent.com/faisal1024/a43d6373453761af70d495d640e38ffa/raw/privacy-policy.html
```

## What's New in 1.1.0

```
Daily Tasks is now Three Today, rebuilt around a calm daily ritual:
• Dump everything on your mind and get your three, picked for you.
• One calm card for today, with the next task up front.
• An evening check-in that drafts tomorrow's three.
• Plan around your Calendar and Reminders (Plus).
• Progress and history together in one tab.
• Introducing Three Today Plus, with a free trial. Already using the app? Plus is free for you, for life: just open the app before <date>.
```

## URLs

| Field | URL |
|---|---|
| Privacy Policy URL | the published gist (republished as "Three Today"): `https://gist.githubusercontent.com/faisal1024/a43d6373453761af70d495d640e38ffa/raw/privacy-policy.html` |
| Support URL | `https://github.com/faisal1024/daily-tasks#support` |
| Terms of Use (EULA) | Apple's standard EULA (linked in the description; leave "License Agreement" as the standard one) |

## App Review notes

```
No account or login is needed.

Where to find things:
• Plus paywall: Settings › Plus › "See Plus plans", or tap "Break it down" on the next task (after setting the day), or "Get Plus" in the brain dump after the 3 free AI sorts.
• The Lifetime purchase is shown only when the paywall is opened from Settings › Plus.
• Restore purchases: on the paywall and in Settings.

AI features: brain dump sorting, Break it down, goal ideas and the evening check-in send only the text needed (for example task titles or what was typed) to our server, which forwards it to an AI model to create suggestions. Request contents aren't stored on our server. Details are in the privacy policy.

The Plus paywall also appears once at the end of the first-run flow (closable), and from "New ideas" in the ideas sheet.

Calendar and Reminders: only used if the user turns on Settings › "Plan around my calendar" (a Plus feature). Today's event titles and times and reminders due today are sent with AI suggestion requests so the three fit around the day.

To see the first-run flow, delete and reinstall the app.
```

## Captioned screenshots

Made by `scripts/make-store-screenshots.py` from simulator captures, in
`~/Downloads/three-today-appstore-screenshots/` (iPhone 6.9" 1320×2868 and
iPad 13" 2064×2752), in this order:

1. "Three tasks. No overdue pile." (Today, set, next task up front)
2. "Dump it all. Get your three." (first run: the three picked from a dump)
3. PLUS "Your coach drafts tomorrow" (the evening check-in and tomorrow's draft)
4. PLUS "Break big tasks into tiny steps" (steps on the next task)
5. "See your progress, not your misses" (Progress: Day N, week, milestones)

Paid features carry a "PLUS" label on the screenshot (guideline 2.3.2). A widget
screenshot from a real phone can be added as a 6th.

## App Privacy label (update before submitting)

In App Store Connect → App Privacy, add to what's already there:
- **Identifiers → User ID**: App Functionality; not linked to the user; not used for tracking (the anonymous RevenueCat id sent to our server for the Plus check and limits).
- **User Content → Other User Content**: already declared for AI requests. It now also covers brain dumps from free users and Calendar/Reminders titles when that setting is on.
- **Purchases → Purchase History**: App Functionality; not linked; no tracking (RevenueCat).
- **Usage Data → Product Interaction**: Analytics; not linked; no tracking (PostHog, if the analytics key is set in the build).
- **Identifiers → Device ID**: Analytics; not linked; no tracking (PostHog's random per-install id), in addition to User ID above.
- **Diagnostics → Other Diagnostic Data**: Analytics; not linked; no tracking (error-kind events, no content).
- Declaring these even if the analytics key isn't set is safe; under-declaring is not.

## Before the first `eas metadata:push`

Run `eas metadata:pull` first and keep the categories, age rating (advisory) and
review contact it brings back, so a push doesn't reset them.
