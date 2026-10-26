// The two Today cards that used to be first-run screens (1.5): "Want a nudge
// in the morning?" from the first check-off (or the next day), and the widget
// tip from the app open after the first finished day. First run itself is now three screens: brain dump → "Here are
// your three" → Today.
//
// Kept in its own key (like the trial note), written when first run ends, so
// only installs that went through the 1.5 first run ever see these cards:
// people updating from 1.4 or older were asked both in their own first run.
// Pure rules here; the card component loads and saves the record.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { NotificationPermissionState } from "./types";

export const FIRST_DAYS_KEY = "daily-tasks/first-days";
/** Which day each card's "shown" event last went out: once a day, across launches and remounts. */
export const FIRST_DAYS_SHOWN_KEY = "daily-tasks/first-days-shown";

/**
 * This process's launch. An earned widget tip becomes due on a later launch
 * (or a later day), never in the session that earned it, however often Today
 * re-renders, remounts or reloads the record.
 */
let launchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export function currentLaunch(): string {
  return launchId;
}
/** Test-only: act as if the app was launched again. */
export function __newLaunchForTests(): void {
  launchId = `${launchId}+`;
}

/** "Not now" on the nudge card hides it for this many days... */
export const NUDGE_SNOOZE_DAYS = 3;
/** ...and the second "Not now" retires it (Settings › Reminders still has it all). */
export const NUDGE_MAX_DECLINES = 2;

/**
 * "waiting" for a finished day; "earned" once one is seen (not shown in that
 * same session, so it never lands on the finished-day moment); "due" from the
 * next app open or day until dismissed; then "done".
 */
export type WidgetTipState = "waiting" | "earned" | "due" | "done";

export interface FirstDaysRecord {
  /**
   * Date key (YYYY-MM-DD) from which the nudge card may show; null once it's
   * answered (Yes, or "Not now" for the last time).
   */
  nudgeFrom: string | null;
  /** How many times "Not now" was tapped. */
  nudgeDeclines: number;
  /** See WidgetTipState. */
  widgetTip: WidgetTipState;
  /** While "earned": the launch and day that earned it. */
  earnedLaunch?: string;
  earnedOn?: string;
}

/**
 * The record first run writes as it ends, on `today`. The nudge waits for
 * tomorrow, or for the first check-off today (noteCheckOff), whichever comes
 * first: not seconds after "Your three are picked."
 */
export function startFirstDays(today: string): FirstDaysRecord {
  return { nudgeFrom: addDays(today, 1), nudgeDeclines: 0, widgetTip: "waiting" };
}

/** A task checked off today brings a first nudge forward to today (never a snoozed one). */
export function noteCheckOff(record: FirstDaysRecord, today: string, checkedOff: boolean): FirstDaysRecord {
  if (!checkedOff || record.nudgeDeclines > 0 || record.nudgeFrom === null) return record;
  return record.nudgeFrom > today ? { ...record, nudgeFrom: today } : record;
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
  /** A finished day: not then (it would sit on the done card); it waits for another day. */
  dayFinished?: boolean;
}): boolean {
  const { record, today, permission } = input;
  if (!record || record.nudgeFrom === null || input.dayFinished) return false;
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

/**
 * A finished day (every planned task done, at least one) earns the tip,
 * stamped with this launch and day. It isn't shown in that session:
 * openFirstDays makes it due on a later launch or day.
 */
export function noteFinishedDay(
  record: FirstDaysRecord,
  dayFinished: boolean,
  at: { launch?: string; today?: string } = {},
): FirstDaysRecord {
  if (!dayFinished || record.widgetTip !== "waiting") return record;
  return {
    ...record,
    widgetTip: "earned",
    earnedLaunch: at.launch ?? currentLaunch(),
    ...(at.today ? { earnedOn: at.today } : {}),
  };
}

/**
 * An earned tip becomes due once the app has been launched again (another
 * launch id) or it's a later day. The same launch, same day: still earned.
 */
export function openFirstDays(
  record: FirstDaysRecord,
  at: { launch?: string; today?: string } = {},
): FirstDaysRecord {
  if (record.widgetTip !== "earned") return record;
  const launch = at.launch ?? currentLaunch();
  const laterDay = Boolean(at.today && record.earnedOn && at.today > record.earnedOn);
  if (record.earnedLaunch === launch && !laterDay) return record;
  const { earnedLaunch, earnedOn, ...rest } = record;
  return { ...rest, widgetTip: "due" };
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
    v.widgetTip === "waiting" || v.widgetTip === "earned" || v.widgetTip === "due" || v.widgetTip === "done"
      ? v.widgetTip
      : "done";
  const record: FirstDaysRecord = { nudgeFrom, nudgeDeclines: declines, widgetTip };
  if (widgetTip === "earned") {
    if (typeof v.earnedLaunch === "string") record.earnedLaunch = v.earnedLaunch;
    if (typeof v.earnedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.earnedOn)) record.earnedOn = v.earnedOn;
  }
  return record;
}

type ShownDays = Partial<Record<"nudge" | "widget", string>>;

/**
 * True the first time `kind` is shown on `today` (and records it), so the
 * "shown" event goes out once a day whatever remounts or relaunches. False
 * when already logged today, or storage can't be read (stay quiet).
 */
export async function claimShownToday(kind: "nudge" | "widget", today: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(FIRST_DAYS_SHOWN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const days: ShownDays = parsed && typeof parsed === "object" ? (parsed as ShownDays) : {};
    if (days[kind] === today) return false;
    await AsyncStorage.setItem(FIRST_DAYS_SHOWN_KEY, JSON.stringify({ ...days, [kind]: today }));
    return true;
  } catch {
    return false;
  }
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
