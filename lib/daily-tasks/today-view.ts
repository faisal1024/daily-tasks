// Pure view logic for the Today (Tasks) screen, kept free of React Native so it
// can be unit-tested. Components render what these functions decide.

import type { LockSource, MomentumPlan } from "./types";
import { MAX_TASKS } from "./types";

/** How long "Refreshing…" shows before we add "Still thinking…". */
export const THINKING_HINT_DELAY_MS = 10_000;

export interface TodayProgress {
  completed: number;
  total: number;
  /** 0..1 against three slots, so 1 of 1 doesn't look like a finished day. */
  ratio: number;
  headline: string;
  /** Short line under the headline, e.g. "2 of 3 done". */
  label: string;
  isPerfect: boolean;
}

export function todayProgress(completed: number, total: number): TodayProgress {
  const safeCompleted = Math.max(0, Math.min(completed, total));
  const slots = Math.max(total, MAX_TASKS);
  const isPerfect = total > 0 && safeCompleted === total;
  let headline: string;
  if (total === 0) headline = "Pick today's three";
  else if (isPerfect) headline = total === MAX_TASKS ? "Perfect day!" : "All done!";
  else if (safeCompleted === 0) headline = "Let's go!";
  else headline = "Almost there!";

  const label =
    total === 0
      ? "Three things that matter today."
      : `${safeCompleted} of ${total} done`;

  return {
    completed: safeCompleted,
    total,
    ratio: Math.min(safeCompleted / slots, 1),
    headline,
    label,
    isPerfect,
  };
}

export type TodayStatusKind = "empty" | "choosing" | "set" | "auto";

export interface TodayStatus {
  kind: TodayStatusKind;
  text: string;
  /** Show the "Lock in" action. */
  canLock: boolean;
}

/**
 * One status line replaces the old "Still choosing" and "Accountability
 * check-in" cards. Locking an empty day isn't offered: it only removes options.
 */
export function todayStatus(params: {
  locked: boolean;
  lockSource: LockSource | null;
  taskCount: number;
  completedCount: number;
}): TodayStatus {
  const { locked, lockSource, taskCount, completedCount } = params;
  if (locked) {
    const remaining = Math.max(0, taskCount - completedCount);
    const tail =
      taskCount === 0
        ? ""
        : remaining === 0
          ? " All done."
          : ` ${remaining} to go.`;
    return {
      kind: lockSource === "auto" ? "auto" : "set",
      text:
        (lockSource === "auto" ? "Locked in automatically." : "Today is set.") + tail,
      canLock: false,
    };
  }
  if (taskCount === 0) {
    return { kind: "empty", text: "Add up to three things you'll stand behind.", canLock: false };
  }
  return {
    kind: "choosing",
    text:
      taskCount < MAX_TASKS
        ? "Still choosing. Lock in when the day feels right."
        : "Happy with these three? Lock them in.",
    canLock: true,
  };
}

/** The "Need ideas?" entry point shows only while there's room to add. */
export function showIdeasEntry(params: { locked: boolean; remainingSlots: number }): boolean {
  return !params.locked && params.remainingSlots > 0;
}

export interface IdeasSource {
  personalized: boolean;
  label: string;
}

/** Label telling users whether ideas are tailored to their goal or starters. */
export function ideasSource(plan: MomentumPlan | null, goalTitle: string | null): IdeasSource {
  if (plan?.provider === "ai" && goalTitle) {
    return { personalized: true, label: `Personalized for ${goalTitle}` };
  }
  return { personalized: false, label: "Starter ideas" };
}

/** The small streak/level chip text, e.g. "🔥 21 · Lv 4". */
export function streakChipText(dayStreak: number, level: number): string {
  return `🔥 ${Math.max(0, dayStreak)} · Lv ${Math.max(1, level)}`;
}

export function streakChipLabel(dayStreak: number, level: number): string {
  const days = Math.max(0, dayStreak);
  return `${days}-day streak, level ${Math.max(1, level)}`;
}

/**
 * True only at the moment the day becomes perfect (all three done), not when
 * the app opens on an already-finished day. `previousCompleted` is null until
 * the screen has seen its first ready render.
 */
export function isPerfectDayTransition(params: {
  previousCompleted: number | null;
  completed: number;
  total: number;
}): boolean {
  const { previousCompleted, completed, total } = params;
  if (previousCompleted === null) return false;
  return total === MAX_TASKS && completed === MAX_TASKS && previousCompleted < MAX_TASKS;
}
