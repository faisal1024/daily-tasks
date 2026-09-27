// Free tastes of Plus features, counted per install in their own storage keys
// so neither a relaunch nor "Reset all data" hands out more.

import AsyncStorage from "@react-native-async-storage/async-storage";

/** AI brain dumps a free user gets on Today (the first-run sort is extra). */
export const FREE_AI_DUMPS = 3;
const AI_DUMPS_KEY = "daily-tasks/free-ai-dumps-used";

function parseCount(raw: string | null): number {
  const n = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Free AI brain dumps left (0 when storage can't be read: fail closed). */
export async function freeAiDumpsLeft(): Promise<number> {
  try {
    return Math.max(0, FREE_AI_DUMPS - parseCount(await AsyncStorage.getItem(AI_DUMPS_KEY)));
  } catch {
    return 0;
  }
}

/**
 * Use one free AI brain dump. Returns how many are left after this one, or
 * null when none were left (or storage failed), so the caller sorts locally.
 */
export async function claimFreeAiDump(): Promise<number | null> {
  try {
    const used = parseCount(await AsyncStorage.getItem(AI_DUMPS_KEY));
    if (used >= FREE_AI_DUMPS) return null;
    await AsyncStorage.setItem(AI_DUMPS_KEY, String(used + 1));
    return FREE_AI_DUMPS - used - 1;
  } catch {
    return null;
  }
}

/** Notice under a free AI sort: how many are left. */
export function freeAiDumpNotice(left: number): string {
  if (left <= 0) return "That was your last free AI sort. Plus keeps them coming.";
  return `Sorted by AI. ${left} free AI ${left === 1 ? "sort" : "sorts"} left.`;
}

/** Give a free AI brain dump back (the AI couldn't be reached). Never throws. */
export async function refundFreeAiDump(): Promise<void> {
  try {
    const used = parseCount(await AsyncStorage.getItem(AI_DUMPS_KEY));
    if (used > 0) await AsyncStorage.setItem(AI_DUMPS_KEY, String(used - 1));
  } catch {
    // Nothing to give back.
  }
}
