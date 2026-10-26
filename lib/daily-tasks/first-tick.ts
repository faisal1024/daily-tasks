// The very first tick (1.5 D): "One down. That's the whole trick." once per
// install, on the first task ever checked off. Someone updating who has
// ticked before (it's in their history) never sees it.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { History } from "./types";

export const FIRST_TICK_KEY = "daily-tasks/first-tick";
export const FIRST_TICK_TOAST = "One down. That's the whole trick.";

/** Something was checked off on a day before today. */
export function tickedBefore(history: History, today: string): boolean {
  return Object.values(history).some((record) => record.date < today && record.completed > 0);
}

/**
 * Whether this tick is the first ever: nothing ticked yet today (`completedBefore`
 * is the count before this tick) and nothing on an earlier day.
 */
export function isFirstTickEver(input: { history: History; today: string; completedBefore: number }): boolean {
  return input.completedBefore === 0 && !tickedBefore(input.history, input.today);
}

/**
 * True the first time it's asked on this install (and records it), so the
 * toast shows once even if the tick is undone and done again. False once
 * recorded, or when storage can't be read (stay quiet).
 */
export async function claimFirstTick(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(FIRST_TICK_KEY)) !== null) return false;
    await AsyncStorage.setItem(FIRST_TICK_KEY, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}
