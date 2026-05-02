# Momentum PRD Roadmap

Last updated: 2026-05-02

## Product Direction

This plan combines the existing 3 Daily Tasks Manager roadmap with the Momentum v8 PRD.

The current app is already a focused daily task app: users choose up to three tasks, lock the day, finish calmly, review history, and handle rollover deliberately. The Momentum PRD should not replace that foundation. It should make the app more differentiated by turning the existing "Today's Three" system into a goal-aware, adaptive daily momentum coach.

The new product promise:

> Pick a meaningful goal. Momentum turns it into three achievable tasks today, learns from what happened, and keeps tomorrow simple.

The sharper market position:

> Momentum is an AI accountability coach for three daily tasks. It helps busy people choose the right three commitments, follow through, and build discipline without creating an endless to-do list.

The constraint stays strict: no backlog, no projects, no endless planning, no more than three tasks per day.

## What Exists Now

- Strict 3-task daily limit.
- Today screen with three fixed focus slots.
- Add, edit, delete, complete, and uncomplete tasks.
- Manual daily lock.
- Configurable auto-lock with on/off and custom lock time.
- Rollover choice flow for unfinished tasks.
- Carry all, Drop all, and individual carry/drop decisions.
- Dropped and carried tasks represented in history.
- Calendar/history view with tapped-day details.
- Day streak and perfect-day streak tracking.
- Completion reflection note.
- Smart local reminder scheduling.
- Notification permission and reminder settings.
- First-run onboarding explaining the three-task philosophy.
- Static optional task suggestions.
- Local-first AsyncStorage persistence.
- Support and privacy pages.
- Automated tests for reminders, locking, rollover, streaks, date logic, and onboarding basics.

## What The PRD Adds

The PRD changes the app from a user-authored task limiter into a personalized daily progress system.

- Goal selection during onboarding.
- Lightweight user context: available time, experience level, and main struggle.
- AI-generated plan with milestones, a task pool, and the first three tasks.
- Morning AI suggestions for today's three tasks.
- Adaptive task generation based on the last 3-5 days.
- Easier tasks after missed days.
- Gradually harder tasks after consistent completion.
- Simpler tasks for users who choose overwhelm as their main struggle.
- Short tasks for users with limited time.
- Evening reflection that influences tomorrow.
- More emotional identity: small daily wins become momentum.

## Main Product Synthesis

The app should become "AI-assisted Today's Three."

The user does not manage a backlog. They choose one meaningful direction, answer a few quick questions, and the app suggests three achievable tasks each day. The existing lock, reminders, rollover, and calendar features become the structure that keeps the AI from becoming noisy or generic.

This is the differentiator Apple should be able to understand:

- Most task apps help users collect more tasks.
- This app helps users choose fewer tasks.
- Momentum goes further by acting like a calm accountability coach: it helps the user commit, protects the day from endless reshuffling, and adapts tomorrow based on follow-through.

## Research-Informed Retention Principles

These principles should guide future design and feature decisions:

- Commitment beats collection. The app should ask users what they are willing to stand behind today, not what they might do someday.
- Planning should be specific. Strong daily tasks should include a clear action and realistic time window, similar to implementation-intention research around when, where, and how goal pursuit happens.
- Feedback should be fast and kind. The user needs a quick sense of progress, but no shame language when the day goes poorly.
- Reminders should support self-chosen commitments. Notifications should feel like a coach helping the user protect their own decision, not generic spam.
- Personalization should reduce friction. AI should make the next three tasks easier to choose, not open a chat rabbit hole or create a backlog.

## Design Work For Claude

Claude should design screens for the following flows before major implementation:

- Welcome: "Let's make progress simple."
- Goal selection with suggested cards and "Something else."
- Context gathering with quick taps for time, experience, and struggle.
- AI plan generation/loading state.
- First Win screen showing today's first three tasks.
- Today screen with AI suggestion state before tasks are accepted.
- Evening reflection: "How did today go?"
- Missed-day recovery state with calm, non-guilty copy.
- Calendar/history view that shows momentum without pressure.
- Settings section for personalization, privacy, and AI controls.

