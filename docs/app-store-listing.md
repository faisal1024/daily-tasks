# App Store listing: Three Today (1.6.1)

Everything to paste into App Store Connect for the current release. Character
counts are checked against Apple's limits. The same name, subtitle, keywords,
promo text and description are in `store.config.json` (rebuilt by
`scripts/build-store-config.py`); What's New for 1.5 onward is only in this doc.

## Name and subtitle

| Field | Text | Limit |
|---|---|---|
| Name | **Three Today: ADHD To Do List** | 28 / 30 |
| Subtitle | **Brain Dump to 3 Tasks a Day** | 27 / 30 |

1.6.1 (2026-11-24): the owner chose the ADHD name. The app was outside the top
~190 for "to do list" and "daily planner"; an exact long-tail phrase in the name
ranks far better in this niche. Research and rank table:
`~/Downloads/three-today-aso-1.6.1.md`. The description gets one plain
"ADHD-friendly" line and no treatment claims (guideline 1.4.1).

Extra US indexing (English text in other locales):
- French (fr-FR): name "Three Today: To Do List", subtitle "Daily Planner & Focus Timer"
  (the old US pair, so nothing indexed is lost), keywords
  `task,procrastination,paralysis,executive,function,sunday,weekly,reset,review,routine,calm,minimal` (97).
- Spanish (Mexico): name and subtitle unchanged, keywords
  `nag,nagging,reminder,persistent,top,3,things,rule,priority,most,important,task,one,tareas,pendientes` (100).

## Keywords (100 / 100)

```
things,top,priorities,planner,daily,focus,timer,todo,simple,overwhelmed,routine,goals,checklist,rule
```

Words already in the name and subtitle (three, today, adhd, to, do, list, brain,
dump, 3, tasks, day) are left out on purpose: Apple indexes those already. No
competitor names (guideline 2.3.7).

## Promotional text (167 / 170)

```
Too much to do? Dump it all, pick three tasks for today, start a 5-minute focus timer. No overdue pile, no account, no ads. Free to start. An ADHD-friendly to-do list.
```

## Description

```
Your whole to-do list can wait. Today is three things.

Three Today turns the pile in your head into the three tasks that matter today. Dump everything on your mind, by typing or talking, and get your three. The rest is saved for later, not stacked on top of tomorrow.

Made to be ADHD-friendly: three tasks, no overdue pile, and a 5-minute focus timer to get you started. Three Today is a planning app, not a medical one. It doesn't diagnose or treat anything.

EVERY DAY STARTS FRESH
There's no overdue list and no red badges. Anything you didn't finish waits for one tap: bring it into today, or let it go.

A MORNING, A FEW WINS, AN EVENING
• Morning: pick your three (with Plus, your coach drafts them the night before).
• Day: tick them off. The next one is always the only one in front of you.
• Evening: say how the day felt in one tap, and tomorrow starts with what's still open (with Plus, your AI coach drafts tomorrow's three).

MADE TO KEEP GOING
• A day count that only goes up: every day you plan counts.
• Streak freezes, so one missed day doesn't wipe out a good run.
• A weekly review that shows what's working.
• Home Screen and Lock Screen widgets.
• A focus timer on your Lock Screen, from 5 minutes.
• Routines that show up on their days. Skip one and nothing turns red.

THREE TODAY PLUS
Plus adds the AI helpers: AI brain dump sorting (3 free to try), Break it down (turn a stuck task into tiny steps), Nag mode (reminders that keep at it, in the voice you pick), the Sunday reset (set up your week in two minutes), fresh AI ideas for your goal, a coach that drafts tomorrow in the evening, and planning around today's Calendar and Reminders. Your three tasks stay free forever.

• Monthly and yearly plans include a free trial for new subscribers.
• Payment is charged to your Apple ID at confirmation of purchase (or when the trial ends).
• Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in iPhone Settings › your name › Subscriptions.
• A one-time Lifetime purchase is available in the app's Settings.

Private by design: your tasks are stored on your device, with no account and no ads. AI features send only the text they need, and our server doesn't store it.

Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://gist.githubusercontent.com/faisal1024/a43d6373453761af70d495d640e38ffa/raw/privacy-policy.html
```

