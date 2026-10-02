// The day-5 trial note: one calm, in-app line on Today during a free trial of
// Plus, saying what Plus did (from local counts only, never task text) and
// when the trial ends. Shown once per trial; never a push notification.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PlusTrial, RenewalPrice } from "./plus";

export type { PlusTrial } from "./plus";

/** Plus helpers counted for the note (only counts, only on this device). */
export type PlusUseKind = "brain_dump" | "break_down" | "coach_note" | "tomorrow_draft";

export type TrialUsage = Record<PlusUseKind, number>;

const DAY_MS = 24 * 60 * 60_000;
/** Day 5 of the trial: four calendar days after the day it started. */
const NOTE_AFTER_DAYS = 4;
/** ...but never later than 4/7 of the way through (so short sandbox trials get it too). */
const NOTE_FRACTION = 4 / 7;
/** Without a start date, assume Plus's 7-day trial: day 5 is 3 days before the end. */
const FALLBACK_BEFORE_END_MS = 3 * DAY_MS;
/** Uses older than this are dropped (a trial is a week). */
const KEEP_USES_MS = 14 * DAY_MS;
const MAX_USES = 300;

export const USES_KEY = "daily-tasks/plus-uses";
export const NOTE_KEY = "daily-tasks/trial-note";

/**
 * Identifies one trial (a new trial gets a new note). The end date: it's
 * fixed for a trial, while RevenueCat's start date can differ between launches.
 */
export function trialKey(trial: PlusTrial): string {
  return trial.endsAt;
}

/**
 * When the note becomes due: day 5 of the trial, i.e. local midnight of the
 * start day plus four calendar days (setDate, so a DST change doesn't move it
 * an hour), capped at 4/7 of the trial's length so a 3-minute sandbox trial
 * gets it too. Null if the dates are unusable.
 */
export function trialNoteDueAt(trial: PlusTrial): number | null {
  const end = Date.parse(trial.endsAt);
  if (!Number.isFinite(end)) return null;
  const start = trial.startedAt ? Date.parse(trial.startedAt) : Number.NaN;
  if (Number.isFinite(start) && start < end) {
    const day = new Date(start);
    const dayFive = new Date(day.getFullYear(), day.getMonth(), day.getDate() + NOTE_AFTER_DAYS).getTime();
    return Math.min(dayFive, start + (end - start) * NOTE_FRACTION);
  }
  return end - FALLBACK_BEFORE_END_MS;
}

/** Record key meaning "every trial" (storage couldn't be read: stay quiet). */
export const ANY_TRIAL = "*";

/** What the saved record says about the note for the current trial. */
export interface TrialNoteRecord {
  /** trialKey of the trial the note was shown for. */
  key: string;
  dismissed: boolean;
}

/**
 * Show the note: in a trial, on or after day 5, before the trial ends, and
 * not already dismissed for this trial. (Shown-but-not-dismissed stays up.)
 */
export function shouldShowTrialNote(input: {
  trial: PlusTrial | null | undefined;
  record: TrialNoteRecord | null;
  now?: number;
}): boolean {
  const { trial, record } = input;
  const now = input.now ?? Date.now();
  if (!trial) return false;
  const due = trialNoteDueAt(trial);
  const end = Date.parse(trial.endsAt);
  if (due === null || now < due || now >= end) return false;
  if (!record?.dismissed) return true;
  return record.key !== trialKey(trial) && record.key !== ANY_TRIAL;
}

/** Uses that happened during this trial (from its start, or 7 days before its end). */
export function usageDuring(uses: { kind: PlusUseKind; at: number }[], trial: PlusTrial, now: number): TrialUsage {
  const end = Date.parse(trial.endsAt);
  const started = trial.startedAt ? Date.parse(trial.startedAt) : Number.NaN;
  const from = Number.isFinite(started) ? started : end - 7 * DAY_MS;
  const usage: TrialUsage = { brain_dump: 0, break_down: 0, coach_note: 0, tomorrow_draft: 0 };
  for (const use of uses) {
    if (use.at >= from && use.at <= now && use.kind in usage) usage[use.kind] += 1;
  }
  return usage;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "today", "tomorrow" or the weekday ("Friday") the trial ends. */
export function trialEndDay(endsAt: string, now: number): string {
  const end = new Date(endsAt);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(end) - startOf(new Date(now))) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return end.toLocaleDateString(undefined, { weekday: "long" });
  return end.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/**
 * Apple renews an auto-renewable subscription unless it's cancelled at least
 * 24 hours before the period ends, so the note only offers a cancel line
 * while that's still possible. Inside the final 24 hours it says nothing
 * about cancelling (Manage stays on the note either way).
 */
const RENEWAL_CUTOFF_MS = 24 * 60 * 60_000;

/** "Not for you? Cancel at least 24 hours before with Manage below.", or "" inside the final 24 hours. */
function cancelLine(endsAt: string, now: number): string {
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end) || now >= end - RENEWAL_CUTOFF_MS) return "";
  return " Not for you? Cancel at least 24 hours before with Manage below.";
}

