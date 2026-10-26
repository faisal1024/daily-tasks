// Free tastes of Plus features, counted per install in their own storage keys
// so neither a relaunch nor "Reset all data" hands out more.

import AsyncStorage from "@react-native-async-storage/async-storage";

/** AI brain dumps a free user gets on Today (the first-run sort is extra). */
export const FREE_AI_DUMPS = 3;
const AI_DUMPS_KEY = "daily-tasks/free-ai-dumps-used";

/**
 * Break it down tries a free user gets, ever (1.5). The proxy allows the same
 * per app user id (FREE_BREAK_DOWNS_PER_CLIENT), so a cleared count here
 * doesn't buy more than the server gives.
 */
export const FREE_BREAK_DOWNS = 1;
const BREAK_DOWNS_KEY = "daily-tasks/free-break-downs-used";

// A missing count is 0; anything unreadable counts as used up (fail closed).
function parseCount(raw: string | null, max: number = FREE_AI_DUMPS): number {
  if (raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : max;
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

/** Free Break it down tries left (0 when storage can't be read: fail closed). */
export async function freeBreakDownsLeft(): Promise<number> {
  try {
    return Math.max(0, FREE_BREAK_DOWNS - parseCount(await AsyncStorage.getItem(BREAK_DOWNS_KEY), FREE_BREAK_DOWNS));
  } catch {
    return 0;
  }
}

/**
 * Use the free Break it down try. Returns how many are left after it, or
 * null when none were left (or storage failed): show the paywall instead.
 */
export function claimFreeBreakDown(): Promise<number | null> {
  return serial(async () => {
    try {
      const used = parseCount(await AsyncStorage.getItem(BREAK_DOWNS_KEY), FREE_BREAK_DOWNS);
      if (used >= FREE_BREAK_DOWNS) return null;
      await AsyncStorage.setItem(BREAK_DOWNS_KEY, String(used + 1));
      return FREE_BREAK_DOWNS - used - 1;
    } catch {
      return null;
    }
  });
}

/** Give the free try back (the AI couldn't be reached; never after a 402). Never throws. */
export function refundFreeBreakDown(): Promise<void> {
  return serial(async () => {
    try {
      const used = parseCount(await AsyncStorage.getItem(BREAK_DOWNS_KEY), FREE_BREAK_DOWNS);
      if (used > 0) await AsyncStorage.setItem(BREAK_DOWNS_KEY, String(used - 1));
    } catch {
      // Nothing to give back.
    }
  });
}

/** The server says the free try is spent (402): match it here. Never throws. */
export function spendFreeBreakDowns(): Promise<void> {
  return serial(async () => {
    try {
      await AsyncStorage.setItem(BREAK_DOWNS_KEY, String(FREE_BREAK_DOWNS));
    } catch {
      // The next claim reads it again.
    }
  });
}

/** The small label next to "Break it down" while the free try is left. */
export function freeBreakDownBadge(left: number): string | null {
  if (left <= 0) return null;
  return left === 1 ? "1 free try" : `${left} free tries`;
}
