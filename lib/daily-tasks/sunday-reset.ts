// The Sunday reset (1.6, Plus): a two-minute guided look at the week.
//
// Step 1, last week's wins (from history: finished tasks, days shown up,
// Day N, the best day; never a missed-task tally or a fraction). Step 2, a
// brain dump for the week: everything goes to Saved for later. Step 3, the
// coach suggests the next day's three from that dump, the saved items and
// what the basic memory has noticed; the user edits them, and they become
// tomorrow's draft (the evening draft's card shows them that morning).
//
// Entry: a Today card on Sunday evenings (from SUNDAY_RESET_CARD_HOUR), an
// optional Sunday notification, and Progress any day. Free users see the
// card once, with a short Plus intro, never again in a later week.
//
// Pure, apart from sortWeek's AI call (the brain-dump route).

import { cleanTaskText, localBrainDump, requestBrainDump, type BrainDumpResult } from "./ai-helpers";
import { addDays, fromDateKey, toDateKey } from "./date";
import type { MemoryStatsPayload } from "./coach-memory";
import type { ReminderContext, ReminderPlanItem, ReminderStrategy } from "./reminder-plan";
import { MANAGED_REMINDER_PREFIX } from "./reminders";
import { showedUp } from "./streaks";
import { MAX_TASKS, type AppState, type History, type SundayResetState, type TomorrowDraft } from "./types";
import { reviewDays } from "./weekly-review";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The Today card shows on Sundays from this hour (local). */
export const SUNDAY_RESET_CARD_HOUR = 17;
/** The optional Sunday notification goes out at this hour (local). */
export const SUNDAY_RESET_REMINDER_HOUR = 18;
/** The notification's `kind` (in its id and data). */
export const SUNDAY_RESET_KIND = "sunday_reset";
export const SUNDAY_RESET_REMINDER_COPY = {
  title: "Sunday reset",
  body: "Two minutes to set up your week?",
} as const;
/** Saved items sent with the week's dump (the newest), like the proxy's limit. */
export const MAX_SAVED_SENT = 20;
/** The `because` line on the draft the reset makes (shown on the next morning's card). */
export const RESET_DRAFT_BECAUSE = "You picked these when you set up your week.";

export const DEFAULT_SUNDAY_RESET: SundayResetState = {
  reminder: true,
  doneWeek: null,
  dismissedWeek: null,
  freeIntroWeek: null,
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dayOrNull = (value: unknown): string | null => (typeof value === "string" && DAY_KEY.test(value) ? value : null);

/** A saved (or missing, or malformed) record as the app reads it. */
export function normalizeSundayReset(value: unknown): SundayResetState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_SUNDAY_RESET;
  const record = value as Record<string, unknown>;
  return {
    reminder: typeof record.reminder === "boolean" ? record.reminder : true,
    doneWeek: dayOrNull(record.doneWeek),
    dismissedWeek: dayOrNull(record.dismissedWeek),
    freeIntroWeek: dayOrNull(record.freeIntroWeek),
  };
}

/** The app state's record, or the defaults (older saves have none). */
export function sundayResetOf(state: Pick<AppState, "sundayReset">): SundayResetState {
  return state.sundayReset ?? DEFAULT_SUNDAY_RESET;
}

/** The week a day belongs to: the Sunday on or before it (yyyy-MM-dd). */
export function weekKey(day: string): string {
  return addDays(day, -fromDateKey(day).getDay());
}

export function isSunday(day: string): boolean {
  return fromDateKey(day).getDay() === 0;
}

export function weekdayOf(day: string): string {
  return WEEKDAYS[fromDateKey(day).getDay()];
}

/** The day the reset plans: always the next one (Monday, for a Sunday reset). */
export function resetTargetDay(today: string): string {
  return addDays(today, 1);
}

export type SundayResetCardKind = "plus" | "free";

/**
 * Which Today card shows, if any: Sunday from 5 PM, for someone who has used
 * the app on an earlier day (never on first run's day), not once this week's
 * reset is done or the card was closed. Plus (confirmed) gets the reset; a
 * free user, on a build with the paywall, gets the Plus intro, only in the
 * first week it showed. Nothing while Plus is still being checked.
 */
export function sundayResetCard(input: {
  today: string;
  hour: number;
  reset: SundayResetState;
  plus: "yes" | "no" | "unknown";
  paywallEnabled: boolean;
  usedBefore: boolean;
  firstRunActive: boolean;
}): SundayResetCardKind | null {
  const { today, hour, reset } = input;
  if (!isSunday(today) || hour < SUNDAY_RESET_CARD_HOUR || !input.usedBefore || input.firstRunActive) return null;
  const week = weekKey(today);
  if (reset.doneWeek === week || reset.dismissedWeek === week) return null;
  if (input.plus === "yes") return "plus";
  if (input.plus === "no" && input.paywallEnabled && (reset.freeIntroWeek === null || reset.freeIntroWeek === week)) {
    return "free";
  }
  return null;
}

