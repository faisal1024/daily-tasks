import { previousDay } from "./date";
import type { DayRecord, History } from "./types";
import { MAX_TASKS } from "./types";

type Predicate = (record: Pick<DayRecord, "total" | "completed"> | undefined) => boolean;

// Showing up = planning the day. Finishing nothing still counts: the streak is
// about coming back, not about being perfect. The one rule behind "Day N",
// the streak and Today's week row.
export const showedUp: Predicate = (r) => !!r && r.total > 0;
const isPerfect: Predicate = (r) =>
  !!r && r.total === MAX_TASKS && r.completed === MAX_TASKS;

function streak(history: History, today: string, pred: Predicate): number {
  let date = pred(history[today]) ? today : previousDay(today);
  let count = 0;
  while (pred(history[date])) {
    count++;
    date = previousDay(date);
  }
  return count;
}

export function computeDayStreak(history: History, today: string): number {
  return streak(history, today, showedUp);
}

export function computePerfectStreak(history: History, today: string): number {
  return streak(history, today, isPerfect);
}

export function monthlyStats(
  history: History,
  year: number,
  month: number,
): { activeDays: number; perfectDays: number } {
  let activeDays = 0;
  let perfectDays = 0;
  for (const key of Object.keys(history)) {
    const [y, m] = key.split("-").map(Number);
    if (y !== year || m !== month + 1) continue;
    const rec = history[key];
    if (rec.completed > 0) activeDays++;
    if (rec.total === MAX_TASKS && rec.completed === MAX_TASKS) perfectDays++;
  }
  return { activeDays, perfectDays };
}
