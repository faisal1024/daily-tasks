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

/**
 * Returns to the foreground in this launch. An "open" is a launch or a
 * return to the foreground: the "Meet Nag mode" sheet waits for the open
 * after the one first run ended in (1.5 D).
 */
let foregrounds = 0;
export function noteAppForeground(): void {
  foregrounds += 1;
}
/** This open: the launch plus how many times it came back to the foreground. */
export function currentOpen(): string {
  return `${launchId}#${foregrounds}`;
}

/** The Nag mode card shows on the first-run day and the day after (1.5 D). */
export const NAG_CARD_DAYS = 2;

/**
 * "Meet Nag mode" for a new install (1.5 D): "waiting" for the next app open
 * after first run, "due" from then until it is seen (shown on its own, or
 * opened from the card), then "done".
 */
export type NagIntroState = "waiting" | "due" | "done";

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
  /**
   * 1.5 D: the Nag mode card shows from `nagCardFrom` to `nagCardUntil`
   * (YYYY-MM-DD, inclusive): the first-run day from its first check-off
   * (never seconds after "picked"), and the day after. `nagCardUntil` null
   * once it's dismissed or the sheet was seen. Absent (a record from before
   * 1.5 D): no card.
   */
  nagCardFrom?: string;
  nagCardUntil?: string | null;
  /** 1.5 D: see NagIntroState. Absent: "done" (nothing shows by itself). */
  nagIntro?: NagIntroState;
  /** While "waiting": the open first run ended in (see currentOpen). */
  nagIntroOpen?: string;
}

/**
 * The record first run writes as it ends, on `today`. The nudge waits for
 * tomorrow, or for the first check-off today (noteCheckOff), whichever comes
 * first: not seconds after "Your three are picked."
 */
export function startFirstDays(today: string, open: string = currentOpen()): FirstDaysRecord {
  return {
    nudgeFrom: addDays(today, 1),
    nudgeDeclines: 0,
    widgetTip: "waiting",
    // 1.5 D: the Nag mode card on the first two days (like the nudge, from
    // the first check-off or the next day), and its sheet on the next open.
    nagCardFrom: addDays(today, 1),
    nagCardUntil: addDays(today, NAG_CARD_DAYS - 1),
    nagIntro: "waiting",
    nagIntroOpen: open,
  };
}

/**
 * A task checked off today brings a first nudge forward to today (never a
 * snoozed one), and the Nag card's start too (1.5 D).
 */
export function noteCheckOff(record: FirstDaysRecord, today: string, checkedOff: boolean): FirstDaysRecord {
  if (!checkedOff) return record;
  const nudgeSooner = record.nudgeDeclines === 0 && record.nudgeFrom !== null && record.nudgeFrom > today;
  const nagSooner = typeof record.nagCardFrom === "string" && record.nagCardFrom > today;
  if (!nudgeSooner && !nagSooner) return record;
  return {
    ...record,
    ...(nudgeSooner ? { nudgeFrom: today } : {}),
    ...(nagSooner ? { nagCardFrom: today } : {}),
  };
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
  at: { launch?: string; today?: string; open?: string } = {},
): FirstDaysRecord {
  const withNag = openNagIntro(record, at.open ?? currentOpen());
  if (withNag.widgetTip !== "earned") return withNag;
  const launch = at.launch ?? currentLaunch();
  const laterDay = Boolean(at.today && withNag.earnedOn && at.today > withNag.earnedOn);
  if (withNag.earnedLaunch === launch && !laterDay) return withNag;
  const { earnedLaunch, earnedOn, ...rest } = withNag;
  return { ...rest, widgetTip: "due" };
}

/** A waiting "Meet Nag mode" becomes due on any open after the one first run ended in. */
export function openNagIntro(record: FirstDaysRecord, open: string): FirstDaysRecord {
  if (record.nagIntro !== "waiting" || record.nagIntroOpen === open) return record;
  const { nagIntroOpen, ...rest } = record;
  return { ...rest, nagIntro: "due" };
}

/** The sheet comes up on its own once (when Today is quiet): due, and Nag mode not already on. */
export function nagIntroDue(record: FirstDaysRecord | null, nagOn: boolean): boolean {
  return Boolean(record && record.nagIntro === "due" && !nagOn);
}

/**
 * The sheet was seen (on its own or from the card), or the card dismissed:
 * neither comes back.
 */
export function finishNagIntro(record: FirstDaysRecord): FirstDaysRecord {
  // Already done with the card gone: the same record, so nothing is saved again.
  if (record.nagIntro === "done" && record.nagCardUntil === null) return record;
  const { nagIntroOpen, nagCardFrom, ...rest } = record;
  return { ...rest, nagCardUntil: null, nagIntro: "done" };
}

/**
 * "Want a voice that won't let it go?" on Today (1.5 D): on the first-run day
 * and the day after, until it's dismissed or the sheet is seen; not with Nag
 * mode already on, not on a finished day (it would sit on the done card), and
 * one card at a time: the morning nudge goes first.
 */
export function shouldShowNagCard(input: {
  record: FirstDaysRecord | null;
  today: string;
  nagOn: boolean;
  nudgeShowing: boolean;
  dayFinished?: boolean;
}): boolean {
  const { record, today } = input;
  if (!record || !record.nagCardUntil || record.nagIntro === "done") return false;
  if (input.nagOn || input.nudgeShowing || input.dayFinished) return false;
  if (record.nagCardFrom && today < record.nagCardFrom) return false;
  return today <= record.nagCardUntil;
}

/** The widget tip: iOS only (the widget is), once due, and one card at a time (the nudge, then the Nag card, first). */
export function shouldShowWidgetTip(input: {
  record: FirstDaysRecord | null;
  widgetsSupported: boolean;
  nudgeShowing: boolean;
  nagShowing?: boolean;
}): boolean {
  const { record, widgetsSupported, nudgeShowing, nagShowing = false } = input;
  return Boolean(record && widgetsSupported && !nudgeShowing && !nagShowing && record.widgetTip === "due");
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
  // 1.5 D, only when saved (a record from before has neither: no card, no sheet).
  if (typeof v.nagCardFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.nagCardFrom)) record.nagCardFrom = v.nagCardFrom;
  if ("nagCardUntil" in v) {
    record.nagCardUntil =
      typeof v.nagCardUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.nagCardUntil) ? v.nagCardUntil : null;
  }
  if ("nagIntro" in v) {
    record.nagIntro = v.nagIntro === "waiting" || v.nagIntro === "due" ? v.nagIntro : "done";
    if (record.nagIntro === "waiting") {
      // Without its open it can't tell the next one: due from here.
      if (typeof v.nagIntroOpen === "string") record.nagIntroOpen = v.nagIntroOpen;
      else record.nagIntro = "due";
    }
  }
  return record;
}

export type FirstDaysCardKind = "nudge" | "nag" | "widget";
type ShownDays = Partial<Record<FirstDaysCardKind, string>>;

/**
 * True the first time `kind` is shown on `today` (and records it), so the
 * "shown" event goes out once a day whatever remounts or relaunches. False
 * when already logged today, or storage can't be read (stay quiet).
 */
export async function claimShownToday(kind: FirstDaysCardKind, today: string): Promise<boolean> {
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
