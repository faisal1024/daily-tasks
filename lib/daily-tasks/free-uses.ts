// Free tastes of Plus features, counted per install in their own storage keys
// so neither a relaunch nor "Reset all data" hands out more.

import AsyncStorage from "@react-native-async-storage/async-storage";

/** AI brain dumps a free user gets on Today (the first-run sort is extra). */
export const FREE_AI_DUMPS = 3;
const AI_DUMPS_KEY = "daily-tasks/free-ai-dumps-used";

// A missing count is 0; anything unreadable counts as used up (fail closed).
function parseCount(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : FREE_AI_DUMPS;
}

// Claims and refunds run one at a time, so two can't read the same count.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
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
export function claimFreeAiDump(): Promise<number | null> {
  return serial(claimNow);
}

async function claimNow(): Promise<number | null> {
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
  if (left <= 0) return "That was your last free AI sort. Next time we'll use a simple split, or Plus keeps AI sorting on.";
  return `Sorted by AI · ${left} free ${left === 1 ? "sort" : "sorts"} left.`;
}

/** Give a free AI brain dump back (the AI couldn't be reached). Never throws. */
export function refundFreeAiDump(): Promise<void> {
  return serial(refundNow);
}

async function refundNow(): Promise<void> {
  try {
    const used = parseCount(await AsyncStorage.getItem(AI_DUMPS_KEY));
    if (used > 0) await AsyncStorage.setItem(AI_DUMPS_KEY, String(used - 1));
  } catch {
    // Nothing to give back.
  }
}
