// Weekly review: a calm look back at the last seven days (Phase 6).
//
// Pure: built from saved history only. The headline and bars are free; the
// patterns (vs last week, best weekday, tasks that keep sliding) are Plus.

import { addDays, fromDateKey } from "./date";
import type { History } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ReviewDay {
  date: string;
  /** Single-letter label for the bar chart ("M", "T", ...). */
  letter: string;
  weekday: string;
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
  completed: number;
  planned: number;
  /** completed / planned, or null when nothing was planned. */
  rate: number | null;
  perfectDays: number;
  showedUpDays: number;
  previous: { completed: number; rate: number | null };
  /** Weekday with the best completion rate over the last four weeks, if clear. */
  bestWeekday: string | null;
  stuck: StuckTask[];
  headline: string;
}

function summarize(history: History, dates: string[]) {
  let completed = 0;
  let planned = 0;
  for (const date of dates) {
    const record = history[date];
    if (!record) continue;
    completed += record.completed;
    planned += record.total;
  }
  return { completed, planned, rate: planned > 0 ? completed / planned : null };
}

function lastDays(today: string, count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, -(offset + count - 1 - i)));
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The weekday that goes best (needs at least two tracked days of it and a week of data). */
export function bestWeekday(history: History, today: string): string | null {
  const stats = new Map<number, { completed: number; planned: number; days: number }>();
  let trackedDays = 0;
  for (const date of lastDays(today, 28)) {
    const record = history[date];
    if (!record || record.total === 0) continue;
    trackedDays += 1;
    const day = fromDateKey(date).getDay();
    const entry = stats.get(day) ?? { completed: 0, planned: 0, days: 0 };
    entry.completed += record.completed;
    entry.planned += record.total;
    entry.days += 1;
    stats.set(day, entry);
  }
  if (trackedDays < 7) return null;
  let best: { day: number; rate: number; completed: number } | null = null;
  for (const [day, entry] of stats) {
    if (entry.days < 2) continue;
    const rate = entry.completed / entry.planned;
    if (
      !best ||
      rate > best.rate + 1e-9 ||
      (Math.abs(rate - best.rate) <= 1e-9 && entry.completed > best.completed)
    ) {
      best = { day, rate, completed: entry.completed };
    }
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
  planned: number;
  completed: number;
  perfectDays: number;
  showedUpDays: number;
  rate: number | null;
  previousRate: number | null;
}): string {
  if (input.planned === 0) return "A quiet week. One small task tomorrow is a great restart.";
  if (input.perfectDays >= 5) return `What a week: ${input.perfectDays} perfect days.`;
  if (input.rate !== null && input.previousRate !== null && input.rate - input.previousRate >= 0.1) {
    return "Up from last week. That's real momentum.";
  }
  if (input.showedUpDays >= 4) return `You showed up ${input.showedUpDays} days this week.`;
  const tasks = input.completed === 1 ? "1 task" : `${input.completed} tasks`;
  return input.completed > 0
    ? `${tasks} done this week. Every one counts.`
    : "This week was tough. Tomorrow is a fresh start.";
}

/** The seven days ending today (today included, so progress shows up as it happens). */
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
      total,
      completed,
      perfect: total > 0 && completed === total,
    };
  });
  const week = summarize(history, dates);
  const previous = summarize(history, lastDays(today, 7, 7));
  const perfectDays = days.filter((day) => day.perfect).length;
  const showedUpDays = days.filter((day) => day.completed > 0).length;
  return {
    days,
    completed: week.completed,
    planned: week.planned,
    rate: week.rate,
    perfectDays,
    showedUpDays,
    previous: { completed: previous.completed, rate: previous.rate },
    bestWeekday: bestWeekday(history, today),
    stuck: stuckTasks(history, today),
    headline: weeklyHeadline({
      planned: week.planned,
      completed: week.completed,
      perfectDays,
      showedUpDays,
      rate: week.rate,
      previousRate: previous.rate,
    }),
  };
}

/** Plain comparison with last week, or null when there's no baseline. */
export function comparisonText(review: WeeklyReview): string | null {
  if (review.rate === null || review.previous.rate === null) return null;
  const now = Math.round(review.rate * 100);
  const before = Math.round(review.previous.rate * 100);
  if (now === before) return `You finished ${now}% of what you planned, same as last week. Steady is good.`;
  return now > before
    ? `You finished ${now}% of what you planned, up from ${before}% last week.`
    : `You finished ${now}% of what you planned (${before}% last week). Lighter weeks happen.`;
}