/** Any day before today with something planned: not a brand-new install. */
export function usedBeforeToday(history: History, today: string): boolean {
  return Object.values(history).some((record) => record.date < today && record.total > 0);
}

export interface WeekWins {
  /** Tasks finished in the seven days ending today (today's so far included). */
  completed: number;
  /** Days with something planned in those seven. */
  showedUpDays: number;
  /** The day that clearly went best (most finished, 2 or more, no tie), or null. */
  bestDay: { weekday: string; completed: number } | null;
}

/** Step 1's numbers: the seven days ending today. Only what went well. */
export function weekWins(history: History, today: string): WeekWins {
  const days = reviewDays(history, today);
  const completed = days.reduce((sum, day) => sum + day.completed, 0);
  const showedUpDays = days.filter(showedUp).length;
  const most = Math.max(0, ...days.map((day) => day.completed));
  const top = days.filter((day) => day.completed === most);
  const bestDay =
    most >= 2 && top.length === 1 ? { weekday: top[0].isToday ? "Today" : top[0].weekday, completed: most } : null;
  return { completed, showedUpDays, bestDay };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Step 1's words: a headline and a few calm lines. `dayCount` is the Day chip's N. */
export function winsCopy(wins: WeekWins, dayCount: number): { headline: string; lines: string[] } {
  const headline =
    wins.completed > 0
      ? `${plural(wins.completed, "task", "tasks")} finished this week.`
      : "A quiet week. A new one starts now.";
  const lines: string[] = [];
  if (wins.showedUpDays > 0) lines.push(`You showed up on ${plural(wins.showedUpDays, "day", "days")}.`);
  if (dayCount > 0) lines.push(`Day ${dayCount} and counting.`);
  if (wins.bestDay) {
    lines.push(
      wins.bestDay.weekday === "Today"
        ? `Today went best: ${wins.bestDay.completed} done.`
        : `${wins.bestDay.weekday} went best: ${wins.bestDay.completed} done.`,
    );
  }
  return { headline, lines };
}

const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const STOPWORDS = new Set(
  "the a an and or for to of in on at with my your our do get go make take buy call this that some more out new all now up off".split(" "),
);

function words(text: string): string[] {
  return (text.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}

function overlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return 0;
  const shared = left.filter((w) => right.some((r) => r === w || (Math.min(r.length, w.length) >= 4 && (r.startsWith(w) || w.startsWith(r)))));
  return shared.length / Math.max(left.length, right.length);
}

/**
 * The saved item a pick stands for, if any: the same words (ignoring case
 * and spacing), else the clearest word match (at least half the words) when
 * no dump line matches it better. So a saved item the AI reworded is taken
 * from Saved for later on the morning it's used, instead of sitting in both.
 */
export function savedMatch(pick: string, saved: string[], dumpText = ""): string | null {
  const key = looseKey(pick);
  const exact = saved.find((text) => looseKey(text) === key);
  if (exact) return exact;
  let best: { text: string; score: number } | null = null;
  for (const text of saved) {
    const score = overlap(pick, text);
    if (score >= 0.5 && (!best || score > best.score)) best = { text, score };
  }
  if (!best) return null;
  const dumpBest = Math.max(0, ...dumpText.split(/\r?\n/).map((line) => overlap(pick, line)));
  return dumpBest > best.score ? null : best.text;
}

export interface WeekSort {
  /** New items from the week's dump (to save for later), cleaned, no saved item twice. */
  dumpItems: string[];
  /** The coach's (or the simple) pick for the next day, at most three. */
  suggested: string[];
  /** A short reason per suggested item (1.5's reasons), keyed by its text. */
  reasons: Record<string, string>;
  source: "ai" | "local";
}

function uniq(texts: string[]): string[] {
  const seen = new Set<string>();
  return texts.filter((text) => {
    const key = looseKey(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The simple pick (no AI): the dump's items first, then the oldest saved ones. */
export function localWeekSort(dump: string, saved: string[]): WeekSort {
  const split = dump.trim() ? localBrainDump(dump, MAX_TASKS) : null;
  const fromDump = split ? [...split.picks, ...split.parked] : [];
  const dumpItems = uniq(fromDump.filter((text) => !saved.some((s) => looseKey(s) === looseKey(text))));
  return { dumpItems, suggested: uniq([...fromDump, ...saved]).slice(0, MAX_TASKS), reasons: {}, source: "local" };
}

/**
 * Steps 2 and 3 in one call to the brain-dump route: the week's dump, the
 * newest saved items and the memory's numbers, for `forDay`. The answer is
 * untrusted (ai-helpers cleans it); a saved item it picks is mapped back to
 * the saved words. Falls back to localWeekSort when the AI is off or fails.
 */
export async function sortWeek(
  params: {
    dump: string;
    saved: string[];
    forDay: string;
    goalTitle: string | null;
    stats?: MemoryStatsPayload | null;
    useAi: boolean;
  },
  request: typeof requestBrainDump = requestBrainDump,
): Promise<WeekSort> {
  const dump = params.dump.trim();
  const saved = uniq(params.saved.map((text) => text.trim()).filter(Boolean));
  if (!dump && saved.length === 0) return { dumpItems: [], suggested: [], reasons: {}, source: "local" };
  if (!params.useAi) return localWeekSort(dump, saved);
  const sent = saved.slice(-MAX_SAVED_SENT);
  let result: BrainDumpResult;
  try {
    result = await request({
      // Nothing new this week: the saved items are what there is to pick from.
      text: dump || sent.join("\n"),
      openSlots: MAX_TASKS,
      goalTitle: params.goalTitle,
      stats: params.stats ?? null,
      forDay: params.forDay,
      ...(dump && sent.length > 0 ? { saved: sent } : {}),
    });
  } catch {
    return localWeekSort(dump, saved);
  }
  if (result.source !== "ai") return localWeekSort(dump, saved);
  const asSaved = (text: string) => savedMatch(text, saved, dump);
  const reasons: Record<string, string> = {};
  const suggested = uniq(
    result.picks.map((pick, index) => {
      const text = asSaved(pick) ?? pick;
      const reason = result.reasons?.[index];
      if (reason) reasons[text] = reason;
      return text;
    }),
  ).slice(0, MAX_TASKS);
  const dumpItems = dump
    ? uniq([...result.picks, ...result.parked].filter((text) => asSaved(text) === null))
    : [];
  return { dumpItems, suggested, reasons, source: "ai" };
}

/**
 * The rows step 3 offers, in order: the suggestion, the rest of the week's
 * dump, then saved items, then a draft already made for that day (e.g. by an
 * evening close). Each once.
 */
export function nextDayCandidates(input: {
  suggested: string[];
  dumpItems: string[];
  saved: string[];
  existingDraft: string[];
}): string[] {
  return uniq([...input.suggested, ...input.dumpItems, ...[...input.saved].reverse(), ...input.existingDraft]);
}

/** A typed "add your own" line, cleaned like any task (null when empty). */
export function cleanOwnTask(text: string): string | null {
  return cleanTaskText(text);
}

/** The draft the reset leaves for `today`'s next day (null for no tasks). */
export function resetDraft(tasks: string[], today: string, source: "ai" | "local"): TomorrowDraft | null {
  const cleaned = uniq(tasks.map((text) => cleanTaskText(text)).filter((text): text is string => text !== null)).slice(
    0,
    MAX_TASKS,
  );
  if (cleaned.length === 0) return null;
  return { forDate: resetTargetDay(today), tasks: cleaned, note: "", because: RESET_DRAFT_BECAUSE, source, from: "reset" };
}

/**
 * The Sunday notification (Plus, notifications on and allowed, its switch
 * on): the next Sunday at 6 PM, unless that week's reset is done or its card
 * was closed. One item, never time-sensitive, no task words. fitPlanToLimit
 * still decides whether it fits under iOS's 64.
 */
export function sundayResetReminder(context: ReminderContext): ReminderPlanItem | null {
  const reset = context.sundayReset;
  if (!reset || !reset.reminder) return null;
  if (context.plus !== true || !context.settings.enabled || context.permissionState !== "granted") return null;
  const { now } = context;
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (day.getDay() !== 0) continue;
    const at = new Date(day);
    at.setHours(SUNDAY_RESET_REMINDER_HOUR, 0, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    const key = toDateKey(day);
    if (reset.doneWeek === key || reset.dismissedWeek === key) return null;
    const hh = String(SUNDAY_RESET_REMINDER_HOUR).padStart(2, "0");
    return {
      id: `${MANAGED_REMINDER_PREFIX}${key}:${SUNDAY_RESET_KIND}:${hh}00`,
      fireAt: at,
      title: SUNDAY_RESET_REMINDER_COPY.title,
      body: SUNDAY_RESET_REMINDER_COPY.body,
      kind: SUNDAY_RESET_KIND,
      interruptionLevel: "active",
    };
  }
  return null;
}

/** `strategy`'s plan plus the Sunday notification, when it's due. */
export function withSundayReset(strategy: ReminderStrategy): ReminderStrategy {
  return async (context) => {
    const plan = await strategy(context);
    const item = sundayResetReminder(context);
    return item && !plan.some((planned) => planned.id === item.id) ? [...plan, item] : plan;
  };
}