## What's New in 1.6.1

```
A small update to make each day smoother:
• Already picked your three? You can now swap a routine in for one of them.
• Checkboxes, text boxes and choices have clearer outlines, and the green tick is easier to read.
• VoiceOver now reads out more of what changes on screen.
```

## What's New in 1.6 (submitted 2026-10-29)

This is the text as submitted (1.5 was never released on its own, so 1.6 carries
its changes too). French and Spanish (Mexico) translations of the same text were
entered in App Store Connect.

```
Catch it anywhere, see it again when it matters:
• Save a thought for later from the share sheet, the Dump widget, Control Center or Siri ("Save for later in Three Today"). It never lands on today's three.
• Saved items with a day ("dentist Friday") come back on that day. Missed deadlines show as Overdue.
• Nags now always fit the task they're about. Snooze one for an hour or mark the task done right from the notification.
• Plus: write your own nag lines.
• Plus: Sunday reset. Two minutes on Sunday evening for your week's wins, a dump for the week, and Monday's three.

Also new:
• Getting started is three steps: dump, pick, go.
• Each of your three shows why it was picked.
• Your coach remembers what you finish and what keeps coming back. See it in Settings.
• "Lock today" replaces "Set", with Unlock right on Today.
• Share your finished day as a picture.
```

## What's New in 1.5 (not released; folded into 1.6)

```
A calmer start and a coach that remembers:
• Getting started is three steps: dump, pick, go.
• Each of your three now shows why it was picked.
• Your coach remembers what you finish and what keeps coming back. See it in Settings.
• "Lock today" replaces "Set", with Unlock right on Today.
• Back after a few days? Your Day count is still yours.
• Share your finished day as a picture.
• Routine ideas to add in one tap, Swap in from Saved for later, and a few small touches.
```

## What's New in 1.4.1 (shipped)

```
A small update to Nag mode, and a few fixes:
• A new voice: Dad. Dry, deadpan, and sure to bring up your list again.
• Spouse is now called Partner. Same voice, new name.
• If your day sets itself while you're editing a task, your edit is now saved.
• A nag no longer repeats a line already said that day.
```

## What's New in 1.1.0

```
Daily Tasks is now Three Today, rebuilt around a calm daily ritual:
• Dump everything on your mind and get your three, picked for you.
• One calm card for today, with the next task up front.
• An evening check-in that drafts tomorrow's three (Plus).
• Plan around your Calendar and Reminders (Plus).
• Progress and history together in one tab.
• Introducing Three Today Plus, with a free trial. Already using the app? Plus is free for you, for life: just open the app before December 15, 2026.
```

## URLs

| Field | URL |
|---|---|
| Privacy Policy URL | the published gist (republished as "Three Today"): `https://gist.githubusercontent.com/faisal1024/a43d6373453761af70d495d640e38ffa/raw/privacy-policy.html` |
| Support URL | `https://github.com/faisal1024/daily-tasks#support` |
| Terms of Use (EULA) | Apple's standard EULA (linked in the description; leave "License Agreement" as the standard one) |

## App Review notes

As submitted with 1.6 (2026-10-29):

