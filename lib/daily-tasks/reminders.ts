import { addDays, toDateKey } from "./date";
import {
  buildReminderCopy,
  GENERIC_REMINDER_COPY,
  reminderTaskName,
  type ReminderCopy,
  type ReminderKind,
  type ReminderTask,
} from "./reminder-copy";
import type { NotificationConfig, NotificationPermissionState, TomorrowDraft } from "./types";

export type { ReminderKind } from "./reminder-copy";

export const MANAGED_REMINDER_PREFIX = "daily-tasks:";
/** Nag mode (1.4): a nag's `kind`, in its id (`daily-tasks:<day>:nag:<HHmm>`) and its data. */
export const NAG_KIND = "nag";
/** The notification category that gives a nag its "Stop for today" button. */
export const NAG_CATEGORY_ID = "three-today:nag";

export const REMINDER_HOURS = {
  weekdayMorningStart: 8,
  weekendMorningStart: 10,
  morningEnd: 12,
  progressStart: 10,
  progressEnd: 16,
  progressStep: 2,
  hourlyStart: 8,
  hourlyEnd: 21,
  eveningStart: 17,
  eveningEnd: 22,
} as const;

/**
 * What the reminders can be written from (1.4). Without it they use the
 * general wording.
 */
export interface ReminderCopyContext {
  /**
   * The day these tasks belong to (yyyy-MM-dd). Usually the clock's day; a
   * day ahead of it after flying west (see planUpcomingMornings).
   */
  dayKey: string;
  /** That day's tasks, in Today's order. */
  tasks: ReminderTask[];
  /** The day is set (locked). */
  locked: boolean;
  /** Task texts still open from the day before `dayKey`. */
  yesterdayOpen: string[];
  /** Settings › Reminders › "Hide task names in notifications". */
  hideNames: boolean;
}

export interface ReminderPlanInput {
  now: Date;
  taskCount: number;
  completedCount: number;
  settings: NotificationConfig;
  permissionState: NotificationPermissionState;
  /** Last night's draft: the morning nudge for its day carries the tasks. */
  draft?: TomorrowDraft | null;
  /** Today's tasks, for reminders that name them (general wording without). */
  copy?: ReminderCopyContext | null;
}

function hasDraftFor(dayKey: string, draft: TomorrowDraft | null | undefined): draft is TomorrowDraft {
  return !!draft && draft.forDate === dayKey && draft.tasks.length > 0;
}

/**
 * Morning copy with the draft in it ("Your three for Tuesday: A · B · C"), so
 * the notification itself is the plan. Falls back to the plain nudge.
 */
export function morningCopy(dayKey: string, draft: TomorrowDraft | null | undefined): ReminderCopy {
  if (!hasDraftFor(dayKey, draft)) return REMINDER_COPY.morning;
  // Made safe like any task name: one line each, no control characters, capped.
  const names = draft.tasks.map((text) => reminderTaskName(text)).filter((name) => name.length > 0);
  if (names.length === 0) return REMINDER_COPY.morning;
  const [y, m, d] = dayKey.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
  return { title: `Your three for ${weekday}`, body: names.join(" · ") };
}

/**
 * A morning nudge on a day with nothing picked: the draft when there is one
 * for that day (and names aren't hidden), else what's still open from the
 * day before, else a plain prompt.
 */
function emptyDayMorningCopy(input: {
  dayKey: string;
  slotIndex: number;
  draft: TomorrowDraft | null | undefined;
  copy: ReminderCopyContext | null | undefined;
  locked: boolean;
  yesterdayOpen: string[];
  certain: boolean;
}): ReminderCopy {
  const { dayKey, slotIndex, draft, copy, locked, yesterdayOpen, certain } = input;
  if (!copy) return morningCopy(dayKey, draft);
  if (copy.hideNames) return REMINDER_COPY.morning;
  if (hasDraftFor(dayKey, draft)) return morningCopy(dayKey, draft);
  return (
    buildReminderCopy({
      kind: "morning",
      dayKey,
      slotIndex,
      tasks: [],
      locked,
      yesterdayOpen,
      hideNames: false,
      certain,
    }) ?? REMINDER_COPY.morning
  );
}

