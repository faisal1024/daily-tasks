import { toDateKey } from "./date";
import type { NotificationConfig, NotificationPermissionState } from "./types";

export const MANAGED_REMINDER_PREFIX = "daily-tasks:";

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

export type ReminderKind = "morning" | "progress" | "evening";

export interface ReminderPlanInput {
  now: Date;
  taskCount: number;
  completedCount: number;
  settings: NotificationConfig;
  permissionState: NotificationPermissionState;
}

export interface PlannedReminder {
  identifier: string;
  kind: ReminderKind;
  at: Date;
  title: string;
  body: string;
}

const REMINDER_COPY: Record<ReminderKind, { title: string; body: string }> = {
  morning: {
    title: "A calm start",
    body: "Choose Today's Three.",
  },
  progress: {
    title: "A small nudge",
    body: "Today's Three still need a little attention.",
  },
  evening: {
    title: "Still time today",
    body: "A small finish is still a finish.",
  },
};

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

function collectCandidates(
  now: Date,
  kind: ReminderKind,
  hours: number[],
): PlannedReminder[] {
  const copy = REMINDER_COPY[kind];

  return hours
    .map((hour) => candidateAt(now, hour))
    .filter((at) => at.getTime() > now.getTime())
    .map((at) => ({
      identifier: buildReminderIdentifier(kind, at),
      kind,
      at,
      title: copy.title,
      body: copy.body,
    }));
}

function range(startHour: number, endHour: number, step: number): number[] {
  const hours: number[] = [];
  for (let hour = startHour; hour <= endHour; hour += step) {
    hours.push(hour);
  }
  return hours;
}

export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const { now, taskCount, completedCount, settings, permissionState } = input;

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
    return collectCandidates(
      now,
      "morning",
      range(startHour, REMINDER_HOURS.morningEnd, 1),
    );
  }

  // Hourly mode replaces the spaced progress + evening nudges with one every
  // hour across the day, while tasks remain unfinished.
  if (settings.hourly) {
    return collectCandidates(
      now,
      "progress",
      range(REMINDER_HOURS.hourlyStart, REMINDER_HOURS.hourlyEnd, 1),
    );
  }

  const reminders: PlannedReminder[] = [];

  if (settings.progress) {
    reminders.push(
      ...collectCandidates(
        now,
        "progress",
        range(
          REMINDER_HOURS.progressStart,
          REMINDER_HOURS.progressEnd,
          REMINDER_HOURS.progressStep,
        ),
      ),
    );
  }

  if (settings.evening) {
    reminders.push(
      ...collectCandidates(
        now,
        "evening",
        range(REMINDER_HOURS.eveningStart, REMINDER_HOURS.eveningEnd, 1),
      ),
    );
  }

  return reminders;
}

/** How many days ahead a morning nudge is scheduled (iOS allows 64 pending). */
export const UPCOMING_MORNING_DAYS = 6;

/**
 * One gentle morning nudge on each of the next few days. Today's reminders
 * are only planned when the app runs, so without these a day the app isn't
 * opened (exactly when a nudge matters) would get none. Rescheduled on every
 * sync, so opening the app replaces them with the day's real plan.
 */
export function planUpcomingMornings(input: {
  now: Date;
  settings: NotificationConfig;
  permissionState: NotificationPermissionState;
  days?: number;
}): PlannedReminder[] {
  const { now, settings, permissionState, days = UPCOMING_MORNING_DAYS } = input;
  if (!settings.enabled || !settings.morning || !canScheduleReminders(permissionState)) return [];
  const copy = REMINDER_COPY.morning;
  const out: PlannedReminder[] = [];
  for (let offset = 1; offset <= days; offset++) {
    // Calendar arithmetic (not +24h) so DST changes keep the local hour.
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const hour = isWeekend(day)
      ? REMINDER_HOURS.weekendMorningStart
      : REMINDER_HOURS.weekdayMorningStart;
    const at = candidateAt(day, hour);
    out.push({
      identifier: buildReminderIdentifier("morning", at),
      kind: "morning",
      at,
      title: copy.title,
      body: copy.body,
    });
  }
  return out;
}
