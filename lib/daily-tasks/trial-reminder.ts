// A heads-up before a free trial turns into a paid subscription: kind, and
// what App Review expects from apps with trials.

import * as Notifications from "expo-notifications";

export const TRIAL_REMINDER_ID = "plus-trial-ending";
const DAYS_BEFORE = 2;
const HOUR = 10;

/** When to remind: 10:00, two days before the trial ends; null if that's passed. */
export function trialReminderAt(trialEndsAt: string | null, now: Date = new Date()): Date | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return null;
  const at = new Date(end.getFullYear(), end.getMonth(), end.getDate() - DAYS_BEFORE, HOUR, 0, 0, 0);
  // Too late for the two-day heads-up (e.g. a short trial): no reminder.
  return at.getTime() > now.getTime() ? at : null;
}

export function trialReminderBody(trialEndsAt: string): string {
  const day = new Date(trialEndsAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return `Your Plus trial ends ${day}. Keep going, or cancel any time in Settings before then.`;
}

/** Replace any scheduled reminder with one for this trial (or none). Never throws. */
export async function syncTrialReminder(trialEndsAt: string | null, now: Date = new Date()): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TRIAL_REMINDER_ID);
    const at = trialReminderAt(trialEndsAt, now);
    if (!at || !trialEndsAt) return;
    await Notifications.scheduleNotificationAsync({
      identifier: TRIAL_REMINDER_ID,
      content: { title: "Your trial ends in 2 days", body: trialReminderBody(trialEndsAt) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    // Notifications off or unavailable: nothing to do.
  }
}
