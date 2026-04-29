import type { AutoLockConfig } from "./types";

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