export interface TrialNoteCopy {
  title: string;
  body: string;
}

/**
 * The note's words. Counts only; a gentler line when Plus hasn't been used
 * yet. `price`: what the subscribed product renews at, when known (the
 * renewing line names it; without it, the line leaves the price out).
 */
export function trialNoteCopy(
  usage: TrialUsage,
  trial: PlusTrial,
  now: number,
  price: RenewalPrice | null = null,
): TrialNoteCopy {
  const did: string[] = [];
  if (usage.brain_dump > 0) did.push(`sorted ${plural(usage.brain_dump, "brain dump", "brain dumps")}`);
  if (usage.break_down > 0) did.push(`broke down ${plural(usage.break_down, "task", "tasks")}`);
  if (usage.coach_note > 0) did.push(`wrote ${plural(usage.coach_note, "coach note", "coach notes")}`);
  if (usage.tomorrow_draft > 0) did.push(`drafted ${plural(usage.tomorrow_draft, "evening plan", "evening plans")}`);
  const what =
    did.length > 0
      ? `Plus ${joinList(did)} during your trial.`
      : "Plus is here when you want it: sorting a brain dump, breaking down a stuck task, a coach's note.";
  const day = trialEndDay(trial.endsAt, now);
  const ends = trial.willRenew
    ? price
      ? `Your trial ends ${day}, then Plus renews at ${price.priceString}/${price.period}.${cancelLine(trial.endsAt, now)}`
      : `Your trial ends ${day}, then Plus continues as your subscription.${cancelLine(trial.endsAt, now)}`
    : `Your trial ends ${day} and won't renew. Your three tasks stay free after that.`;
  return { title: "Your Plus trial", body: `${what} ${ends}` };
}

// --- storage (never throws) ---

function parseUses(raw: string | null): { kind: PlusUseKind; at: number }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (use): use is { kind: PlusUseKind; at: number } =>
        typeof use === "object" &&
        use !== null &&
        typeof (use as { kind?: unknown }).kind === "string" &&
        typeof (use as { at?: unknown }).at === "number",
    );
  } catch {
    return [];
  }
}

// Writes run one at a time so two quick uses can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

// Whether this install is in a free trial right now (set by PlusProvider).
// Uses are only counted then: nothing is kept about anyone else.
let inTrial = false;

/** PlusProvider reports whether a free trial is running (counting is off otherwise). */
export function setTrialActiveForUses(active: boolean): void {
  inTrial = active;
}

/**
 * Count one use of a Plus helper (kind and time only), only during a free
 * trial. Call only when the helper actually used Plus.
 */
export function recordPlusUse(kind: PlusUseKind, now: number = Date.now()): Promise<void> {
  if (!inTrial) return Promise.resolve();
  const next = queue.then(async () => {
    try {
      const uses = parseUses(await AsyncStorage.getItem(USES_KEY)).filter((use) => now - use.at < KEEP_USES_MS);
      uses.push({ kind, at: now });
      await AsyncStorage.setItem(USES_KEY, JSON.stringify(uses.slice(-MAX_USES)));
    } catch {
      // A missed count only makes the note a little modest.
    }
  });
  queue = next.catch(() => {});
  return next;
}

export async function loadPlusUses(): Promise<{ kind: PlusUseKind; at: number }[]> {
  try {
    return parseUses(await AsyncStorage.getItem(USES_KEY));
  } catch {
    return [];
  }
}

export async function loadTrialNoteRecord(): Promise<TrialNoteRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(NOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrialNoteRecord>;
    return typeof parsed?.key === "string" ? { key: parsed.key, dismissed: parsed.dismissed === true } : null;
  } catch {
    // Unreadable: treat as dismissed so it can't nag (fail quiet).
    return { key: ANY_TRIAL, dismissed: true };
  }
}

export async function saveTrialNoteRecord(record: TrialNoteRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTE_KEY, JSON.stringify(record));
  } catch {
    // Not saved: it may show once more next launch.
  }
}
