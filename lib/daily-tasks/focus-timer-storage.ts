// Focus mode remembers the last custom timer length (1.2), so it can offer it
// as a chip next time. Best-effort: a failed read or write just means no chip.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { FOCUS_TIMER_MAX_MINUTES, FOCUS_TIMER_MIN_MINUTES } from "./focus-timer";

export const LAST_CUSTOM_TIMER_KEY = "daily-tasks/focus-last-custom-minutes";

/** The last custom length in minutes, or null when none (or unreadable). */
export async function loadLastCustomTimer(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_CUSTOM_TIMER_KEY);
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

export async function saveLastCustomTimer(minutes: number): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_CUSTOM_TIMER_KEY, String(minutes));
  } catch {
    // Best-effort: next time just won't offer it.
  }
}
