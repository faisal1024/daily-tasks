// The evening close as a Plus moment (1.5). A free user who closes a good day
// (every task done) used to get "Tomorrow starts fresh." Now they see what
// tomorrow could start with: one real line, placeholder shapes for the rest,
// and an offer to have the coach draft tomorrow.
//
// Honest by construction:
// - no AI is called for a free user (the evening route is Plus-only), so
//   nothing has been drafted: the copy never says or suggests it has;
// - the one visible line is the user's own data, picked on the device (the
//   oldest task saved for later, then the built-in idea for the next step on
//   their goal path);
// - the placeholder lines are empty shapes, never hidden content.
//
// Pure (no React Native imports), so the rule is unit tested.

import { addDays } from "./date";
import { localMilestoneIdeas } from "./milestone-ideas";
import { nextIncompleteMilestone, pathSourceOf } from "./milestones";
import type { MomentumPlan, ParkedTask } from "./types";
import { MAX_TASKS } from "./types";

/**
 * The one condition knob: the teaser shows after the close of a day where
 * every task was done and at least this many were. MAX_TASKS (3) = perfect
 * days only, to start with; 1 would be any all-done day.
 */
export const EVENING_TEASER_MIN_DONE = MAX_TASKS;

/** How many placeholder lines sit under the real one (a draft is three). */
export const EVENING_TEASER_PLACEHOLDER_LINES = MAX_TASKS - 1;

export interface EveningTeaserInput {
  /** This build has a paywall (RevenueCat configured). */
  paywallEnabled: boolean;
  /** Plus, a trial, grandfathered, or still being checked: no teaser. */
  hasPlus: boolean;
  /** This build can reach the AI evening coach (its proxy route): what Plus would add. */
  eveningAiAvailable: boolean;
  /** Today's evening check-in has been answered and the close is in. */
  dayClosed: boolean;
  /** The close drafted something for tomorrow (then that shows, not a teaser). */
  hasDraft: boolean;
  taskCount: number;
  completedCount: number;
}

/** Whether a free user's closed day gets the tomorrow teaser. Fails closed. */
export function showsEveningTeaser(input: EveningTeaserInput): boolean {
  if (!input.paywallEnabled || input.hasPlus || !input.eveningAiAvailable) return false;
  if (!input.dayClosed || input.hasDraft) return false;
  if (input.taskCount <= 0 || input.completedCount < input.taskCount) return false;
  return input.completedCount >= EVENING_TEASER_MIN_DONE;
}

const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The one real line for the teaser, from the user's own data, or null (then
 * no teaser is shown). The teaser only follows a day with everything done, so
 * nothing is still open: the oldest task saved for later, then the built-in
 * idea for the next step on the goal path (for tomorrow's date). Nothing
 * that's already on today's list.
 */
export function eveningTeaserLine(input: {
  /** Today's tasks (all done when the teaser shows): never offered again. */
  tasks: { text: string }[];
  parkedTasks: Pick<ParkedTask, "text">[];
  plan: MomentumPlan | null;
  completedMilestoneIds: string[];
  /** Today's local date key. */
  today: string;
}): string | null {
  const onToday = new Set(input.tasks.map((task) => looseKey(task.text)));
  const parked = input.parkedTasks.find((task) => task.text.trim() && !onToday.has(looseKey(task.text)));
  if (parked) return parked.text.trim();
  if (!input.plan) return null;
  const milestone = nextIncompleteMilestone(input.plan.milestones, input.completedMilestoneIds);
  if (!milestone) return null;
  // A starter path's steps ("Start small") don't name the goal: lead with the goal.
  const lead = pathSourceOf(input.plan) === "template" ? input.plan.goalTitle : milestone.title;
  const idea = localMilestoneIdeas(milestone, addDays(input.today, 1), lead || milestone.title).find(
    (candidate) => !onToday.has(looseKey(candidate.text)),
  );
  return idea ? idea.text : null;
}

/**
 * The card's copy: what tomorrow could start with (the user's own line) and
 * what Plus would do. Nothing says or suggests a draft already exists.
 */
export const EVENING_TEASER_COPY = {
  title: "Tomorrow could start with",
  body: "Plus drafts a full three each night, from how today went. Your three stay free either way.",
  button: "Have my coach draft tomorrow",
} as const;