Design should preserve the current calm, minimal personality. Avoid dashboards, dense analytics, productivity-bro language, or chat-heavy AI screens.

## Data Model Direction

Keep the current day-centric model. Add a small Momentum layer around it instead of rewriting everything.

Suggested minimal types:

```ts
type GoalSource = "suggested" | "custom";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";
type TimeAvailability = "15_min" | "30_min" | "60_min";
type StruggleType = "overwhelm" | "consistency" | "motivation" | "time";

interface UserGoal {
  id: string;
  title: string;
  source: GoalSource;
  status: "active" | "archived";
  createdAt: string;
}

interface MomentumProfile {
  activeGoalId: string | null;
  timeAvailability: TimeAvailability | null;
  experienceLevel: ExperienceLevel | null;
  struggleType: StruggleType | null;
  onboardingCompletedAt: string | null;
}

interface MomentumMilestone {
  id: string;
  title: string;
  description?: string;
  completedAt: string | null;
}

interface GeneratedTask {
  id: string;
  text: string;
  estimatedMinutes: number;
  difficulty: "easy" | "medium" | "stretch";
  reason?: string;
  source: "template" | "ai";
}

interface MomentumPlan {
  id: string;
  goalId: string;
  milestones: MomentumMilestone[];
  taskPool: GeneratedTask[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface DailyReflection {
  date: string;
  result: "easy" | "good" | "hard" | "missed";
  note?: string;
  createdAt: string;
}

interface AdaptationSnapshot {
  date: string;
  completionRate: number;
  missedCount: number;
  recommendation: "simplify" | "maintain" | "increase";
}
```

Implementation note: do not add all of this at once if it slows the build. Phase 1 can start with `MomentumProfile`, one active goal, and deterministic task templates. Phase 2 can add `MomentumPlan` and AI-generated tasks.

## Phase 0: Stabilize Current Submission

Goal: avoid disrupting the App Store submission while preparing the next product direction.

Status: Current release track

- [ ] Confirm the latest App Store Connect build uses the current app code and screenshots.
- [ ] Confirm Apple review no longer sees placeholder assets or generated screenshots.
- [ ] Keep current `main` stable while larger Momentum work happens on a feature branch.
- [ ] Run fresh-install QA on iPhone and iPad.
- [ ] Re-test task creation, lock, auto-lock, rollover, reminders, calendar, settings, support, and privacy links.
- [ ] Keep release notes focused on the current app, not future AI promises.

Acceptance criteria:

- Current app can be approved as a complete non-AI three-task product.
- New Momentum work does not block or destabilize App Store review.

## Phase 1: Momentum Foundation Without AI

Goal: build the PRD onboarding and personalization structure before connecting real AI.

Why this phase matters:

This makes the app feel meaningfully different even before AI is live. It also gives Claude's design screens a concrete data model and flow to target.

Build:

- [x] Add one active goal to app state.
- [x] Add goal source: suggested or custom.
- [x] Add onboarding steps for goal, time availability, experience level, and main struggle.
- [x] Keep onboarding under 2-3 minutes.
- [x] Replace static task suggestions with context-aware local templates.
- [x] Generate the user's first three suggested tasks from deterministic templates.
- [x] Let users accept suggested tasks into today's three slots.
- [x] Add a "First Win" completion message: "You showed up today."
- [x] Add Settings controls to reset or update goal/context.
- [x] Add tests for onboarding state, generated suggestions, and the three-task cap.

Design needed from Claude:

- Welcome screen.
- Goal selection cards.
- Context tap screens.
- First Win screen.
- Empty Today state with personalized suggestions.

Acceptance criteria:

- A fresh user can pick a goal and context quickly.
- The app suggests three tasks without requiring typing.
- Suggested tasks still respect the 3-task limit.
- Users can ignore suggestions and add their own tasks.
- No network or AI dependency is required in this phase.

