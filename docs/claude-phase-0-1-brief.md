# Claude Code Handoff: Phase 0 And Phase 1

Last updated: 2026-04-25

## Purpose

This document is a build brief for Claude Code. The app is an Expo React Native TypeScript app called **3 Daily Tasks Manager / Daily Tasks**. The product should help users choose at most three meaningful tasks per day, lock in their focus, and finish calmly.

Do not turn this into a generic backlog, project manager, or full to-do app. The core promise is:

> Pick three tasks. Lock your day. Finish calmly.

## Repository Context

- Repo path: `/Users/faisal.islam/Documents/Playground/daily-tasks`
- Framework: Expo React Native with Expo Router
- Language: TypeScript
- Persistence: AsyncStorage
- Notifications: `expo-notifications`
- Navigation: tab-based Expo Router app
- Current main screens:
  - Tasks
  - Calendar / history
  - Settings
- Current core app modules live mostly under:
  - `app/(tabs)/`
  - `components/daily-tasks/`
  - `lib/daily-tasks/`

## Product Rules

- The daily task limit must remain strict at 3.
- A day can be locked.
- When locked, users can complete/uncomplete tasks, but cannot add, edit, or delete tasks.
- The app should feel calm, simple, focused, and privacy-first.
- Copy should be short and encouraging.
- Avoid guilt, shame, streak pressure, dark patterns, or spammy notification language.
- Avoid adding projects, tags, priorities, folders, recurring lists, or backlog behavior unless explicitly requested later.

## Existing Features To Preserve

- Strict 3-task daily limit
- Add/edit/delete tasks while the day is editable
- Complete/uncomplete tasks even when the day is locked
- Local AsyncStorage persistence
- Calendar/history view
- Day streak and perfect-day streak tracking
- Smart reminder engine
- Notification permission handling
- Notification settings:
  - Notifications enabled/disabled
  - Morning reminders
  - Progress reminders
  - Evening reminders
- Manual daily lock
- Noon auto-lock when today has at least one task
- Rollover decision flow for unfinished tasks
- Carry all / Drop all rollover actions
- Dropped/carried rollover outcomes in history
- Tests for reminders, locking, rollover, and streak behavior

## Important Current Problems

- New installs currently show fake/default tasks:
  - `Morning Exercise`
  - `Read for 30 Minutes`
  - `Review Daily Goals`
- These default tasks should be removed. New users should start with no tasks and be guided through onboarding/suggestions instead.
- App Store metadata and in-app support/privacy surface need cleanup.
- Settings needs clear Support and Privacy links.
- There are leftover template/starter references and assets.
- The app needs a first-run experience so users understand why the app only allows three tasks.

## Phase 0: App Review And Trust Cleanup

Goal: make the app feel legitimate, trustworthy, and clean enough for launch/resubmission.

### Phase 0 Scope

1. Update in-app trust links.
2. Add simple Support and Privacy links in Settings.
3. Add or link to a basic privacy policy page.
4. Remove obvious starter/template leftovers.
5. Rename internal template references where safe.
6. Run QA for fresh install, notifications, lock, rollover, and settings.

### Phase 0 Tasks

#### 1. Add Support Link In Settings

Add a small section in the Settings screen with:

- Support
- Privacy Policy
- App version

The current Settings screen already has reminders and data controls, so keep this section simple.

Recommended copy:

- Section title: `Help`
- Support row: `Contact support`
- Privacy row: `Privacy policy`

Suggested destination for support:

- `https://github.com/faisal1024/daily-tasks#support`

If a better support URL already exists, use it.

#### 2. Add Privacy Policy URL

Create a basic privacy policy page or markdown document if one does not exist. The app is local-first, so the policy can be simple.

Minimum content should say:

- The app stores tasks locally on the user's device.
- The app uses local notifications if permission is granted.
- The app does not require account creation.
- The app does not sell personal data.
- If analytics/crash reporting are not present, say none is collected.
- Provide support contact/link.

If creating a local markdown file, put it in:

- `docs/privacy-policy.md`

If App Store Connect requires a web URL, GitHub README anchor or GitHub Pages may be used later. For now, make sure the repo has clear privacy policy content.

#### 3. Remove Starter/Template References

Search for template references:

- `app-template`
- `starter`
- `template`
- placeholder copy
- default Expo assets that are no longer used

Do not delete assets blindly. First verify imports/usages with `rg`.

Likely places to inspect:

- `package.json`
- `README.md`
- `assets/images`
- `app.config.ts`
- `server/`

If a file is unused and clearly from the starter template, remove it only if the app still builds and tests pass.

#### 4. Confirm App Icon And App Name

Verify:

- `app.config.ts` points to final app icon assets.
- App name is correct.
- iOS bundle identifier is correct.
- There are no placeholder icon references.

Do not change bundle identifiers unless explicitly requested.

#### 5. QA Checklist

Run:

```bash
npm test
npx tsc --noEmit
```

If the repo does not have a working TypeScript script, inspect `package.json` and use the closest available typecheck command.

Manual QA:

- Fresh install opens with no fake tasks after Phase 1 work.
- Add up to 3 tasks.
- Fourth task cannot be added.
- Lock Today works.
- Locked day allows completion toggles.
- Locked day blocks add/edit/delete.
- Calendar opens.
- Settings opens.
- Notification permission denial does not crash.
- Reset data still works, but confirm before destructive changes during manual testing.

