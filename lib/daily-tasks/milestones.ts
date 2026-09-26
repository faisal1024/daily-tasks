// Pure milestone-completion logic, kept free of react-native imports so it can
// be unit-tested in plain Node and reused by the store reducer.

import { awardMilestone, type Journey } from "./journey";
import type { MomentumMilestone } from "./types";

export type MilestoneView = MomentumMilestone & { done: boolean };

// Builds before the milestone-id unification gave AI milestones m1–m3 while
// template plans used milestone_start/_repeat/_grow. Map the old AI ids onto
// the shared positional ids so saved progress carries over.
const LEGACY_MILESTONE_IDS: Record<string, string> = {
  m1: "milestone_start",
  m2: "milestone_repeat",
  m3: "milestone_grow",
};

export function migrateMilestoneId(id: string): string {
  return LEGACY_MILESTONE_IDS[id] ?? id;
}

/** Migrate and de-duplicate saved completed-milestone ids. */
export function migrateCompletedMilestoneIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map(migrateMilestoneId)));
}

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
