// Reminder plans (1.4). A strategy turns what the app knows into a plan (a
// list of notifications to have pending); the scheduler in notifications.ts
// applies any plan. Pure: no notifications API here.
//
// The seam for other styles: write another ReminderStrategy (e.g. lines from
// another source at other times) and pass it to syncNotifications, or build
// a plan yourself and hand it to applyReminderPlan. Ids must start with
// MANAGED_REMINDER_PREFIX: that prefix is how the scheduler knows which
// pending notifications are its own to replace.

import { addDays } from "./date";
import type { ReminderTask } from "./reminder-copy";
import { MANAGED_REMINDER_PREFIX, planReminders, planUpcomingMornings } from "./reminders";
import type {
  NotificationConfig,
  NotificationPermissionState,
  PendingRollover,
  TomorrowDraft,
} from "./types";

/** One notification to have pending. */
export interface ReminderPlanItem {
  /** Starts with MANAGED_REMINDER_PREFIX; one per id. */
  id: string;
  fireAt: Date;
  title: string;
  body: string;
}

export type ReminderPlan = ReminderPlanItem[];

/** Everything a strategy may plan from. Nothing here leaves the phone. */
export interface ReminderContext {
  now: Date;
  /** The store's day (yyyy-MM-dd): the day `tasks` belong to. */
  today: string;
  settings: NotificationConfig;
  permissionState: NotificationPermissionState;
  /** Today's tasks in Today's order. */
  tasks: ReminderTask[];
  /** Today is set (locked). */
  locked: boolean;
  /** Task texts still open from the day before `today`. */
  yesterdayOpen: string[];
  /** Last night's draft, for the morning nudge of its day. */
  draft: TomorrowDraft | null;
}

export type ReminderStrategy = (context: ReminderContext) => ReminderPlan;

/**
 * The standard reminders: the same times as before 1.4 (today's remaining
 * slots plus a morning nudge on each of the next few days), saying what the
 * tasks are unless names are hidden.
 */
export const taskAwareStrategy: ReminderStrategy = (context) => {
  const { now, today, settings, permissionState, tasks, locked, yesterdayOpen, draft } = context;
  const copy = { dayKey: today, tasks, locked, yesterdayOpen, hideNames: settings.hideTaskNames };
  const planned = [
    ...planReminders({
      now,
      taskCount: tasks.length,
      completedCount: tasks.filter((task) => task.done).length,
      settings,
      permissionState,
      draft,
      copy,
    }),
    ...planUpcomingMornings({ now, settings, permissionState, draft, copy }),
  ];
  return planned.map((reminder) => ({
    id: reminder.identifier,
    fireAt: reminder.at,
    title: reminder.title,
    body: reminder.body,
  }));
};

/** iOS keeps at most this many pending local notifications per app (the soonest; the rest are dropped silently). */
export const IOS_PENDING_NOTIFICATION_LIMIT = 64;

/**
 * Always left free for notifications this code doesn't own (the focus
 * timer's end, the trial reminder), which may be scheduled after a sync.
 */
export const RESERVED_PENDING_NOTIFICATIONS = 2;

/**
 * The part of a plan that can be scheduled: owned ids only, still in the
 * future, one per id (the first wins), soonest first, and no more than fit
 * beside the `otherPending` notifications that aren't ours (later ones go).
 */
export function fitPlanToLimit(
  plan: ReminderPlan,
  options: { now: Date; otherPending: number; limit?: number },
): ReminderPlan {
  const { now, otherPending, limit = IOS_PENDING_NOTIFICATION_LIMIT } = options;
  const others = Math.max(RESERVED_PENDING_NOTIFICATIONS, Number.isFinite(otherPending) ? otherPending : 0);
  const room = Math.max(0, Math.floor(limit - others));
  const seen = new Set<string>();
  return plan
    .filter((item) => {
      if (typeof item.id !== "string" || !item.id.startsWith(MANAGED_REMINDER_PREFIX)) return false;
      const time = item.fireAt instanceof Date ? item.fireAt.getTime() : Number.NaN;
      if (!Number.isFinite(time) || time <= now.getTime()) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, room);
}

/**
 * Task texts still open from the day before `today`: the ones waiting on
 * Today's "from yesterday" card. Ones already carried into today or let go
 * aren't open any more, and neither is anything from an older day.
 */
export function yesterdayOpenTexts(
  state: { pendingRollover: PendingRollover | null },
  today: string,
): string[] {
  const pending = state.pendingRollover;
  if (!pending || pending.sourceDate !== addDays(today, -1)) return [];
  return pending.tasks.filter((task) => !task.completed).map((task) => task.text);
}

/** How long task changes settle before the reminders are rewritten. */
export const REMINDER_SYNC_DEBOUNCE_MS = 500;

export interface Debounced {
  /** Run after the delay; asking again first restarts the wait (one run for a burst). */
  request(): void;
  /** Run now if a run is waiting (e.g. the app is going to the background). */
  flush(): void;
  /** Drop a waiting run. */
  cancel(): void;
  pending(): boolean;
}

export function createDebounced(run: () => void, delayMs: number = REMINDER_SYNC_DEBOUNCE_MS): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    request() {
      clear();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    flush() {
      if (timer === null) return;
      clear();
      run();
    },
    cancel: clear,
    pending: () => timer !== null,
  };
}
