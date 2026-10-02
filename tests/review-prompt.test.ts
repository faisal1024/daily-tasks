// The 1.3 rating-ask policy (PR #78): the achievements a first tick can make
// (milestones, a good week), the guards on earning an ask, and a saved ask's expiry.
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/daily-tasks/date";
import {
  REVIEW_COOLDOWN_DAYS,
  REVIEW_DELAY_MS,
  REVIEW_EXPIRY_MS,
  achievementOnFirstTick,
  reviewDueStatus,
  shouldRequestReview,
  type ReviewPromptState,
} from "../lib/daily-tasks/review-prompt";
import { syncTodayHistory } from "../lib/daily-tasks/rollover";
import { countShowedUpDays } from "../lib/daily-tasks/streaks";
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
  ...overrides,
});

describe("the achievement today's first tick makes", () => {
  it("a milestone is exactly day 7, 30 or 100 (today included)", () => {
    expect(achievementOnFirstTick(7, 1)).toBe("milestone");
    expect(achievementOnFirstTick(30, 1)).toBe("milestone");
    expect(achievementOnFirstTick(100, 1)).toBe("milestone");
    expect(achievementOnFirstTick(8, 1)).toBeNull();
    expect(achievementOnFirstTick(6, 1)).toBeNull();
  });

  it("a good week is exactly 5 of the last 7, and a milestone on the same day wins", () => {
    expect(achievementOnFirstTick(9, 5)).toBe("good_week");
    expect(achievementOnFirstTick(9, 6)).toBeNull();
    expect(achievementOnFirstTick(9, 4)).toBeNull();
    expect(achievementOnFirstTick(7, 5)).toBe("milestone");
  });

  it("today counts once its first task is added (live total), whatever its synced record says", () => {
    const tasks: Task[] = [{ id: "t0", text: "Walk", createdAt: "", carriedOver: false }];
    const state = syncTodayHistory(
      { ...buildInitialState(NOW), history: pastDays(6), tasks, lastOpenedDate: TODAY },
      TODAY,
    );
    // Today's own synced record isn't counted twice.
    expect(countShowedUpDays(state.history, TODAY, { includeToday: true })).toBe(7);
    expect(countShowedUpDays(state.history, TODAY, { includeToday: false })).toBe(6);
  });
});

describe("guards on earning a rating ask", () => {
  it("never on the install's first day: no history, or only today's", () => {
    expect(shouldRequestReview(quiet({ history: {} }))).toBe(false);
    expect(shouldRequestReview(quiet({ history: { [TODAY]: day(TODAY, 3) } }))).toBe(false);
    // A day before today with nothing on it doesn't count either.
    expect(shouldRequestReview(quiet({ history: { "2026-09-25": day("2026-09-25", 0) } }))).toBe(
      false,
    );
    expect(shouldRequestReview(quiet())).toBe(true);
  });

  it("never over onboarding or the first run (the paywall and a focus session are checked at ask time)", () => {
    expect(shouldRequestReview(quiet({ onboardingVisible: true }))).toBe(false);
  });

  it("the cooldown is exactly 60 days", () => {
    expect(REVIEW_COOLDOWN_DAYS).toBe(60);
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(shouldRequestReview(quiet({ lastReviewPromptAt: ago(60 * DAY_MS - 1) }))).toBe(false);
    expect(shouldRequestReview(quiet({ lastReviewPromptAt: ago(60 * DAY_MS) }))).toBe(true);
  });

  it("a corrupt timestamp asks once; the new timestamp then holds the cooldown", () => {
    expect(shouldRequestReview(quiet({ lastReviewPromptAt: "not a date" }))).toBe(true);
    // markReviewPrompted replaces it with the real time of the ask.
    expect(shouldRequestReview(quiet({ lastReviewPromptAt: NOW.toISOString() }))).toBe(false);
  });
});

describe("a saved ask's age", () => {
  const due = (agoMs: number) => new Date(NOW.getTime() - agoMs).toISOString();

  it("waits an hour, is ready for a week, then expires", () => {
    expect(reviewDueStatus(due(REVIEW_DELAY_MS - 1), NOW.getTime())).toBe("wait");
    expect(reviewDueStatus(due(REVIEW_DELAY_MS), NOW.getTime())).toBe("ready");
    expect(reviewDueStatus(due(REVIEW_EXPIRY_MS), NOW.getTime())).toBe("ready");
    expect(reviewDueStatus(due(REVIEW_EXPIRY_MS + 1), NOW.getTime())).toBe("expired");
  });

  it("a corrupt timestamp (or one far in the future) is expired, never asked", () => {
    expect(reviewDueStatus("not a date", NOW.getTime())).toBe("expired");
    expect(reviewDueStatus(due(-REVIEW_EXPIRY_MS - 1), NOW.getTime())).toBe("expired");
  });
});
