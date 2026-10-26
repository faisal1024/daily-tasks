// Reminder plans (1.4). A strategy turns what the app knows into a plan (a
// list of notifications to have pending); the scheduler in notifications.ts
// applies any plan. Pure: no notifications API here.
//
// The seam for other styles: write another ReminderStrategy (e.g. lines from
// another source at other times), join it to the mornings with
// combineStrategies, and pass it to syncNotifications; or build a plan
// yourself and hand it to applyReminderPlan. Ids must start with
// MANAGED_REMINDER_PREFIX: that prefix is how the scheduler knows which
// pending notifications are its own to replace.

import { addDays, toDateKey } from "./date";
import {
  cleanReminderText,
  MAX_REMINDER_BODY_CHARS,
  MAX_REMINDER_TITLE_CHARS,
  type ReminderTask,
} from "./reminder-copy";
import {
  MANAGED_REMINDER_PREFIX,
  planReminders,
  planUpcomingMornings,
  type PlannedReminder,
  type ReminderCopyContext,
} from "./reminders";
import type {
  NotificationConfig,
  NotificationPermissionState,
  PendingRollover,
  SundayResetState,
  TomorrowDraft,
} from "./types";

/** One notification to have pending. */
export interface ReminderPlanItem {
  /** Starts with MANAGED_REMINDER_PREFIX; one per id. */
  id: string;
  fireAt: Date;
  title: string;
  body: string;
  /**
   * Passed on as the notification's data (a tap hands it back). Ids and
   * small values only, never task text: `{ taskId }` on an item that names
   * one task.
   */
  data?: Record<string, unknown>;
  /** What sort of reminder this is ("morning", "progress", "evening", or a strategy's own); passed on in the data as `kind`. */
  kind?: string;
  /** iOS interruption level (default "active"). "timeSensitive" needs the entitlement. */
  interruptionLevel?: "passive" | "active" | "timeSensitive" | "critical";
  /** true for the default sound, or a bundled sound's file name. Silent without it. */
  sound?: boolean | string;
  /** A registered notification category, for its buttons (a nag's "Stop for today"). */
  categoryId?: string;
}

export type ReminderPlan = ReminderPlanItem[];

/** A reminder of ours that is pending now (scheduled by an earlier sync). */
export interface PendingReminder {
  id: string;
  /** When it will go off; null when the system doesn't say. */
  fireAt: Date | null;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** 1.6 G: its notification category (its buttons), when it has one. */
  categoryId?: string;
}

/**
 * Everything a strategy may plan from. The standard strategy
 * (taskAwareStrategy) sends none of it anywhere; a strategy that does send
 * something must say so itself.
 */
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
  /**
   * Our reminders that are pending now, soonest first. A strategy with times
   * of its own choosing (e.g. random ones) can keep these instead of picking
   * again on every sync: return the same id, time and words and the
   * scheduler leaves that notification as it is.
   */
  pending: PendingReminder[];
  /**
   * When one of our reminders last went off, as far as is known (one still
   * in Notification Center, or one scheduled since the app started whose
   * time has passed); null when unknown. For spacing, e.g. one an hour.
   */
  lastDeliveredAt: Date | null;
  /** Plus is active, for a strategy that is Plus-only (nag mode). Absent means no. */
  plus?: boolean;
  /** The Sunday reset's switch and weeks (1.6), for its Sunday notification. Absent: none planned. */
  sundayReset?: SundayResetState;
}

export type ReminderStrategy = (context: ReminderContext) => ReminderPlan | Promise<ReminderPlan>;

function toPlanItem(reminder: PlannedReminder): ReminderPlanItem {
  return {
    id: reminder.identifier,
    fireAt: reminder.at,
    title: reminder.title,
    body: reminder.body,
    kind: reminder.kind,
    // The id only: the task's words stay in the title or body.
    ...(reminder.taskId ? { data: { taskId: reminder.taskId } } : {}),
  };
}

/**
 * What the reminders are written from, on the clock's day. The store's day
 * usually is the clock's day. Just after midnight the store can still be on
 * the day before: its tasks are then yesterday's, so the day reads as empty
 * with the open ones "from yesterday". Any further behind and nothing is
 * known about today. A store day ahead of the clock (after flying west)
 * keeps its tasks; planUpcomingMornings writes that day's morning from them.
 */
