// When to ask for an App Store rating. Pure so the policy is unit-tested; the
// Today screen calls it at the moment a perfect day is completed.
//
// Apple already caps the system prompt at 3 times per year, but asking at a bad
// moment wastes one of those. We only ask happy, engaged users: right after a
// perfect day, once they've had a few, and never more than once per cooldown.

import type { History } from "./types";
import { MAX_TASKS } from "./types";

export const MIN_PERFECT_DAYS_BEFORE_REVIEW = 3;
export const REVIEW_COOLDOWN_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export function countPerfectDays(history: History): number {
  return Object.values(history).filter(
    (day) => day.total === MAX_TASKS && day.completed === MAX_TASKS,
  ).length;
}

export function shouldRequestReview(params: {
  history: History;
  lastReviewPromptAt: string | null;
  now: Date;
  /** True only on the transition into a perfect day, not on every render. */
  justCompletedPerfectDay: boolean;
}): boolean {
  if (!params.justCompletedPerfectDay) return false;
  if (countPerfectDays(params.history) < MIN_PERFECT_DAYS_BEFORE_REVIEW) return false;
  if (!params.lastReviewPromptAt) return true;
  const last = new Date(params.lastReviewPromptAt).getTime();
  // A corrupt timestamp shouldn't block forever or prompt repeatedly: treat as
  // "long ago" once, and the new timestamp replaces it.
  if (Number.isNaN(last)) return true;
  return params.now.getTime() - last >= REVIEW_COOLDOWN_DAYS * DAY_MS;
}