```
No account or login is needed. To see the first-run flow, delete and reinstall the app.

Where to find things:
• Plus paywall: Settings › Plus › "See Plus plans". It also appears once at the end of the first run (closable), from "New ideas", from "Get Plus" after the 3 free AI brain-dump sorts, and from "Break it down" after the one free try.
• Lifetime is shown only when the paywall is opened from Settings › Plus. Restore purchases: on the paywall and in Settings.

AI features (brain dump, Break it down, ideas, evening check-in, coach note, Nag lines, Sunday reset) send only the text needed (for example task titles) to our server, which forwards it to an AI model. Request contents aren't stored on our server. Details are in the privacy policy.

Calendar and Reminders: only used if the user turns on Settings › "Plan around my calendar" (Plus).

Focus timer: tap the timer icon on a task on Today. A Live Activity shows on the Lock Screen and in the Dynamic Island (iOS 17.2+). Siri: "Start my next task in Three Today". Ending a timer never completes a task.

Nag mode (Settings › Reminders › Reminder style › Nag): an optional Plus feature, off by default. Local notifications about the user's own open tasks at random times, at most one an hour, never time-sensitive; "No more nags today" stops them for the day. Voices: Mom, Dad, Partner, Coach, Drill sergeant; levels Gentle, Firm, Relentless. Drill sergeant at Firm and Relentless uses comic boot-camp remarks about the user's effort ("maggot", "slacker"), disclosed where the level is chosen. No profanity, slurs or threats, and nothing about body, intelligence, gender, health or family. AI-written lines are filtered on our server and again on the device. Open tasks are sent to the AI service only after an in-app confirmation.

New in 1.6 (and 1.5, which was not released separately):
• Save for later from anywhere: "Three Today" in the share sheet (share extension), Siri "Save for later in Three Today", and the Dump widget and Control Center control. Saved items stay on the device and never go onto today's three. Items with a day ("dentist Friday") come back on that day.
• Nags: long-press a nag for Snooze 1 hour or Mark done. With Plus, users can write up to 5 of their own nag lines (Settings › Reminders); these stay on the device.
• Sunday reset (Plus): on Sundays from 5 PM a card appears on Today; any day it's in Progress › Set up your week.
• Settings › "What your coach remembers" shows and clears what the coach has learned.
• "Lock today" replaces "Set". Users can share their finished day as an image.
• People updating see a one-time "What's new" sheet on Today.
• RevenueCat collects Apple's AdServices attribution token (no tracking prompt, no personal data).
```

## Captioned screenshots

The 1.6.1 set (v8), in `~/Downloads/three-today-appstore-screenshots-v8/`
(iPhone 6.9" 1320×2868 and iPad 13" 2064×2752, 6 each). The owner's rule: lead
with the core to-do promise, not Nag mode (search shows the first three).
"PLUS" marks paid features (guideline 2.3.2).

1. "Just three tasks. No overdue pile." / "The ADHD-friendly to-do list for today." (Today)
2. "Brain dump it all. Keep three." / "The rest is saved for later." (brain dump to today's three)
3. "Stuck? Start a focus timer." / "Even five minutes. Right on your Lock Screen." (focus timer Live Activity)
4. "Routines that wait for you" (Today's routines)
5. PLUS "Reminders that won't let it go." (Coach nag on the Lock Screen)
6. PLUS "Sunday reset. Monday, sorted." (Set up your week: Monday's three)

`src/build8.py` there re-headlines v7 cards 7, 6 and 10 for frames 1-3 and reuses
v7 cards 9, 1 and 5. The v7 set and its build scripts (simulator captures, demo
seed) are in `~/Downloads/three-today-appstore-screenshots-v7/`.

## App Privacy label

Checked for 1.6 (2026-10-29): no changes needed. Age rating answers updated for
Apple's 2026 questions (no social media features); rating stays 4+.

What's declared in App Store Connect → App Privacy:
- **Identifiers → User ID**: App Functionality; not linked to the user; not used for tracking (the anonymous RevenueCat id sent to our server for the Plus check and limits).
- **User Content → Other User Content**: already declared for AI requests. It now also covers brain dumps from free users and Calendar/Reminders titles when that setting is on.
- **Purchases → Purchase History**: App Functionality; not linked; no tracking (RevenueCat).
- **Usage Data → Product Interaction**: Analytics; not linked; no tracking (PostHog, if the analytics key is set in the build).
- **Identifiers → Device ID**: Analytics; not linked; no tracking (PostHog's random per-install id), in addition to User ID above.
- **Diagnostics → Other Diagnostic Data**: Analytics; not linked; no tracking (error-kind events, no content).
- Declaring these even if the analytics key isn't set is safe; under-declaring is not.
- 1.4.1: the app lets RevenueCat collect Apple's AdServices attribution token (sent for every install on iOS 14.3+; Apple matches it to an ad when there was one). It holds no personal data and isn't tracking under ATT; checked again for 1.6: no extra declaration needed.

## Before the first `eas metadata:push`

Run `eas metadata:pull` first and keep the categories, age rating (advisory) and
review contact it brings back, so a push doesn't reset them.