export function reminderCopyContext(
  context: Pick<ReminderContext, "now" | "today" | "tasks" | "locked" | "yesterdayOpen" | "settings">,
): ReminderCopyContext {
  const { now, today, tasks, locked, yesterdayOpen, settings } = context;
  const hideNames = settings.hideTaskNames;
  const clockDay = toDateKey(now);
  if (today >= clockDay) return { dayKey: today, tasks, locked, yesterdayOpen, hideNames };
  const fromYesterday =
    today === addDays(clockDay, -1) ? tasks.filter((task) => !task.done).map((task) => task.text) : [];
  return { dayKey: clockDay, tasks: [], locked: false, yesterdayOpen: fromYesterday, hideNames };
}

/**
 * The upcoming mornings on their own: one nudge on each of the next few
 * days. For combineStrategies, beside a strategy that plans the rest of the
 * day its own way.
 */
export const morningsStrategy = (context: ReminderContext): ReminderPlan => {
  const { now, settings, permissionState, draft } = context;
  return planUpcomingMornings({ now, settings, permissionState, draft, copy: reminderCopyContext(context) }).map(toPlanItem);
};

/**
 * The standard reminders: the same times as before 1.4 (today's remaining
 * slots plus a morning nudge on each of the next few days), saying what the
 * tasks are unless names are hidden. Written on the phone; sends nothing.
 */
export const taskAwareStrategy = (context: ReminderContext): ReminderPlan => {
  const { now, settings, permissionState, draft } = context;
  const copy = reminderCopyContext(context);
  const planned = [
    ...planReminders({
      now,
      taskCount: copy.tasks.length,
      completedCount: copy.tasks.filter((task) => task.done).length,
      settings,
      permissionState,
      draft,
      copy,
    }),
    ...planUpcomingMornings({ now, settings, permissionState, draft, copy }),
  ];
  return planned.map(toPlanItem);
};

/**
 * One strategy from several: each plans from the same context and the plans
 * are joined, e.g. `combineStrategies(morningsStrategy, another)`. When two
 * plan the same id the earlier strategy's item is kept. If one fails the
 * whole plan fails (nothing is rescheduled; the next sync tries again).
 */
export function combineStrategies(...strategies: ReminderStrategy[]): ReminderStrategy {
  return async (context) => {
    const plans = await Promise.all(strategies.map(async (strategy) => strategy(context)));
    const seen = new Set<string>();
    return plans.flat().filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };
}

/** iOS keeps at most this many pending local notifications per app (the soonest; the rest are dropped silently). */
export const IOS_PENDING_NOTIFICATION_LIMIT = 64;

/**
 * Always left free for notifications this code doesn't own (the focus
 * timer's end, the trial reminder), which may be scheduled after a sync.
 */
export const RESERVED_PENDING_NOTIFICATIONS = 2;

function isDev(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

/**
 * The part of a plan that can be scheduled: owned ids only, still in the
 * future, one per id (the first wins), soonest first, and no more than fit
 * beside the `otherPending` notifications that aren't ours (later ones go).
 * Every item's words are made safe here (one line, no control characters,
 * capped), whichever strategy wrote them.
 */
export function fitPlanToLimit(
  plan: ReminderPlan,
  options: { now: Date; otherPending: number; limit?: number },
): ReminderPlan {
  const { now, otherPending, limit = IOS_PENDING_NOTIFICATION_LIMIT } = options;
  const others = Math.max(RESERVED_PENDING_NOTIFICATIONS, Number.isFinite(otherPending) ? otherPending : 0);
  const room = Math.max(0, Math.floor(limit - others));
  const seen = new Set<string>();
  let foreign = 0;
  const fitted = plan
    .filter((item) => {
      if (typeof item.id !== "string" || !item.id.startsWith(MANAGED_REMINDER_PREFIX)) {
        foreign++;
        return false;
      }
      const time = item.fireAt instanceof Date ? item.fireAt.getTime() : Number.NaN;
      if (!Number.isFinite(time) || time <= now.getTime()) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, room)
    .map((item) => ({
      ...item,
      title: cleanReminderText(item.title, MAX_REMINDER_TITLE_CHARS),
      body: cleanReminderText(item.body, MAX_REMINDER_BODY_CHARS),
    }));
  if (foreign > 0 && isDev()) {
    // A count only: an item's words can be the user's task.
    console.warn(
      `[daily-tasks] dropped ${foreign} planned reminder(s) whose id doesn't start with "${MANAGED_REMINDER_PREFIX}"`,
    );
  }
  return fitted;
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
