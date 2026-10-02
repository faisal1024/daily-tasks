// When to ask for an App Store rating. Pure so the policy is unit-tested; the
// Today screen calls it at a happy moment (1.3).
//
// Apple already caps the system prompt at 3 times per year, but asking at a bad
// moment wastes one of those. A happy moment (a focus session ended with its
// task done, a perfect day, a showed-up milestone, a good week) EARNS an ask,
// never on the first day, over onboarding, or within the cooldown. The ask
// itself waits at least an hour, for a later quiet app open (no paywall, focus
// session, sheet or celebration on screen; the Today screen checks that then).
//
// Guideline 5.6.1: there is no "do you like the app?" gate before the system
// prompt, and nothing is ever given in return for a review.

import type { History, ReviewTrigger } from "./types";
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
/** An earned ask waits at least this long after the happy moment... */
export const REVIEW_DELAY_MS = 60 * 60 * 1000;
/** ...and expires after a week (too far from the moment that earned it). */
export const REVIEW_EXPIRY_MS = 7 * DAY_MS;

/**
 * At today's first tick, the achievement today makes, or null: a showed-up
 * milestone (Day 7, 30 or 100) first, else a good week (exactly 5 of the last
 * 7). Both counts include today, which a tick means has a task, so equality
 * is "reached today".
 */
export function achievementOnFirstTick(
  showedUpDays: number,
  weekShowedUpDays: number,
): "milestone" | "good_week" | null {
  if (SHOWED_UP_MILESTONES.includes(showedUpDays)) return "milestone";
  if (weekShowedUpDays === GOOD_WEEK_DAYS) return "good_week";
  return null;
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
 * Whether a happy moment, just now, earns a rating ask. Callers ask only on the
 * transition, not on every render. The paywall, a focus session and the rest
 * are checked when the ask is shown (reviewDueStatus + the screen being quiet).
 */
export function shouldRequestReview(state: ReviewPromptState): boolean {
  if (state.onboardingVisible) return false;
  if (!hasShowedUpBefore(state.history, state.today)) return false;
  return cooldownPassed(state.lastReviewPromptAt, state.now);
}

/**
 * Where a saved ask (`reviewDueAt`) stands at `now`: too soon, ready, or
 * expired. A corrupt timestamp (or one a week or more off) is expired, never
 * "ask now", so it's cleared or replaced instead of blocking every later ask.
 */
export function reviewDueStatus(dueAt: string, now: number): "wait" | "ready" | "expired" {
  const age = now - Date.parse(dueAt);
  if (Number.isNaN(age) || Math.abs(age) > REVIEW_EXPIRY_MS) return "expired";
  return age < REVIEW_DELAY_MS ? "wait" : "ready";
}
