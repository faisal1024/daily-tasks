// A heads-up before a free trial turns into a paid subscription (a courtesy;
// Apple doesn't require it).

import * as Notifications from "expo-notifications";

export const TRIAL_REMINDER_ID = "plus-trial-ending";
const DAYS_BEFORE = 2;
const EARLIEST_HOUR = 9;
const LATEST_HOUR = 20;

/**
 * When to remind: 48 hours before the trial ends, moved into daytime
 * (09:00–20:00) so it never buzzes at night; null if that's passed.
 */
export function trialReminderAt(trialEndsAt: string | null, now: Date = new Date()): Date | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return null;
  const at = new Date(end.getTime() - DAYS_BEFORE * 24 * 60 * 60_000);
  if (at.getHours() < EARLIEST_HOUR) at.setHours(EARLIEST_HOUR, 0, 0, 0);
  else if (at.getHours() >= LATEST_HOUR) at.setHours(LATEST_HOUR, 0, 0, 0);
  // Too late for the two-day heads-up (e.g. a short trial): no reminder.
  return at.getTime() > now.getTime() ? at : null;
}

export function trialReminderBody(trialEndsAt: string): string {
  const day = new Date(trialEndsAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return `Your Plus trial ends ${day}. After that it renews automatically. To stop it, cancel in iPhone Settings › your name › Subscriptions at least a day before.`;
}

/** Replace any scheduled reminder with one for this trial (or none). Never throws. */
export async function syncTrialReminder(trialEndsAt: string | null, now: Date = new Date()): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TRIAL_REMINDER_ID);
    const at = trialReminderAt(trialEndsAt, now);
    if (!at || !trialEndsAt) return;
    await Notifications.scheduleNotificationAsync({
      identifier: TRIAL_REMINDER_ID,
      content: { title: "Your Plus trial ends in 2 days", body: trialReminderBody(trialEndsAt) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    // Notifications off or unavailable: nothing to do.
  }
}
