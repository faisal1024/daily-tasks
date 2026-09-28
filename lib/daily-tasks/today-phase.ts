// Today by time of day (1.2): which lower section Today shows right now.
//
// Pure, so it can be unit-tested; the screen passes the hour from useHour().

import { showEveningCheckIn } from "./evening";
import { reviewDays } from "./weekly-review";
import { showedUp } from "./streaks";
import { dayChipText } from "./today-view";
import type { History } from "./types";
import { MAX_TASKS } from "./types";

export type TodayPhase = "plan" | "morning" | "midday" | "evening" | "done";

/** The hour (local) the morning ends and midday begins. */
export const MIDDAY_HOUR = 12;

export function todayPhase(input: {
  taskCount: number;
  completedCount: number;
  /** Local hour, 0–23. */
  hour: number;
  /** momentumSettings.eveningReflection */
  eveningEnabled: boolean;
}): TodayPhase {
  if (input.taskCount <= 0) return "plan";
  // Everything ticked off: done, at any hour.
  if (input.completedCount >= input.taskCount) return "done";
  // Same rule as the evening check-in, so the two can never disagree.
  if (
    showEveningCheckIn({
      taskCount: input.taskCount,
      perfect: false,
      hour: input.hour,
      enabled: input.eveningEnabled,
    })
  ) {
    return "evening";
  }
  // Midday is also the fallback after 17:00 when the check-in is off.
  return input.hour < MIDDAY_HOUR ? "morning" : "midday";
}

export interface WeekDot {
  date: string;
  /** Single-letter weekday ("M", "T", ...). */
  letter: string;
  isToday: boolean;
  /** Showed up that day (the same rule as "Day N" and Progress). */
  filled: boolean;
}

export interface WeekSummary {
  /** The seven days ending today, oldest first. */
  days: WeekDot[];
  /** Days shown up in those seven, today included once it counts. */
  showedUpDays: number;
  /** Tasks done in those seven, today's so far included. */
  tasksDone: number;
}

/**
 * The last seven days for the week row and the done card. `live` is today as
 * the screen sees it right now, so the row never lags the list above it.
 */
export function buildWeekSummary(
  history: History,
  today: string,
  live?: { total: number; completed: number },
): WeekSummary {
  const days = reviewDays(history, today).map((day) =>
    day.isToday && live ? { ...day, total: live.total, completed: live.completed } : day,
  );
  const dots = days.map((day) => ({
    date: day.date,
    letter: day.letter,
    isToday: day.isToday,
    filled: showedUp(day),
  }));
  return {
    days: dots,
    showedUpDays: dots.filter((dot) => dot.filled).length,
    tasksDone: days.reduce((sum, day) => sum + Math.max(0, day.completed), 0),
  };
}

/** VoiceOver label for the week row. */
export function weekRowLabel(showedUpDays: number, daysShowedUp: number): string {
  return `This week: ${showedUpDays} of 7 days. ${dayChipText(daysShowedUp)}. Opens Progress.`;
}

/** The done card's title: "3 of 3" for a full day, otherwise "All done". */
export function doneCardTitle(total: number): string {
  return total >= MAX_TASKS ? "3 of 3. Rest is part of it." : "All done. Rest is part of it.";
}

/** Small wins from the last seven days: positive counts only, never misses. */
export function smallWinsLine(summary: Pick<WeekSummary, "showedUpDays" | "tasksDone">): string {
  if (summary.showedUpDays <= 1) return "Your first finished day this week.";
  const tasks = summary.tasksDone === 1 ? "1 task" : `${summary.tasksDone} tasks`;
  return `This week: ${summary.showedUpDays} days, ${tasks} done`;
}
