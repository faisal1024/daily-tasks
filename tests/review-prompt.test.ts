// The 1.3 rating-ask policy (PR #78): the happy moments' transitions
// (milestones, a good week) and the guards every trigger goes through.
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/daily-tasks/date";
import {
  REVIEW_COOLDOWN_DAYS,
  countShowedUpDays,
  goodWeekReached,
  milestoneReached,
  shouldRequestReview,
  type ReviewPromptState,
} from "../lib/daily-tasks/review-prompt";
import { syncTodayHistory } from "../lib/daily-tasks/rollover";
import { buildInitialState } from "../lib/daily-tasks/storage";
import type { DayRecord, History, Task } from "../lib/daily-tasks/types";

const TODAY = "2026-09-26";
const NOW = new Date(2026, 8, 26, 9, 0);
const DAY_MS = 86_400_000;

function day(date: string, total = 1): DayRecord {
  return {
    date,
    total,
    completed: 0,
    locked: false,
    lockSource: null,
    tasks: [],
    reflection: null,
    reflectionResult: null,
  };
}

/** `n` showed-up days ending yesterday. */
function pastDays(n: number): History {
  const history: History = {};
  for (let i = 1; i <= n; i++) {
    const date = addDays(TODAY, -i);
    history[date] = day(date);
  }
  return history;
}

const quiet = (overrides: Partial<ReviewPromptState> = {}): ReviewPromptState => ({
  history: pastDays(1),
  today: TODAY,
  lastReviewPromptAt: null,
  now: NOW,
  onboardingVisible: false,
  paywallOpen: false,
  focusSessionActive: false,
  ...overrides,
});

describe("milestones and a good week fire only on the step that reaches them", () => {
  it("a milestone is reached only when crossing 7, 30 or 100", () => {
    expect(milestoneReached(6, 7)).toBe(7);
    expect(milestoneReached(29, 30)).toBe(30);
    expect(milestoneReached(99, 100)).toBe(100);
    // Already past it, not there yet, or no baseline (first render).
    expect(milestoneReached(7, 8)).toBeNull();
    expect(milestoneReached(5, 6)).toBeNull();
    expect(milestoneReached(null, 7)).toBeNull();
  });

  it("a good week is only the 4 → 5 step", () => {
    expect(goodWeekReached(4, 5)).toBe(true);
    expect(goodWeekReached(5, 6)).toBe(false);
    expect(goodWeekReached(3, 4)).toBe(false);
    expect(goodWeekReached(null, 5)).toBe(false);
  });

  it("today counts once its first task is added (live total), whatever its synced record says", () => {
    const tasks: Task[] = [{ id: "t0", text: "Walk", createdAt: "", carriedOver: false }];
    const state = syncTodayHistory(
      { ...buildInitialState(NOW), history: pastDays(6), tasks, lastOpenedDate: TODAY },
      TODAY,
    );
    // Today's own synced record isn't counted twice.
    expect(countShowedUpDays(state.history, TODAY, 1)).toBe(7);
    expect(countShowedUpDays(state.history, TODAY, 0)).toBe(6);
  });
});

describe("guards on every rating ask", () => {
  it("never on the install's first day: no history, or only today's", () => {
    expect(shouldRequestReview("milestone", quiet({ history: {} }))).toBe(false);
    expect(shouldRequestReview("focus_done", quiet({ history: { [TODAY]: day(TODAY, 3) } }))).toBe(false);
    // A day before today with nothing on it doesn't count either.
    expect(shouldRequestReview("focus_done", quiet({ history: { "2026-09-25": day("2026-09-25", 0) } }))).toBe(
      false,
    );
    expect(shouldRequestReview("focus_done", quiet())).toBe(true);
  });

  it.each([
    ["onboarding or the first run", { onboardingVisible: true }],
    ["the paywall", { paywallOpen: true }],
    ["a focus session", { focusSessionActive: true }],
  ])("never over %s", (_why, overrides) => {
    expect(shouldRequestReview("good_week", quiet(overrides))).toBe(false);
  });

  it("the cooldown is exactly 60 days", () => {
    expect(REVIEW_COOLDOWN_DAYS).toBe(60);
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(shouldRequestReview("perfect_day", quiet({ lastReviewPromptAt: ago(60 * DAY_MS - 1) }))).toBe(false);
    expect(shouldRequestReview("perfect_day", quiet({ lastReviewPromptAt: ago(60 * DAY_MS) }))).toBe(true);
  });

  it("a corrupt timestamp asks once; the new timestamp then holds the cooldown", () => {
    expect(shouldRequestReview("milestone", quiet({ lastReviewPromptAt: "not a date" }))).toBe(true);
    // markReviewPrompted replaces it with the real time of the ask.
    expect(shouldRequestReview("milestone", quiet({ lastReviewPromptAt: NOW.toISOString() }))).toBe(false);
  });
});
