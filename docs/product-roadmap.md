# 3 Daily Tasks Manager Product Roadmap

Last updated: 2026-04-25

## Product Positioning

3 Daily Tasks Manager should not compete as a generic to-do list. The core promise is:

> Pick three tasks. Lock your day. Finish calmly.

The app should feel calm, intentional, privacy-first, and useful for people who get overwhelmed by endless task lists.

## Current App Status

### Completed

- Built a real daily task product instead of the starter placeholder shell.
- Enforced a strict 3-task daily limit.
- Added task completion state.
- Added local AsyncStorage persistence.
- Added calendar/history view.
- Added day streak and perfect-day streak tracking.
- Added smart reminder engine.
- Added notification permission handling.
- Added notification settings for morning, progress, and evening reminders.
- Added manual daily lock.
- Added configurable auto-lock with an on/off toggle and custom lock time.
- Added rollover decision flow for unfinished tasks.
- Added Carry all / Drop all rollover actions.
- Added dropped/carried rollover outcomes in history.
- Added tests for reminders, locking, rollover, and streak behavior.
- Replaced placeholder app icons for Apple review.
- Added GitHub support page content for Apple review.
- Submitted build `1.0.0 (5)` to App Store Connect.

### Apple Review Fixes

- App icon issue: fixed in code/assets.
- Support URL issue: fixed with `https://github.com/faisal1024/daily-tasks#support`.
- Current App Store Connect state seen in Chrome: version `1.0` is Waiting for Review with build `1.0.0 (5)` selected.

## Key Findings From Code Review

- New users no longer get default fake tasks. The app now starts at `0/3` with onboarding and optional suggestions.
- App Store metadata still mentions older reminder behavior and should be updated to match smart reminders.
- First-run onboarding now explains the three-task philosophy.
- The core screen works, but it needs more premium visual polish before charging money.
- Settings now includes in-app Support and Privacy links.
- A local-first privacy policy exists in `docs/privacy-policy.md`.
- Unused template backend, auth, database, and tRPC code has been removed for a cleaner local-first app bundle.
- The package name has been renamed from `app-template` to `daily-tasks`.
- Obvious React starter image assets were removed from `assets/images`.

## Competitor Lessons

### Bento Focus

- Closest conceptual competitor: up to 3 tasks, calm focus, timer, themes, focus score.
- Users like the clear three-task philosophy.
- Users punish clunky UX, confusing controls, battery/background bugs, and surprise subscription changes.
- Monetization includes monthly and yearly premium plans.

### Structured

- Wins through visual planning, widgets, recurring routines, calendar/reminders integration, AI planning, and accessibility.
- Monetizes with monthly, yearly, and lifetime Pro.
- Lesson: daily planning can charge when it feels polished and becomes a ritual.

### Tiimo

- Wins through executive-function positioning, visual planning, routines, reminders, and AI help.
- Lesson: emotional positioning matters. Users pay for reduced mental load, not just checkboxes.

### TickTick

- Wins by being feature-rich: calendar, reminders, Pomodoro, widgets, and many views.
- We should not copy everything because that would weaken our simplicity promise.

### Sunsama

- Charges premium pricing by promising a daily planning workflow for busy professionals.
- Lesson: high pricing requires a repeatable daily ritual and strong trust.

### One Big Thing

- Strong simple positioning: low pressure, no login, daily reset, and paid themes/stickers.
- Lesson: simplicity can monetize if the app has charm and identity.

### MinimaList

- Users praise immediate usability, clean design, widgets, subtasks, sync, and not being hit with upgrade prompts too early.
- Lesson: simple apps still need powerful convenience features.

## Phased Plan

## Phase 0: App Review And Trust Cleanup

Goal: make the app feel legitimate, trustworthy, and clean enough for launch.

Status: In progress

