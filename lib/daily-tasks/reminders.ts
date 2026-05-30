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
