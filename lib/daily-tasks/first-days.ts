// The two Today cards that used to be first-run screens (1.5): "Want a nudge
// in the morning?" on the first visits, and the widget tip after the first
// finished day. First run itself is now three screens: brain dump → "Here are
// your three" → Today.
//
// Kept in its own key (like the trial note), written when first run ends, so
// only installs that went through the 1.5 first run ever see these cards:
// people updating from 1.4 or older were asked both in their own first run.
// Pure rules here; the card component loads and saves the record.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { NotificationPermissionState } from "./types";

export const FIRST_DAYS_KEY = "daily-tasks/first-days";

/** "Not now" on the nudge card hides it for this many days... */
export const NUDGE_SNOOZE_DAYS = 3;
/** ...and the second "Not now" retires it (Settings › Reminders still has it all). */
export const NUDGE_MAX_DECLINES = 2;

export type WidgetTipState = "waiting" | "due" | "done";

export interface FirstDaysRecord {
  /**
   * Date key (YYYY-MM-DD) from which the nudge card may show; null once it's
   * answered (Yes, or "Not now" for the last time).
   */
  nudgeFrom: string | null;
  /** How many times "Not now" was tapped. */
  nudgeDeclines: number;
  /** "waiting" until a day is finished, then "due" until dismissed. */
  widgetTip: WidgetTipState;
}

/** The record first run writes as it ends, on `today`. */
export function startFirstDays(today: string): FirstDaysRecord {
  return { nudgeFrom: today, nudgeDeclines: 0, widgetTip: "waiting" };
}

/** A date key `days` calendar days after `day` (local, DST-safe). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * The nudge card shows on Today from `nudgeFrom` on, while iOS can still ask
 * (permission undetermined). Already granted: never. Denied: never either,
 * because a Yes couldn't bring up the prompt (Settings › Reminders explains).
 */
export function shouldShowNudgeCard(input: {
  record: FirstDaysRecord | null;
  today: string;
  permission: NotificationPermissionState | null | undefined;
}): boolean {
  const { record, today, permission } = input;
  if (!record || record.nudgeFrom === null) return false;
  if (permission !== "undetermined") return false;
  // Date keys compare in order as strings.
  return today >= record.nudgeFrom;
}

/** After "Not now": hidden for a few days, then retired on the last one. */
export function declineNudge(record: FirstDaysRecord, today: string): FirstDaysRecord {
  const declines = record.nudgeDeclines + 1;
  return {
    ...record,
    nudgeDeclines: declines,
    nudgeFrom: declines >= NUDGE_MAX_DECLINES ? null : addDays(today, NUDGE_SNOOZE_DAYS),
  };
}

/** After "Yes" (whatever iOS answered): never again. */
export function answerNudge(record: FirstDaysRecord): FirstDaysRecord {
  return { ...record, nudgeFrom: null };
}

/** A finished day (all three done) makes a waiting tip due; it stays due until dismissed. */
export function noteFinishedDay(record: FirstDaysRecord, dayFinished: boolean): FirstDaysRecord {
  return dayFinished && record.widgetTip === "waiting" ? { ...record, widgetTip: "due" } : record;
}

/** The widget tip: iOS only (the widget is), once due, and one card at a time (the nudge first). */
export function shouldShowWidgetTip(input: {
  record: FirstDaysRecord | null;
  widgetsSupported: boolean;
  nudgeShowing: boolean;
}): boolean {
  const { record, widgetsSupported, nudgeShowing } = input;
  return Boolean(record && widgetsSupported && !nudgeShowing && record.widgetTip === "due");
}

export function dismissWidgetTip(record: FirstDaysRecord): FirstDaysRecord {
  return { ...record, widgetTip: "done" };
}

/** What Today says (toast and VoiceOver) as first run hands over: "Your three are picked." */
export function pickedNote(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "Your one for today is picked.";
  const word = count === 2 ? "two" : count === 3 ? "three" : String(count);
  return `Your ${word} are picked.`;
}

function normalizeRecord(value: unknown): FirstDaysRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const nudgeFrom =
    typeof v.nudgeFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.nudgeFrom) ? v.nudgeFrom : null;
  const declines =
    typeof v.nudgeDeclines === "number" && Number.isInteger(v.nudgeDeclines) && v.nudgeDeclines >= 0
      ? v.nudgeDeclines
      : 0;
  const widgetTip: WidgetTipState =
    v.widgetTip === "waiting" || v.widgetTip === "due" || v.widgetTip === "done" ? v.widgetTip : "done";
  return { nudgeFrom, nudgeDeclines: declines, widgetTip };
}

/** The saved record, or null: no record (an install from before 1.5) or unreadable (stay quiet). */
export async function loadFirstDays(): Promise<FirstDaysRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(FIRST_DAYS_KEY);
    return raw ? normalizeRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveFirstDays(record: FirstDaysRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(FIRST_DAYS_KEY, JSON.stringify(record));
  } catch {
    // An unsaved answer only means the card may show once more.
  }
}