export interface PlannedReminder {
  identifier: string;
  kind: ReminderKind;
  at: Date;
  title: string;
  body: string;
  /** The id of the one task the words name, if they name one (never its text). */
  taskId?: string;
}

const REMINDER_COPY = GENERIC_REMINDER_COPY;

export function canScheduleReminders(
  permissionState: NotificationPermissionState,
): boolean {
  return permissionState === "granted";
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function buildReminderIdentifier(kind: ReminderKind, at: Date): string {
  const hour = String(at.getHours()).padStart(2, "0");
  const minute = String(at.getMinutes()).padStart(2, "0");
  return `${MANAGED_REMINDER_PREFIX}${toDateKey(at)}:${kind}:${hour}${minute}`;
}

function candidateAt(base: Date, hour: number): Date {
  const at = new Date(base);
  at.setHours(hour, 0, 0, 0);
  return at;
}

/** A reminder with its place in the whole day's schedule (see ReminderCopyInput.slotIndex). */
interface Candidate {
  reminder: PlannedReminder;
  slotIndex: number;
}

/** `firstSlot`: how many of the day's slots come before these (the kinds share one count). */
function collectCandidates(
  now: Date,
  kind: ReminderKind,
  hours: number[],
  firstSlot = 0,
): Candidate[] {
  const copy = REMINDER_COPY[kind];

  return hours
    .map((hour, index) => ({ at: candidateAt(now, hour), slotIndex: firstSlot + index }))
    .filter(({ at }) => at.getTime() > now.getTime())
    .map(({ at, slotIndex }) => ({
      slotIndex,
      reminder: {
        identifier: buildReminderIdentifier(kind, at),
        kind,
        at,
        title: copy.title,
        body: copy.body,
      },
    }));
}

function range(startHour: number, endHour: number, step: number): number[] {
  const hours: number[] = [];
  for (let hour = startHour; hour <= endHour; hour += step) {
    hours.push(hour);
  }
  return hours;
}

/**
 * Today's remaining reminders. The times depend only on the settings and the
 * counts (unchanged in 1.4); `copy` only changes what they say.
 */
export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const { now, taskCount, completedCount, settings, permissionState, draft, copy } = input;

  if (!settings.enabled || !canScheduleReminders(permissionState)) {
    return [];
  }

  if (taskCount > 0 && completedCount >= taskCount) {
    return [];
  }

  if (taskCount === 0) {
    if (!settings.morning) return [];
    const startHour = isWeekend(now)
      ? REMINDER_HOURS.weekendMorningStart
      : REMINDER_HOURS.weekdayMorningStart;
    const dayKey = toDateKey(now);
    // Nothing on an empty day can change without the app (the widget has
    // nothing to tick), so every slot can be plain about it.
    return collectCandidates(now, "morning", range(startHour, REMINDER_HOURS.morningEnd, 1)).map(
      ({ reminder, slotIndex }) => ({
        ...reminder,
        ...emptyDayMorningCopy({
          dayKey,
          slotIndex,
          draft,
          copy,
          locked: copy?.locked ?? false,
          yesterdayOpen: copy?.yesterdayOpen ?? [],
          certain: true,
        }),
      }),
    );
  }

  // The next reminder is written from what's true now (counts and all). The
  // ones after it may arrive after a tick the app never saw (the widget
  // ticks without running it), so they leave counts out; opening the app
  // rewrites them.
  const withTaskCopy = (candidates: Candidate[]): PlannedReminder[] => {
    if (!copy || candidates.length === 0) return candidates.map(({ reminder }) => reminder);
    const dayKey = toDateKey(now);
    const firstAt = Math.min(...candidates.map(({ reminder }) => reminder.at.getTime()));
    return candidates.map(({ reminder, slotIndex }) => {
      const words = buildReminderCopy({
        kind: reminder.kind,
        dayKey,
        slotIndex,
        tasks: copy.tasks,
        locked: copy.locked,
        yesterdayOpen: copy.yesterdayOpen,
        hideNames: copy.hideNames,
        certain: reminder.at.getTime() === firstAt,
        // "Every hour" runs its progress reminders into the evening.
        evening: reminder.kind === "evening" || reminder.at.getHours() >= REMINDER_HOURS.eveningStart,
      });
      return words ? { ...reminder, ...words } : reminder;
    });
  };

  // Hourly mode replaces the spaced progress + evening nudges with one every
  // hour across the day, while tasks remain unfinished.
  if (settings.hourly) {
    return withTaskCopy(
      collectCandidates(
        now,
        "progress",
        range(REMINDER_HOURS.hourlyStart, REMINDER_HOURS.hourlyEnd, 1),
      ),
    );
  }

  const reminders: Candidate[] = [];
  const progressHours = settings.progress
    ? range(REMINDER_HOURS.progressStart, REMINDER_HOURS.progressEnd, REMINDER_HOURS.progressStep)
    : [];

  if (settings.progress) {
    reminders.push(...collectCandidates(now, "progress", progressHours));
  }

  if (settings.evening) {
    reminders.push(
      ...collectCandidates(
        now,
        "evening",
        range(REMINDER_HOURS.eveningStart, REMINDER_HOURS.eveningEnd, 1),
        // The evening's slots count on from the afternoon's, so 16:00 and
        // 17:00 are neighbours and never read the same.
        progressHours.length,
      ),
    );
  }

  return withTaskCopy(reminders);
}