## Phase 2: AI Generation MVP

Goal: turn the local personalization flow into a real AI-powered daily task generator.

Build:

- [x] Add an AI planning service behind a clean interface.
- [x] Keep provider details isolated so the app can change AI vendors later if needed.
- [x] Send only the minimum required context: goal, time availability, experience level, struggle type, recent completion summary, and recent reflection signal.
- [x] Generate milestones, a small task pool, and today's first three suggested tasks.
- [x] Validate AI output before saving it.
- [x] Reject outputs with more than three daily tasks.
- [x] Reject generic, vague, guilt-based, unsafe, or overly large tasks.
- [x] Add deterministic fallback templates when AI fails or the user is offline.
- [x] Store the generated plan locally.
- [x] Add loading, success, and failure states.
- [x] Add tests around prompt payload construction, output validation, and fallback behavior.
- [x] Add minimal OpenAI backend proxy documentation in `docs/momentum-ai-proxy.md`.

Prompt contract:

- Include the user's goal.
- Include available daily time.
- Include experience level.
- Include main struggle.
- Include recent performance from the last 3-5 days.
- Ask for three tasks that are achievable today.
- Ask for short, calm language.
- Never ask for a backlog.

Acceptance criteria:

- AI can produce today's three tasks from onboarding context.
- The app never schedules or saves more than three tasks for a day.
- The user can still manually edit before locking.
- Failed AI generation does not block app usage.
- The AI feature feels like suggestion, not command.

## Phase 3: Adaptive Daily Loop

Goal: make Momentum learn from user behavior without becoming complicated.

Build:

- [x] Expand evening reflection beyond a text note into fast tap choices.
- [x] Suggested reflection choices: "Easy", "Good", "Hard", "Missed".
- [x] Summarize the last 3-5 days into a small adaptation input.
- [x] If the user misses tasks, reduce difficulty or break tasks smaller.
- [x] If the user completes consistently, gradually increase challenge.
- [x] If struggle is overwhelm, keep tasks especially concrete and small.
- [x] If time availability is low, keep tasks within 15-30 minutes.
- [x] Add a calm recovery state after a missed day.
- [x] Add tests for adaptation rules.

Acceptance criteria:

- Tomorrow's suggestions change based on recent behavior.
- Missed days produce smaller, kinder tasks.
- Completion streaks produce slightly more ambitious tasks without breaking the calm tone.
- The user does not need to manage adaptation settings manually.

## Phase 4: Momentum Retention And Premium Feel

Goal: make the app worth coming back to and eventually worth paying for.

Build:

- [ ] Improve the calendar to show goal momentum, not just task completion.
- [ ] Add a simple weekly review: wins, missed patterns, and next week's focus.
- [ ] Add haptics and subtle animations where they improve the ritual.
- [ ] Add Home Screen widget for today's three tasks.
- [ ] Add Lock Screen widget for today's focus.
- [ ] Add Focus Mode timer for one selected task.
- [ ] Add premium themes and alternate app icons.
- [ ] Add stronger App Store screenshots that show goal onboarding, AI suggestion, Today screen, and calendar momentum.

Acceptance criteria:

- The app has a clear daily ritual: morning suggestion, focused day, evening reflection.
- The app feels differentiated in screenshots and first launch.
- The premium candidates support the core promise instead of adding clutter.

## Phase 4A: Accountability Coach Positioning

Goal: make the current app immediately feel more distinct, sticky, and emotionally valuable.

Build:

- [x] Reposition primary app copy around an accountability coach, not a generic task manager.
- [x] Add a Today-screen coach ritual card that frames the current state: commit, set the day, follow through, or reflect.
- [x] Add an accountability check-in card when tasks are active and incomplete.
- [x] Update onboarding to explain the three-commitment accountability promise.
- [x] Update settings copy so AI adaptation feels like coach tuning, not abstract configuration.
- [ ] Add an implementation-intention prompt for each accepted task, such as "When will you do this?" without making task entry heavy.
- [ ] Add a missed-day repair flow that asks, "What got in the way?" and suggests a smaller recovery trio.
- [ ] Add a weekly accountability review focused on wins, patterns, and one next-week adjustment.