- [x] Replace placeholder app icon.
- [x] Add support URL content.
- [x] Submit new build to App Store Connect.
- [ ] Verify TestFlight build `1.0.0 (5)` shows the new icon on an actual iPhone.
- [ ] Update App Store description to match current smart reminders, lock, and rollover behavior.
- [x] Add a simple privacy policy page/URL.
- [x] Add in-app Support and Privacy links in Settings.
- [x] Remove unused starter assets.
- [x] Rename package/internal app template references.
- [x] Remove unused backend/auth/database template code and dependencies.
- [ ] Run full QA on fresh install, notification permissions, rollover, lock, and icon.

## Phase 1: First-Run Experience

Goal: help users understand the product promise immediately.

Status: Complete

- [x] Remove default seeded tasks from new installs.
- [x] Add onboarding explaining the 3-task philosophy.
- [x] Add first-day flow: choose up to 3 tasks, then set/lock the list.
- [x] Add optional task suggestions without auto-filling them.
- [x] Add empty states for no tasks, locked day, completed day, and rollover decisions.
- [x] Polish rollover decision empty/explanatory states.
- [x] Add clear copy explaining why the app limits the day to three tasks.

## Phase 2: Premium Feel

Goal: make the app feel like something worth paying for.

Status: In progress

- [x] Redesign the main Tasks screen with a calmer, more premium layout.
- [x] Add a Today Summary card.
- [x] Improve task cards and completed-state polish.
- [x] Improve calendar day detail by allowing users to tap a day and review tasks.
- [x] Add optional completion reflection: one short note about what worked today.
- [ ] Improve haptics, animations, and transitions carefully without making the app noisy.
- [ ] Improve App Store screenshots to communicate the value clearly.

## Phase 3: Monetizable Features

Goal: add paid features that support the core promise without turning the app into a backlog tool.

Status: Not started

- [ ] Add Home Screen widget for today’s three tasks.
- [ ] Add Lock Screen widget for today’s focus.
- [ ] Add simple Focus Mode timer for one selected task.
- [ ] Add premium themes.
- [ ] Add alternate app icons.
- [ ] Add weekly insights: completion rate, best days, rollover patterns.
- [ ] Add advanced reminder preferences: quiet hours and reminder tone/copy.
- [ ] Decide free vs premium feature split.

## Phase 4: Pricing And Paywall

Goal: monetize without hurting trust.

Status: Not started

- [ ] Choose pricing model.
- [ ] Recommended starting point: freemium with annual and lifetime options.
- [ ] Candidate pricing: `$1.99/month`, `$14.99/year`, `$24.99 lifetime`.
- [ ] Keep free tier useful: 3 tasks, basic reminders, limited history.
- [ ] Premium candidates: widgets, themes, alternate icons, full history, focus timer, weekly insights, advanced reminders.
- [ ] Build StoreKit purchase flow.
- [ ] Add restore purchases.
- [ ] Add clear premium screen with no dark patterns.

## Phase 5: Larger Differentiators

Goal: build the features that could make this a long-term product.

Status: Not started

- [ ] Add iCloud sync if users ask for multi-device support.
- [ ] Add Apple Watch companion.
- [ ] Add Siri Shortcuts support.
- [ ] Add AI helper: turn a messy brain dump into three focused tasks.
- [ ] Add proper marketing website.
- [ ] Add lightweight analytics or crash reporting while preserving privacy positioning.

## Recommended Next Build Order

1. Finish Phase 0 cleanup.
2. Build Phase 1 onboarding and remove default tasks.
3. Polish screenshots and App Store metadata.
4. Build tapped-day history detail.
5. Add widgets.
6. Add premium themes and alternate icons.
7. Add StoreKit monetization.
8. Add focus timer and weekly insights.

## Notes And Decisions

- Keep the 3-task limit strict.
- Do not add projects, tags, folders, or backlog behavior unless the product direction changes.
- Preserve local-first privacy as a key differentiator.
- Prefer calm, short, encouraging copy.
- Avoid guilt, streak pressure, or spammy reminders.
- Avoid aggressive subscriptions until the app has enough perceived value.

## Change Log

- 2026-04-24: Created roadmap document from code review, competitor research, and product strategy discussion.