## Phase 1: First-Run Experience

Goal: help users understand the three-task philosophy immediately and start successfully.

### Phase 1 Scope

1. Remove default seeded tasks from new installs.
2. Add lightweight onboarding for first launch.
3. Add optional task suggestions without auto-filling them.
4. Improve empty states for no tasks, locked day, completed day, and rollover.
5. Keep the first-day flow focused on choosing up to three tasks and optionally locking the list.

### Phase 1 Product Requirements

#### New Install Behavior

New users should not receive fake tasks automatically.

Expected behavior:

- First launch shows onboarding or an empty Tasks screen with guidance.
- Today starts editable.
- Task count is `0/3`.
- The app invites the user to add up to three meaningful tasks.

#### Onboarding

Keep onboarding short. Do not build a long carousel unless it is already easy in the current codebase.

Acceptable approaches:

- A first-run modal on the Tasks screen.
- A small dedicated onboarding screen before entering the tabs.
- A dismissible card at the top of the Tasks screen.

Recommended onboarding copy:

- `Choose only three`
- `Pick the tasks that would make today feel complete.`
- `Lock when ready`
- `Once your list is set, the app helps you finish instead of reshuffling.`
- `Tomorrow starts fresh`
- `Unfinished tasks are handled intentionally, not silently buried.`

Recommended CTA:

- `Start today`

Persist onboarding completion in AsyncStorage/app state so it appears only once.

Suggested state field:

```ts
hasSeenOnboarding: boolean
```

Keep migration/default handling safe for existing users.

#### Task Suggestions

Suggestions must not auto-fill the list.

Suggestions should be optional buttons/chips that populate the add input or directly add a task only when tapped.

Good suggestion examples:

- `Move my body`
- `Plan tomorrow`
- `Reply to one important message`
- `Tidy one small area`
- `Read for 20 minutes`

Avoid making suggestions feel like required habits.

#### Empty State

When there are zero tasks, show calm guidance.

Recommended copy:

- Title: `What would make today feel complete?`
- Body: `Choose up to three tasks. Keep it small enough to finish.`

Show the Add Task row prominently.

#### Completed Day State

When all tasks are completed, show a calm completion message.

Recommended copy:

- `Today's three are done.`
- `A small finish is still a finish.`

Do not pressure users to add more. The app should reinforce stopping at three.

#### Locked Day State

Locked state already exists. Make sure copy is clean and native text is not HTML-escaped.

Recommended copy:

- `Today's list is set`
- `Your list is locked for today so you can focus on finishing.`

#### Rollover Flow

Rollover already exists. Phase 1 should only polish clarity if needed.

Requirements to preserve:

- Incomplete tasks from yesterday trigger a choice flow.
- User can carry individual tasks.
- User can drop individual tasks.
- User can carry all or drop all.
- Carried tasks cannot exceed 3 total tasks today.
- Dropped tasks remain in history.
- Reopening app does not duplicate rollover results.

## Implementation Guidance

### State And Migration

Before changing data shape:

1. Inspect `lib/daily-tasks/types.ts`.
2. Inspect `lib/daily-tasks/store.tsx`.
3. Inspect rollover/locking/reminder modules.
4. Add minimal state fields only when needed.

If extending persisted state:

- Provide safe defaults for old saved data.
- Do not assume fields exist.
- Keep migrations deterministic.

### Testing Expectations

Add or update tests for:

- New initial state has zero tasks.
- Existing users keep their existing tasks.
- Onboarding completion persists.
- Suggestions do not auto-add tasks.
- 3-task limit remains strict.
- Lock behavior still works.
- Rollover behavior still works.

Run the existing test suite after changes.

### UX / Design Direction

The UI should feel:

- Calm
- Minimal
- Focused
- Trustworthy
- Native

Avoid:

- Busy onboarding
- Gamified pressure
- Too many controls
- Generic productivity-app clutter
- Large marketing copy inside the functional app

## Definition Of Done

Phase 0 is done when:

- Settings has Support and Privacy links.
- Privacy policy content exists.
- Obvious template/starter references are removed or renamed.
- App icon/name references are verified.
- Tests/typecheck pass or failures are documented.

Phase 1 is done when:

- Fresh install starts with zero tasks.
- First-run onboarding appears once and can be dismissed.
- User understands the 3-task promise before or while adding tasks.
- Suggestions are optional and do not auto-fill.
- Empty/completed/locked states feel clear and calm.
- Existing lock, reminder, rollover, and calendar flows still work.
- Tests/typecheck pass or failures are documented.

## Suggested Build Order For Claude

1. Inspect current store/types and identify where default tasks are seeded.
2. Remove default task seeding safely.
3. Add persisted onboarding completion state.
4. Build first-run onboarding UI using existing visual patterns.
5. Add optional suggestions to the empty state.
6. Add Support and Privacy links to Settings.
7. Add `docs/privacy-policy.md`.
8. Clean obvious template references.
9. Add/update tests.
10. Run tests and typecheck.
11. Summarize changed files and any assumptions.

## Important Notes

- Do not implement monetization in Phase 0 or Phase 1.
- Do not add account creation.
- Do not add sync.
- Do not add projects, tags, folders, or priorities.
- Do not weaken the 3-task limit.
- If a requested change conflicts with the three-task philosophy, pause and call it out.
