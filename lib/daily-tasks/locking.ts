export const AUTO_LOCK_HOUR = 12;

export function shouldAutoLockToday(
  now: Date,
  taskCount: number,
  locked: boolean,
): boolean {
  if (locked || taskCount === 0) return false;
  return now.getHours() >= AUTO_LOCK_HOUR;
}