Acceptance criteria:

- A new user can describe the product as an accountability coach after first launch.
- The Today tab has a recognizable daily ritual instead of feeling like a plain checklist.
- The app still preserves the three-task cap and avoids backlog behavior.

## Phase 5: Monetization

Goal: charge only after the product has clear recurring value.

Recommended model:

- Free: one active goal, daily three tasks, basic local reminders, recent history, deterministic suggestions.
- Premium: AI-generated plans, adaptive daily tasks, full history, widgets, themes, focus timer, weekly insights.

Build:

- [ ] Decide whether AI is premium-only, trial-based, or limited free usage.
- [ ] Estimate AI cost per active user before pricing.
- [ ] Build StoreKit purchase flow.
- [ ] Add restore purchases.
- [ ] Add a clear premium screen with no dark patterns.
- [ ] Update privacy policy for AI data processing before release.
- [ ] Update App Store metadata to clearly explain the differentiator.

Acceptance criteria:

- Users can understand why premium exists.
- Free tier remains useful and honest.
- Paid tier feels like a better coach, not a locked basic app.

## Do Not Build Yet

These would weaken the product if added too early:

- Projects.
- Tags.
- Priorities.
- Folders.
- Unlimited backlog.
- Team collaboration.
- Social sharing.
- Habit tracker sprawl.
- Full chat assistant as the main UI.
- Complex analytics dashboards.
- Multiple active goals in the MVP.

## Recommended Build Order

1. Keep the current App Store submission stable.
2. Get Claude design for Phase 1 onboarding and first-win screens.
3. Implement Phase 1 without AI.
4. Test fresh install and daily task flows.
5. Add Phase 2 AI behind a feature flag or isolated service.
6. Add Phase 3 adaptation after AI output is safe and reliable.
7. Polish retention and monetization after users can feel the daily value.

## Open Decisions

- App name: keep the current App Store name for this release, or rebrand to Momentum later.
- AI provider: choose before Phase 2 implementation.
- Privacy posture: decide whether AI requests require explicit consent in onboarding.
- Pricing: decide if AI is premium-only or partially free.
- Goal scope: recommended MVP is one active goal at a time.
- Release timing: recommended approach is to get the current non-AI app approved first, then ship Momentum in a major update.

## Claude Implementation Guidance

Claude should treat the current app as the base, not a throwaway prototype.

Important files to inspect before coding:

- `lib/daily-tasks/types.ts`
- `lib/daily-tasks/store.tsx`
- `lib/daily-tasks/storage.ts`
- `lib/daily-tasks/rollover.ts`
- `lib/daily-tasks/reminders.ts`
- `app/(tabs)/index.tsx`
- `app/(tabs)/calendar.tsx`
- `app/(tabs)/settings.tsx`
- `components/daily-tasks/onboarding-modal.tsx`
- `components/daily-tasks/task-suggestions.tsx`

Implementation rules:

- Preserve the strict three-task cap.
- Preserve local-first behavior unless AI is explicitly enabled.
- Keep AI behind a service/module, not embedded in UI components.
- Keep generated suggestions optional.
- Keep copy short, calm, and encouraging.
- Add tests before changing core rollover, locking, or storage behavior.
- Do not add a backlog.

## Relationship To The Original Roadmap

The original roadmap remains valid for the current App Store release and immediate cleanup. This document supersedes the older future phases once the team decides to pursue the Momentum PRD direction.

Old Phase 3 widgets, themes, focus timer, weekly insights, and monetization are still useful, but they should come after the Momentum onboarding and adaptive task engine. The AI personalization loop is now the main differentiator.
