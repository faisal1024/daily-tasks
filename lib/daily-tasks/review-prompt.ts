// When to ask for an App Store rating. Pure so the policy is unit-tested; the
// Today screen calls it at a happy moment (1.3).
//
// Apple already caps the system prompt at 3 times per year, but asking at a bad
// moment wastes one of those. We only ask right after something good happened
// (a focus session ended with its task done, a perfect day, a showed-up
// milestone, a good week), never on the first day, never over onboarding, the
// paywall or a focus session, and never more than once per cooldown.
//
// Guideline 5.6.1: there is no "do you like the app?" gate before the system
// prompt, and nothing is ever given in return for a review.

import type { History, ReviewTrigger } from "./types";
import { MAX_TASKS } from "./types";
import { showedUp } from "./streaks";

/** The happy moment behind an ask; also the `source` of rating_prompt_requested. */
export type { ReviewTrigger };
export const REVIEW_TRIGGERS: readonly ReviewTrigger[] = [
  "focus_done",
  "milestone",
  "good_week",
  "perfect_day",
];

export function isReviewTrigger(value: unknown): value is ReviewTrigger {
  return typeof value === "string" && (REVIEW_TRIGGERS as readonly string[]).includes(value);
}

export const REVIEW_COOLDOWN_DAYS = 60;
/** Days showed up (the "Day N" rule) that count as a milestone. */
export const SHOWED_UP_MILESTONES: readonly number[] = [7, 30, 100];
/** Showed-up days in the last 7 (today included) that make a good week. */
export const GOOD_WEEK_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export function countPerfectDays(history: History): number {
  return Object.values(history).filter(
    (day) => day.total === MAX_TASKS && day.completed === MAX_TASKS,
  ).length;
}

/**
 * Days actually shown up so far, today only once it counts (the shared
 * `showedUp` rule, as for "Day N"). `todayTotal` is today's live task count,
 * so this never lags the screen.
 */
export function countShowedUpDays(history: History, today: string, todayTotal: number): number {
  let count = 0;
  for (const record of Object.values(history)) {
    if (record.date < today && showedUp(record)) count += 1;
  }
  return count + (todayTotal > 0 ? 1 : 0);
}

/** The milestone just reached going from `previous` to `current`, or null. */
export function milestoneReached(previous: number | null, current: number): number | null {
  if (previous === null) return null;
  for (const milestone of SHOWED_UP_MILESTONES) {
    if (previous < milestone && current >= milestone) return milestone;
  }
  return null;
}

/**
 * True only when the showed-up days in the last 7 (today included, as the week
 * row counts them) just reached a good week.
 */
export function goodWeekReached(previous: number | null, current: number): boolean {
  return previous !== null && previous < GOOD_WEEK_DAYS && current >= GOOD_WEEK_DAYS;
}

/** Showed up on some day before today: not the install's first day. */
export function hasShowedUpBefore(history: History, today: string): boolean {
  return Object.values(history).some((record) => record.date < today && showedUp(record));
}

export interface ReviewPromptState {
  history: History;
  /** Today's date key (YYYY-MM-DD). */
  today: string;
  lastReviewPromptAt: string | null;
  now: Date;
  /** Onboarding or the first-run flow is showing. */
  onboardingVisible: boolean;
  paywallOpen: boolean;
  /** A focus session is running, paused or at its check-in. */
  focusSessionActive: boolean;
}

export function cooldownPassed(lastReviewPromptAt: string | null, now: Date): boolean {
  if (!lastReviewPromptAt) return true;
  const last = new Date(lastReviewPromptAt).getTime();
  // A corrupt timestamp shouldn't block forever or prompt repeatedly: treat as
  // "long ago" once, and the new timestamp replaces it.
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= REVIEW_COOLDOWN_DAYS * DAY_MS;
}

/**
 * Whether a happy moment (`trigger`, or null when nothing just happened) earns
 * a rating ask. Callers pass a trigger only on the transition, not on every
 * render.
 */
export function shouldRequestReview(
  trigger: ReviewTrigger | null,
  state: ReviewPromptState,
): boolean {
  if (!trigger) return false;
  if (state.onboardingVisible || state.paywallOpen || state.focusSessionActive) return false;
  if (!hasShowedUpBefore(state.history, state.today)) return false;
  return cooldownPassed(state.lastReviewPromptAt, state.now);
}
