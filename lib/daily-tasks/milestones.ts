// Pure milestone-completion logic, kept free of react-native imports so it can
// be unit-tested in plain Node and reused by the store reducer.

import { awardMilestone, type Journey } from "./journey";
import type { MomentumMilestone } from "./types";

export type MilestoneView = MomentumMilestone & { done: boolean };

/** Overlay completion state onto a plan's milestones for display. */
export function milestonesWithCompletion(
  milestones: MomentumMilestone[],
  completedMilestoneIds: string[],
): MilestoneView[] {
  return milestones.map((milestone) => ({
    ...milestone,
    done:
      completedMilestoneIds.includes(milestone.id) || milestone.completedAt != null,
  }));
}

export type CelebrationKind = "milestone" | "level" | null;

/**
 * Which celebration to show next. Milestone takes priority; a level-up (which a
 * milestone's XP can trigger) sequences in once the milestone is acknowledged.
 */
export function pickCelebration(params: {
  pendingMilestoneCelebration: string | null;
  pendingLevelUp: number | null;
}): CelebrationKind {
  if (params.pendingMilestoneCelebration !== null) return "milestone";
  if (params.pendingLevelUp !== null) return "level";
  return null;
}

/** The next milestone to auto-advance (first not-yet-completed), or null. */
export function nextIncompleteMilestone(
  milestones: MomentumMilestone[],
  completedMilestoneIds: string[],
): MomentumMilestone | null {
  return (
    milestones.find(
      (milestone) =>
        !completedMilestoneIds.includes(milestone.id) && milestone.completedAt == null,
    ) ?? null
  );
}

export interface MilestoneCompletion {
  completedMilestoneIds: string[];
  journey: Journey;
  pendingMilestoneCelebration: string;
}

/**
 * Complete a milestone: returns the new completed-id set, the journey with
 * milestone XP awarded, and the title to celebrate — or null if the id is
 * unknown or already completed (a no-op the reducer should ignore).
 */
export function completeMilestone(params: {
  milestones: MomentumMilestone[];
  completedMilestoneIds: string[];
  journey: Journey;
  id: string;
}): MilestoneCompletion | null {
  const { milestones, completedMilestoneIds, journey, id } = params;
  const milestone = milestones.find((m) => m.id === id);
  if (!milestone || completedMilestoneIds.includes(id)) return null;
  return {
    completedMilestoneIds: [...completedMilestoneIds, id],
    journey: awardMilestone(journey),
    pendingMilestoneCelebration: milestone.title,
  };
}
