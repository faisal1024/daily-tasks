export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

export function addDays(key: string, delta: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

export function previousDay(key: string): string {
  return addDays(key, -1);
}

export function nextDay(key: string): string {
  return addDays(key, 1);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export type GreetingKind = "morning" | "afternoon" | "evening" | "night";

export function greetingFor(now: Date = new Date()): GreetingKind {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17) return "evening";
  return "night";
}

export function greetingText(kind: GreetingKind): string {
  switch (kind) {
    case "morning":
      return "Good morning";
    case "afternoon":
      return "Good afternoon";
    case "evening":
      return "Good evening";
    case "night":
      // After midnight: a plain hello ("Good night" reads as a goodbye).
      return "Hello";
  }
}

export function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatTime(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Whole days from `a` to `b` (date keys); negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromDateKey(b).getTime() - fromDateKey(a).getTime()) / 86_400_000);
}

/**
 * The day the app should be on, given the day its tasks belong to and the
 * clock's day:
 * - clock ahead → follow it (a new day);
 * - clock back by one day (flying west over midnight, a time-zone change) →
 *   stay on the tasks' day, so today's tasks never overwrite yesterday;
 * - clock back by more (a date that was set wrong and then fixed) → follow
 *   the clock, or the app would be stuck until real time caught up.
 */
export function storeDayFor(tasksDay: string, clockDay: string): string {
  if (clockDay >= tasksDay) return clockDay;
  return daysBetween(clockDay, tasksDay) <= 1 ? tasksDay : clockDay;
}