/** How many days ahead a morning nudge is scheduled (iOS allows 64 pending). */
export const UPCOMING_MORNING_DAYS = 6;

/**
 * One gentle morning nudge on each of the next few days. Today's reminders
 * are only planned when the app runs, so without these a day the app isn't
 * opened (exactly when a nudge matters) would get none. Rescheduled on every
 * sync, so opening the app replaces them with the day's real plan.
 *
 * The morning after the tasks' day is written from what's still open on it
 * (1.4), so it's right even if the app isn't opened first: "from yesterday"
 * is relative to the day it arrives. Usually that is tomorrow. After flying
 * west the tasks' day can be the clock's tomorrow: that morning is then
 * written from the set tasks themselves, and the one after it from what's
 * open. Other days have nothing to go on and ask plainly.
 */
export function planUpcomingMornings(input: {
  now: Date;
  settings: NotificationConfig;
  permissionState: NotificationPermissionState;
  days?: number;
  draft?: TomorrowDraft | null;
  /** The tasks and their day, for the nudges that name them (general wording without). */
  copy?: ReminderCopyContext | null;
}): PlannedReminder[] {
  const { now, settings, permissionState, days = UPCOMING_MORNING_DAYS, draft, copy } = input;
  if (!settings.enabled || !settings.morning || !canScheduleReminders(permissionState)) return [];
  const stillOpen = copy ? copy.tasks.filter((task) => !task.done).map((task) => task.text) : [];
  const dayAfterTasks = copy ? addDays(copy.dayKey, 1) : null;
  const out: PlannedReminder[] = [];
  for (let offset = 1; offset <= days; offset++) {
    // Calendar arithmetic (not +24h) so DST changes keep the local hour.
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dayKey = toDateKey(day);
    const hour = isWeekend(day)
      ? REMINDER_HOURS.weekendMorningStart
      : REMINDER_HOURS.weekdayMorningStart;
    const at = candidateAt(day, hour);
    let words: ReminderCopy | null;
    if (copy && copy.dayKey === dayKey && copy.tasks.length > 0) {
      // The tasks' own day, still ahead of the clock: its morning names
      // them (written ahead, so no counts). Nothing if they're all done.
      words = buildReminderCopy({
        kind: "morning",
        dayKey,
        slotIndex: 0,
        tasks: copy.tasks,
        locked: copy.locked,
        yesterdayOpen: [],
        hideNames: copy.hideNames,
        certain: false,
      });
    } else {
      words = emptyDayMorningCopy({
        dayKey,
        slotIndex: 0,
        draft,
        copy,
        // A new day starts open, whatever today's lock says.
        locked: false,
        yesterdayOpen: dayKey === dayAfterTasks ? stillOpen : [],
        // Written a day or more ahead.
        certain: false,
      });
    }
    if (!words) continue;
    out.push({
      ...words,
      identifier: buildReminderIdentifier("morning", at),
      kind: "morning",
      at,
    });
  }
  return out;
}
