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
  /** The same for VoiceOver, without symbols it would read aloud ("dot"). */
  spokenLabel: string;
  isPerfect: boolean;
}

export function todayProgress(
  completed: number,
  total: number,
  { locked = false }: { locked?: boolean } = {},
): TodayProgress {
  const safeCompleted = Math.max(0, Math.min(completed, total));
  const slots = Math.max(total, MAX_TASKS);
  const isPerfect = total > 0 && safeCompleted === total;
  let headline: string;
  if (total === 0) headline = "Pick today's three";
  else if (isPerfect) headline = total === MAX_TASKS ? "Perfect day!" : "All done!";
  else if (safeCompleted === 0) headline = "Let's go!";
  else headline = "Almost there!";

  // The bar is measured against three slots, so while slots are still open the
  // label says so too ("0 of 1 done · 2 open") instead of implying 1 is all.
  const open = Math.max(0, MAX_TASKS - total);
  const label =
    total === 0
      ? "Three things that matter today."
      : !locked && open > 0
        ? `${safeCompleted} of ${total} done · ${open} open`
        : `${safeCompleted} of ${total} done`;

  return {
    completed: safeCompleted,
    total,
    ratio: Math.min(safeCompleted / slots, 1),
    headline,
    label,
    spokenLabel: label.replace(" · ", ", "),
    isPerfect,
  };
}

export type TodayStatusKind = "empty" | "choosing" | "set" | "auto";

export interface TodayStatus {
  kind: TodayStatusKind;
  text: string;
  /** Show the "Set today" action. */
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
  /** Auto-lock time, e.g. "12:00 PM", to explain an automatic lock. */
  autoLockTime?: string | null;
}): TodayStatus {
  const { locked, lockSource, taskCount, completedCount, autoLockTime } = params;
  if (locked) {
    const remaining = Math.max(0, taskCount - completedCount);
    const tail =
      taskCount === 0
        ? ""
        : remaining === 0
          ? " All done."
          : ` ${remaining} to go.`;
    if (lockSource === "auto") {
      const when = autoLockTime ? ` at ${autoLockTime}` : "";
      return {
        kind: "auto",
        text: `Set automatically${when}.${tail}`,
        canLock: false,
      };
    }
    return { kind: "set", text: `Today is set.${tail}`, canLock: false };
  }
  if (taskCount === 0) {
    return {
      kind: "empty",
      text: "Pick up to three things that would make today a good day.",
      canLock: false,
    };
  }
  // Everything picked is done: nothing left to commit to.
  if (completedCount >= taskCount) {
    return {
      kind: "choosing",
      text: taskCount >= MAX_TASKS ? "All done for today." : "All done so far. Add another, or enjoy the space.",
      canLock: false,
    };
  }
  // Already under way: committing after the fact means nothing.
  if (completedCount > 0) {
    const left = taskCount - completedCount;
    return { kind: "choosing", text: `Keep going. ${left} to go.`, canLock: false };
  }
  return {
    kind: "choosing",
    text:
      taskCount < MAX_TASKS
        ? "Still choosing. Set the day when it feels right."
        : "Happy with these three? Set them.",
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
  // The sheet title already names the goal, so the label doesn't repeat it.
  if (plan?.provider === "ai" && goalTitle) {
    return { personalized: true, label: "Made for your goal" };
  }
  return { personalized: false, label: "Starter ideas" };
}

/**
 * The header chip, e.g. "Day 21": days you've shown up (planned something),
 * today included. It only grows: missing a day never takes it away.
 */
export function dayChipText(daysShowedUp: number): string {
  return `Day ${Math.max(1, Math.floor(daysShowedUp))}`;
}

export function dayChipLabel(daysShowedUp: number): string {
  const days = Math.max(1, Math.floor(daysShowedUp));
  return days === 1 ? "Day 1 of showing up" : `Day ${days} of showing up`;
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

export interface IdeasEntry {
  label: string;
  /** Filled/primary style: on an empty day ideas are the obvious next step. */
  prominent: boolean;
}

/**
 * The "Need ideas?" button. On an empty day (e.g. right after onboarding) it's
 * the main call to action, so it names the goal and is styled as primary.
 */
export function ideasEntry(taskCount: number, goalTitle: string | null): IdeasEntry {
  if (taskCount === 0) {
    return {
      label: goalTitle ? `See ideas for ${goalTitle}` : "See some ideas",
      prominent: true,
    };
  }
  return { label: "Need ideas?", prominent: false };
}

/** Copy for the lock confirmation; mentions empty slots when there are any. */
export function lockConfirmation(taskCount: number): { title: string; message: string } {
  const open = Math.max(0, MAX_TASKS - taskCount);
  if (open === 0) {
    // All three chosen: nothing is lost by locking, so keep it light.
    return {
      title: "Set today?",
      message: "You can still check tasks off. Editing pauses until tomorrow, or until you tap Change.",
    };
  }
  const slots = open === 1 ? " Your empty slot stays empty." : " Your empty slots stay empty.";
  return {
    title: "Set today?",
    message:
      "You can still check tasks off. Adding and editing pause until you tap Change." + slots,
  };
}

/** "12:00 PM" style time for status copy. */
export function formatClockTime(hour: number, minute: number): string {
  const h = ((hour + 11) % 12) + 1;
  const m = String(minute).padStart(2, "0");
  return `${h}:${m} ${hour < 12 ? "AM" : "PM"}`;
}

/** Local clock time ("12:03 PM") for an ISO timestamp, or null if invalid. */
export function clockTimeOf(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatClockTime(date.getHours(), date.getMinutes());
}

/** Confirmation after a brain dump, e.g. "Added 2. 3 saved for later in Ideas." */
export function brainDumpToast(added: number, saved: number): string | null {
  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${added}.`);
  if (saved > 0) parts.push(`${saved} saved for later in Ideas.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

export type TaskRowAction = "edit" | "notToday" | "breakDown" | "delete";

/**
 * What a row offers, in menu order. The circle alone finishes a task; these
 * are everything else. A set day still allows letting a task go (Not today)
 * and breaking it down, but not editing or deleting.
 */
export function taskRowActions(params: {
  editable: boolean;
  completed: boolean;
  canBreakDown: boolean;
}): TaskRowAction[] {
  const { editable, completed, canBreakDown } = params;
  if (completed) return editable ? ["delete"] : [];
  const actions: TaskRowAction[] = [];
  if (editable) actions.push("edit");
  actions.push("notToday");
  if (canBreakDown) actions.push("breakDown");
  if (editable) actions.push("delete");
  return actions;
}

export const TASK_ROW_ACTION_LABELS: Record<TaskRowAction, string> = {
  edit: "Edit",
  notToday: "Not today",
  breakDown: "Break it down",
  delete: "Delete",
};
