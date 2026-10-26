// Coming back after a gap (1.5 D): "Welcome back. Day N is still yours." on
// Today, and the rollover card named for the day the leftovers are from
// ("Unfinished from Tuesday"), never "yesterday" when it wasn't.
//
// The last open is read from the history: the store writes a record for each
// day it was on (the day before is written as the day turns), so the latest
// day before today is the last day the app was opened. A new install has
// none, so nothing to welcome back from. Pure, so it's unit-tested; the
// "shown" dedupe below is the only storage.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { DAY_NAMES } from "./routines";
import { daysBetween, fromDateKey } from "./date";
import type { History } from "./types";

/** The welcome shows when the last open was this many days ago or more. */
export const WELCOME_BACK_MIN_DAYS = 2;
/** From this many days the leftovers are "from last week" rather than a weekday. */
export const LAST_WEEK_DAYS = 7;

/** Which day "welcome_back_shown" last went out: once a day, across launches. */
export const WELCOME_BACK_SHOWN_KEY = "daily-tasks/welcome-back-shown";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The last day before `today` the app was on, or null (a new install). */
export function lastOpenBefore(history: History, today: string): string | null {
  let latest: string | null = null;
  for (const day of Object.keys(history)) {
    if (!DATE_KEY.test(day) || day >= today) continue;
    if (latest === null || day > latest) latest = day;
  }
  return latest;
}

export interface WelcomeBack {
  /** The last day the app was on. */
  since: string;
  /** Whole days from then to today (2 or more). */
  days: number;
}

/** Back after 2+ days away: from when, and how long. Null otherwise. */
export function welcomeBack(history: History, today: string): WelcomeBack | null {
  const since = lastOpenBefore(history, today);
  if (!since) return null;
  const days = daysBetween(since, today);
  return days >= WELCOME_BACK_MIN_DAYS ? { since, days } : null;
}

/**
 * Shown on Today until the first task of the day is ticked (then it has done
 * its job), never during first run.
 */
export function showsWelcomeBack(input: {
  welcome: WelcomeBack | null;
  completedCount: number;
  firstRun: boolean;
}): boolean {
  return input.welcome !== null && input.completedCount === 0 && !input.firstRun;
}

/** "Welcome back. Day N is still yours." (N: the Day chip's count, which never goes down). */
export function welcomeBackLine(daysShowedUp: number): string {
  return `Welcome back. Day ${Math.max(1, Math.floor(daysShowedUp))} is still yours.`;
}

/**
 * When the leftovers are from, as the rollover card says it: "yesterday",
 * the weekday within the last week ("Tuesday"), "last week" from 7 days on.
 * A source on or after today (a clock that moved) is "earlier", never
 * "yesterday".
 */
export function unfinishedFrom(sourceDate: string, today: string): string {
  const days = daysBetween(sourceDate, today);
  if (!Number.isFinite(days) || days < 1) return "earlier";
  if (days === 1) return "yesterday";
  if (days >= LAST_WEEK_DAYS) return "last week";
  return DAY_NAMES[fromDateKey(sourceDate).getDay()] ?? "earlier";
}

/** The rollover card's title: "Unfinished from Tuesday", or "Also from Tuesday" beside last night's draft. */
export function rolloverTitle(sourceDate: string, today: string, quiet: boolean): string {
  const from = unfinishedFrom(sourceDate, today);
  return quiet ? `Also from ${from}` : `Unfinished from ${from}`;
}

/**
 * True the first time the welcome is shown on `today` (and records it), so
 * "welcome_back_shown" goes out once a day. False when already logged or
 * storage can't be read (stay quiet).
 */
export async function claimWelcomeShown(today: string): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(WELCOME_BACK_SHOWN_KEY)) === today) return false;
    await AsyncStorage.setItem(WELCOME_BACK_SHOWN_KEY, today);
    return true;
  } catch {
    return false;
  }
}
