import type { AutoLockConfig } from "./types";

/**
 * Count tasks committed at or before today's lock time. Tasks added AFTER the
 * lock time (e.g. starting your day in the afternoon) are not eligible, so
 * adding your first task after noon never instantly locks the day.
 */
export function autoLockEligibleTaskCount(
  tasks: { createdAt: string }[],
  today: string,
  settings: AutoLockConfig,
): number {
  const [year, month, day] = today.split("-").map(Number);
  const lockAt = new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    settings.hour,
    settings.minute,
  ).getTime();
  return tasks.filter((task) => {
    const created = new Date(task.createdAt).getTime();
    return Number.isNaN(created) || created <= lockAt;
  }).length;
}

export function shouldAutoLockToday(
  now: Date,
  taskCount: number,
  locked: boolean,
  settings: AutoLockConfig,
): boolean {
  if (!settings.enabled || locked || taskCount === 0) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const lockMinutes = settings.hour * 60 + settings.minute;
  return nowMinutes >= lockMinutes;
}
