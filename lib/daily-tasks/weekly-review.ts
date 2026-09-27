// Weekly review: a calm look back at the last seven days (Phase 6).
//
// Pure: built from saved history only. The headline, bars and counts are
// free; the patterns (vs last week, best weekday, tasks that keep sliding)
// are Plus.
//
// Today is shown in the bars, but a day still in progress never counts
// against the week: its planned tasks only count once it's finished, and it's
// left out of the weekday patterns. What's already done today always counts.

import { addDays, fromDateKey } from "./date";
import type { History } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ReviewDay {
  date: string;
  /** Single-letter label for the bar chart ("M", "T", ...). */
  letter: string;
  weekday: string;
  isToday: boolean;
  total: number;
  completed: number;
  perfect: boolean;
}

export interface StuckTask {
  text: string;
  /** How many times it was carried to the next day in the last two weeks. */
  times: number;
}

export interface WeeklyReview {
  days: ReviewDay[];
  /** Tasks done in the last seven days, today's so far included. */
  completed: number;
  perfectDays: number;
  showedUpDays: number;
  /** Tasks done in the seven days before that, or null without enough days to compare. */
  previousCompleted: number | null;
  /** Weekday that clearly goes best over the last four weeks, if any. */
  bestWeekday: string | null;
  stuck: StuckTask[];
  /** No planned day before today at all: a brand-new user. */
  firstWeek: boolean;
  headline: string;
}

function lastDays(today: string, count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, -(offset + count - 1 - i)));
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The weekday that clearly goes best: over the 28 days before today, with at
 * least a week of tracked days, two or more of that weekday, four or more
 * tasks planned on it, and a completion rate at least 10 points above the
 * overall rate. Otherwise null (no "Mondays go best" when every day is equal).
 */
export function bestWeekday(history: History, today: string): string | null {
  const stats = new Map<number, { completed: number; planned: number; days: number }>();
  let trackedDays = 0;
  let allCompleted = 0;
  let allPlanned = 0;
  for (const date of lastDays(today, 28, 1)) {
    const record = history[date];
    if (!record || record.total === 0) continue;
    trackedDays += 1;
    allCompleted += record.completed;
    allPlanned += record.total;
    const day = fromDateKey(date).getDay();
    const entry = stats.get(day) ?? { completed: 0, planned: 0, days: 0 };
    entry.completed += record.completed;
    entry.planned += record.total;
    entry.days += 1;
    stats.set(day, entry);
  }
  if (trackedDays < 7 || allPlanned === 0) return null;
  const overall = allCompleted / allPlanned;
  let best: { day: number; rate: number } | null = null;
  for (const [day, entry] of stats) {
    if (entry.days < 2 || entry.planned < 4) continue;
    const rate = entry.completed / entry.planned;
    if (rate - overall < 0.1) continue;
    if (!best || rate > best.rate + 1e-9) best = { day, rate };
  }
  return best ? WEEKDAYS[best.day] : null;
}

/** Tasks carried over to the next day at least twice in the last 14 days. */
export function stuckTasks(history: History, today: string, limit = 3): StuckTask[] {
  const counts = new Map<string, StuckTask>();
  for (const date of lastDays(today, 14)) {
    for (const task of history[date]?.tasks ?? []) {
      if (task.rolloverOutcome !== "carried") continue;
      const key = normalize(task.text);
      if (!key) continue;
      const entry = counts.get(key) ?? { text: task.text.trim(), times: 0 };
      entry.times += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .filter((entry) => entry.times >= 2)
    .sort((a, b) => b.times - a.times || a.text.localeCompare(b.text))
    .slice(0, limit);
}

export function weeklyHeadline(input: {
  completed: number;
  perfectDays: number;
  showedUpDays: number;
  previousCompleted: number | null;
  plannedToday: boolean;
  firstWeek: boolean;
}): string {
  if (input.completed === 0) {
    if (input.plannedToday) return "Your week starts with today's three.";
    return input.firstWeek
      ? "Your first week starts here."
      : "A quiet week. One small task tomorrow is plenty.";
  }
  if (input.perfectDays >= 5) return `What a week: ${input.perfectDays} perfect days.`;
  if (input.previousCompleted !== null && input.completed - input.previousCompleted >= 3) {
    return "Up from last week. That's real momentum.";
  }
  if (input.showedUpDays >= 4) return `You showed up ${input.showedUpDays} days this week.`;
  const tasks = input.completed === 1 ? "1 task" : `${input.completed} tasks`;
  return `${tasks} done. Every one counts.`;
}

/** The seven days ending today. */
export function buildWeeklyReview(history: History, today: string): WeeklyReview {
  const dates = lastDays(today, 7);
  const days: ReviewDay[] = dates.map((date) => {
    const record = history[date];
    const weekday = WEEKDAYS[fromDateKey(date).getDay()];
    const total = record?.total ?? 0;
    const completed = record?.completed ?? 0;
    return {
      date,
      letter: weekday.charAt(0),
      weekday,
      isToday: date === today,
      total,
      completed,
      perfect: total > 0 && completed === total,
    };
  });

  const completed = days.reduce((sum, day) => sum + day.completed, 0);
  const perfectDays = days.filter((day) => day.perfect).length;
  const showedUpDays = days.filter((day) => day.completed > 0).length;

  // Compare with the seven days before, but only against a real baseline.
  const previousDates = lastDays(today, 7, 7);
  const previousTracked = previousDates.filter((date) => (history[date]?.total ?? 0) > 0).length;
  const previousCompleted =
    previousTracked >= 3
      ? previousDates.reduce((sum, date) => sum + (history[date]?.completed ?? 0), 0)
      : null;

  const firstWeek = !Object.values(history).some((record) => record.date < today && record.total > 0);
  const plannedToday = (history[today]?.total ?? 0) > 0;

  return {
    days,
    completed,
    perfectDays,
    showedUpDays,
    previousCompleted,
    bestWeekday: bestWeekday(history, today),
    stuck: stuckTasks(history, today),
    firstWeek,
    headline: weeklyHeadline({
      completed,
      perfectDays,
      showedUpDays,
      previousCompleted,
      plannedToday,
      firstWeek,
    }),
  };
}

/** Plain comparison with last week in task counts, or null without a baseline. */
export function comparisonText(review: WeeklyReview): string | null {
  const before = review.previousCompleted;
  if (before === null) return null;
  const now = review.completed;
  if (Math.abs(now - before) <= 1) return "About the same as last week. Steady is good.";
  const tasks = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);
  return now > before
    ? `You finished ${tasks(now)}, up from ${before} last week.`
    : `Lighter than last week. You still finished ${tasks(now)}. Lighter weeks happen.`;
}

/** Whether there's anything for the Plus patterns to show yet. */
export function hasInsights(review: WeeklyReview): boolean {
  return comparisonText(review) !== null || review.bestWeekday !== null || review.stuck.length > 0;
}
