// Focus mode remembers the last custom timer length (1.2), so it can offer it
// as a chip next time, and (1.3) the last length used at all, which a task's
// timer menu lists first. Best-effort: a failed read or write just means no
// chip, or the usual order.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { FOCUS_TIMER_MAX_MINUTES, FOCUS_TIMER_MIN_MINUTES } from "./focus-timer";

export const LAST_CUSTOM_TIMER_KEY = "daily-tasks/focus-last-custom-minutes";
export const LAST_TIMER_KEY = "daily-tasks/focus-last-minutes";

async function loadMinutes(key: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    const minutes = Number(raw);
    if (!Number.isInteger(minutes) || minutes < FOCUS_TIMER_MIN_MINUTES || minutes > FOCUS_TIMER_MAX_MINUTES) {
      return null;
    }
    return minutes;
  } catch {
    return null;
  }
}

async function saveMinutes(key: string, minutes: number): Promise<void> {
  try {
    await AsyncStorage.setItem(key, String(minutes));
  } catch {
    // Best-effort: next time just won't offer it.
  }
}

/** The last custom length in minutes, or null when none (or unreadable). */
export function loadLastCustomTimer(): Promise<number | null> {
  return loadMinutes(LAST_CUSTOM_TIMER_KEY);
}

export function saveLastCustomTimer(minutes: number): Promise<void> {
  return saveMinutes(LAST_CUSTOM_TIMER_KEY, minutes);
}

/** The last timer length started (any length; not a starter), or null. */
export function loadLastTimer(): Promise<number | null> {
  return loadMinutes(LAST_TIMER_KEY);
}

export function saveLastTimer(minutes: number): Promise<void> {
  return saveMinutes(LAST_TIMER_KEY, minutes);
}
