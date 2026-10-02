// The day-5 trial note: one calm, in-app line on Today during a free trial of
// Plus, saying what Plus did (from local counts only, never task text) and
// when the trial ends. Shown once per trial; never a push notification.

import AsyncStorage from "@react-native-async-storage/async-storage";

/** A free trial of Plus, as RevenueCat reports it. */
export interface PlusTrial {
  /** When the trial started (ISO), when known. */
  startedAt: string | null;
  /** When the trial ends (ISO). */
  endsAt: string;
  /** False once the trial was cancelled (it won't turn into a subscription). */
  willRenew: boolean;
}

/** Plus helpers counted for the note (only counts, only on this device). */
export type PlusUseKind = "brain_dump" | "break_down" | "coach_note" | "tomorrow_draft";

export type TrialUsage = Record<PlusUseKind, number>;

const DAY_MS = 24 * 60 * 60_000;
/** Day 5 of the trial: four full days after it started. */
export const TRIAL_NOTE_AFTER_MS = 4 * DAY_MS;
/** Without a start date, assume Plus's 7-day trial: day 5 is 3 days before the end. */
const FALLBACK_BEFORE_END_MS = 3 * DAY_MS;
/** Uses older than this are dropped (a trial is a week). */
const KEEP_USES_MS = 30 * DAY_MS;
const MAX_USES = 300;

const USES_KEY = "daily-tasks/plus-uses";
const NOTE_KEY = "daily-tasks/trial-note";

/** Identifies one trial (a new trial gets a new note). */
export function trialKey(trial: PlusTrial): string {
  return trial.startedAt ?? trial.endsAt;
}

/** When the note becomes due: day 5 of the trial. Null if the dates are unusable. */
export function trialNoteDueAt(trial: PlusTrial): number | null {
  const end = Date.parse(trial.endsAt);
  if (!Number.isFinite(end)) return null;
  const start = trial.startedAt ? Date.parse(trial.startedAt) : Number.NaN;
  if (Number.isFinite(start) && start < end) return start + TRIAL_NOTE_AFTER_MS;
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

export interface TrialNoteCopy {
  title: string;
  body: string;
}

/** The note's words. Counts only; a gentler line when Plus hasn't been used yet. */
export function trialNoteCopy(usage: TrialUsage, trial: PlusTrial, now: number): TrialNoteCopy {
  const did: string[] = [];
  if (usage.brain_dump > 0) did.push(`sorted ${plural(usage.brain_dump, "brain dump", "brain dumps")}`);
  if (usage.break_down > 0) did.push(`broke down ${plural(usage.break_down, "task", "tasks")}`);
  if (usage.coach_note > 0) did.push(`wrote ${plural(usage.coach_note, "coach's note", "coach's notes")}`);
  if (usage.tomorrow_draft > 0) did.push(`drafted ${plural(usage.tomorrow_draft, "evening plan", "evening plans")}`);
  const what =
    did.length > 0
      ? `Plus ${joinList(did)} during your trial.`
      : "Plus can sort a brain dump into today's three, break a stuck task into tiny steps, and write your coach's note.";
  const day = trialEndDay(trial.endsAt, now);
  const ends = trial.willRenew
    ? `Your trial ends ${day}; you can cancel anytime in Settings.`
    : `Your trial ends ${day} and won't renew. Your three tasks stay free either way.`;
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

/** Count one use of a Plus helper (kind and time only). Call only when it used Plus. */
export function recordPlusUse(kind: PlusUseKind, now: number = Date.now()): Promise<void> {
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
