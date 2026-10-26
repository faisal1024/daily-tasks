// The evening close as a Plus moment (1.5). A free user who closes a good day
// (every task done) used to get "Tomorrow starts fresh." Now they see a
// teaser of tomorrow's three: one real line and two blurred placeholders,
// with "See all three with Plus".
//
// Honest by construction:
// - no AI is called for a free user (the evening route is Plus-only);
// - the one visible line is the user's own data, picked on the device (a task
//   still open today, then the oldest one saved for later, then the built-in
//   idea for the next step on their goal path);
// - the blurred lines are placeholder shapes, never hidden real content.
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
export const EVENING_TEASER_BLURRED_LINES = MAX_TASKS - 1;

export interface EveningTeaserInput {
  /** This build has a paywall (RevenueCat configured). */
  paywallEnabled: boolean;
  /** Plus, a trial, grandfathered, or still being checked: no teaser. */
  hasPlus: boolean;
  /** Today's evening check-in has been answered and the close is in. */
  dayClosed: boolean;
  /** The close drafted something for tomorrow (then that shows, not a teaser). */
  hasDraft: boolean;
  taskCount: number;
  completedCount: number;
}

/** Whether a free user's closed day gets the tomorrow teaser. Fails closed. */
export function showsEveningTeaser(input: EveningTeaserInput): boolean {
  if (!input.paywallEnabled || input.hasPlus || !input.dayClosed || input.hasDraft) return false;
  if (input.taskCount <= 0 || input.completedCount < input.taskCount) return false;
  return input.completedCount >= EVENING_TEASER_MIN_DONE;
}

const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The one real line for the teaser, from the user's own data, or null (then
 * no teaser is shown). In order: a task still open today, the oldest task
 * saved for later, the built-in idea for the next step on the goal path (for
 * tomorrow's date). Nothing that's already on today's list.
 */
export function eveningTeaserLine(input: {
  tasks: { text: string; done: boolean }[];
  parkedTasks: Pick<ParkedTask, "text">[];
  plan: MomentumPlan | null;
  completedMilestoneIds: string[];
  /** Today's local date key. */
  today: string;
}): string | null {
  const open = input.tasks.find((task) => !task.done && task.text.trim());
  if (open) return open.text.trim();
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

/** The card's copy: accurate about what Plus does, nothing promised that isn't. */
export const EVENING_TEASER_COPY = {
  title: "Tomorrow's three",
  body: "With Plus, your coach drafts tomorrow's three tonight.",
  button: "See all three with Plus",
  /** Read by VoiceOver for the blurred lines: they're shapes, not hidden tasks. */
  blurredLabel: "Two more lines your coach would draft with Plus",
} as const;
