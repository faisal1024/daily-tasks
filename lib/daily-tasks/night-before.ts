// The night before (1.7): an evening brain dump for tomorrow that becomes a
// list, held until the morning.
//
// At night nothing is thrown out and nothing is filed: what's typed and the
// list made from it are kept as they are in `state.nightList` (not in Saved
// for later, not in the draft). Ticking a row only marks it "first". The
// decision is made in the morning of the day it's for: each row is added to
// Today or saved for later (both tagged `nightFor`, so "From last night"
// shows that day only); whatever is left is let go when the user finishes,
// or when that day ends. Leftovers are never moved into Saved for later.
//
// Pure, apart from sortNight's AI call (the brain-dump route, no new server).

import { cleanTaskText, localBrainDump, MAX_BRAIN_DUMP_CHARS, requestBrainDump, type BrainDumpResult } from "./ai-helpers";
import type { MemoryStatsPayload } from "./coach-memory";
import { addDays, fromDateKey, toDateKey } from "./date";
import type { ReminderContext, ReminderPlanItem, ReminderStrategy } from "./reminder-plan";
import { MANAGED_REMINDER_PREFIX } from "./reminders";
import { isDateKey, normalizeWhen, parseLocalWhen } from "./resurface";
import { sundayResetReminder } from "./sunday-reset";
import { parkTasks } from "./task-extras";
import {
  MAX_PARKED_TASKS,
  MAX_TASKS,
  type AppState,
  type NightBeforeState,
  type NightItem,
  type NightList,
  type TaskWhen,
} from "./types";

/** The Today card shows from this hour (local). */
export const NIGHT_BEFORE_HOUR = 18;
/** Until this hour after midnight it is still "last night": the dump plans the day that has just begun. */
export const NIGHT_LATE_HOUR = 4;
/** How long the sort waits for the AI before the simple split is used (as the Sunday reset's). */
export const NIGHT_SORT_TIMEOUT_MS = 12_000;
/** The reminder's default time: 8:30 PM. */
export const NIGHT_REMINDER_DEFAULT_MINUTES = 20 * 60 + 30;
/** The notification's `kind` (in its id and data). */
export const NIGHT_BEFORE_KIND = "night_before";
/** Nights ahead the reminder is planned for (rewritten whenever the app is opened). */
const REMINDER_NIGHTS = 3;
/** Rows a held list keeps (the brain dump's split gives at most 23). */
export const MAX_NIGHT_ITEMS = 40;

/** The tag on the night's items, the day they were for. */
export const FROM_LAST_NIGHT = "From last night";

export const NIGHT_REMINDER_COPY = {
  title: "Tomorrow",
  body: "Two minutes to get it out of your head?",
} as const;

/** Plain words, no em dashes. `{day}` is "tomorrow" or "today" (after midnight). */
export const NIGHT_COPY = {
  cardTitle: "Tomorrow, out of your head",
  cardBody: "Write down what's on your mind. It waits till morning.",
  cardButton: "Plan tomorrow",
  cardButtonToday: "Plan today",
  cardDismiss: "Not tonight",
  heldTitle: "Saved for the morning",
  heldOpen: "Open list",
  heldDismiss: "Hide",
  sheetTitle: "Tomorrow",
  sheetTitleToday: "Today",
  writeHint: "Everything on your mind for {day}. One per line is fine. It all waits till morning.",
  writeButton: "Make it a list",
  sorting: "Turning it into a list…",
  reviewTitle: "Your list for the morning",
  reviewHint: "Tick the ones to do first. Nothing is thrown out tonight: in the morning you choose what to add or save.",
  clear: "Clear ticks",
  edit: "Edit",
  rowFirst: "First",
  keep: "Keep till morning",
  done: "Done",
  nudgeAsk: "Want a nudge at {time}?",
  nudgeYes: "Yes",
  nudgeNo: "Not now",
  seePlus: "See Plus",
  aiMissed: "Couldn't reach smart sorting, so here's a simple split you can adjust.",
  empty: "Nothing came out of that. Edit it, or close: it's kept as you wrote it.",
  morningTitle: "Last night's list",
  morningHint: "Add what you want to Today, or save it for later. The rest is let go when you're done.",
  add: "Add",
  save: "Save",
  letRestGo: "Let the rest go",
  morningFull: "Today's three are set. Save it for later instead.",
  morningLocked: "Today is set. Save it for later instead.",
  savedFull: "Saved for later is full.",
} as const;

export const DEFAULT_NIGHT_BEFORE: NightBeforeState = {
  reminder: false,
  reminderMinutes: NIGHT_REMINDER_DEFAULT_MINUTES,
  doneFor: null,
  dismissedFor: null,
  reminderAsked: false,
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dayOrNull = (value: unknown): string | null => (typeof value === "string" && DAY_KEY.test(value) ? value : null);
const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** A saved (or missing, or malformed) record as the app reads it. */
export function normalizeNightBefore(value: unknown): NightBeforeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_NIGHT_BEFORE;
  const record = value as Record<string, unknown>;
  const minutes = record.reminderMinutes;
  return {
    reminder: record.reminder === true,
    reminderMinutes:
      typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0 && minutes < 24 * 60
        ? minutes
        : NIGHT_REMINDER_DEFAULT_MINUTES,
    doneFor: dayOrNull(record.doneFor),
    dismissedFor: dayOrNull(record.dismissedFor),
    reminderAsked: record.reminderAsked === true,
  };
}

/** The app state's record, or the defaults (older saves have none). */
export function nightBeforeOf(state: Pick<AppState, "nightBefore">): NightBeforeState {
  return state.nightBefore ?? DEFAULT_NIGHT_BEFORE;
}

/**
 * A saved list as the app reads it, or null. Rows are cleaned like tasks (a
 * bad one is dropped, never the list), the text is capped like the brain
 * dump's, and its days and dates must be real.
 */
export function normalizeNightList(value: unknown): NightList | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isDateKey(record.forDay) || !isDateKey(record.nightOf)) return null;
  const items: NightItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(record.items) ? record.items : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const text = cleanTaskText(item.text);
    if (!text || typeof item.id !== "string" || !item.id || seen.has(looseKey(text))) continue;
    seen.add(looseKey(text));
    items.push({ id: item.id, text, picked: item.picked === true });
    if (items.length >= MAX_NIGHT_ITEMS) break;
  }
  const text = typeof record.text === "string" ? Array.from(record.text).slice(0, MAX_BRAIN_DUMP_CHARS).join("") : "";
  const dates: Record<string, TaskWhen> = {};
  if (record.dates && typeof record.dates === "object" && !Array.isArray(record.dates)) {
    for (const [key, when] of Object.entries(record.dates as Record<string, unknown>)) {
      const valid = normalizeWhen(when);
      if (valid && key.length <= 200) dates[key] = valid;
    }
  }
  return {
    forDay: record.forDay,
    nightOf: record.nightOf,
    text,
    items,
    source: record.source === "ai" ? "ai" : "local",
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
  };
}

/** The day a night dump plans (`forDate`) and the evening it belongs to (`nightOf`). */
export interface NightTarget {
  forDate: string;
  nightOf: string;
}

/**
 * Which day a dump now plans, or null outside the evening. From 6 PM (or
 * earlier once today is closed) it plans tomorrow; after midnight and before
 * 4 AM it is still last night, planning the day that has just begun. The
 * sheet captures this when it opens, so writing on at 12:03 still plans the
 * day that was "tomorrow" at 11:58.
 */
export function nightTarget(today: string, hour: number, dayClosed = false): NightTarget | null {
  if (hour < NIGHT_LATE_HOUR) return { forDate: today, nightOf: addDays(today, -1) };
  if (hour >= NIGHT_BEFORE_HOUR || dayClosed) return { forDate: addDays(today, 1), nightOf: today };
  return null;
}

/** "tomorrow", or "today" when the dump is after midnight (it plans the day that has begun). */
export function dayWord(target: NightTarget, today: string): "tomorrow" | "today" {
  return target.forDate === today ? "today" : "tomorrow";
}

/** The held list for `forDay`, if that's the one there is. */
export function listFor(list: NightList | null | undefined, forDay: string): NightList | null {
  return list && list.forDay === forDay ? list : null;
}

/** Something was written: typed text, or a list made from it. */
export function hasContent(list: NightList | null | undefined): boolean {
  return Boolean(list && (list.items.length > 0 || list.text.trim()));
}

export type NightCardKind = "prompt" | "held";

/**
 * The evening's Today card: the prompt, or "Saved for the morning" once
 * something is held for the night's day. Nothing once it was closed for the
 * night, during first run, or while the Sunday reset's card is up (the
 * bigger version of the same thing). After midnight a held list is the
 * morning card's (it's for today), so this card steps back.
 */
export function showsNightCard(input: {
  target: NightTarget | null;
  today: string;
  record: NightBeforeState;
  list: NightList | null | undefined;
  firstRunActive: boolean;
  sundayCardShowing: boolean;
}): NightCardKind | null {
  const { target, record } = input;
  if (!target || input.firstRunActive || input.sundayCardShowing) return null;
  if (record.dismissedFor === target.nightOf) return null;
  const held = listFor(input.list, target.forDate);
  if (!hasContent(held)) return "prompt";
  return target.forDate === input.today && held && held.items.length > 0 ? null : "held";
}

/**
 * A dump that was typed but never made into a list (closed half-way, or the
 * app was killed) is split on the device for the morning, so nothing written
 * is lost. The ids come from the list's day and the line, so the screen and
 * the store agree on them without saving first.
 */
export function withTextSplit(list: NightList): NightList {
  if (list.items.length > 0 || !list.text.trim()) return list;
  const split = localBrainDump(list.text, MAX_TASKS);
  const items = uniq([...split.picks, ...split.parked])
    .slice(0, MAX_NIGHT_ITEMS)
    .map((text, index) => ({ id: `night_${list.forDay}_${index}`, text, picked: false }));
  return items.length > 0 ? { ...list, items } : list;
}

/** The morning's list: the held list on its day, with rows left (a typed-only dump split). */
export function morningList(list: NightList | null | undefined, today: string): NightList | null {
  const held = listFor(list, today);
  if (!held) return null;
  const split = withTextSplit(held);
  return split.items.length > 0 ? split : null;
}

/** The rows in the morning's order: the ones ticked "first" lead, each group as written. */
export function morningOrder(items: NightItem[]): NightItem[] {
  return [...items.filter((item) => item.picked), ...items.filter((item) => !item.picked)];
}

/** The tag shows on the day the item was for, and on no other. */
export function isFromLastNight(nightFor: string | undefined, today: string): boolean {
  return Boolean(nightFor) && nightFor === today;
}

/** The day the list was for has ended: it's let go (at the rollover). */
export function nightListExpired(list: NightList | null | undefined, today: string): boolean {
  return Boolean(list) && list!.forDay < today;
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

export interface NightSort {
  /** The list, the AI's suggested three first. Nothing is ticked by it. */
  items: string[];
  source: "ai" | "local";
  /** Dates the AI read from the dump (1.6 F), keyed like parkTasks looks them up. */
  dates?: Record<string, TaskWhen>;
}

function fromResult(result: BrainDumpResult): NightSort {
  const items = uniq([...result.picks, ...result.parked]);
  const dates = result.dates && Object.keys(result.dates).length > 0 ? result.dates : null;
  return { items, source: result.source, ...(dates ? { dates } : {}) };
}

/**
 * The dump as a list: the brain-dump route with `forDay` (as the Sunday
 * reset's sort), else the simple on-device split. Never throws: a failed or
 * slow AI call falls back to the split.
 */
export async function sortNight(
  params: {
    dump: string;
    /** The weekday planned ("Thursday"); left out when it is the store's day. */
    forDay?: string;
    /** The store's day: sent (Plus) so the AI can date items. */
    today?: string;
    goalTitle: string | null;
    stats?: MemoryStatsPayload | null;
    useAi: boolean;
    timeoutMs?: number;
  },
  request: typeof requestBrainDump = requestBrainDump,
): Promise<NightSort> {
  const dump = params.dump.trim();
  if (!dump) return { items: [], source: "local" };
  const local = () => fromResult(localBrainDump(dump, MAX_TASKS));
  if (!params.useAi) return local();
  try {
    const result = await request({
      text: dump,
      openSlots: MAX_TASKS,
      goalTitle: params.goalTitle,
      stats: params.stats ?? null,
      ...(params.forDay ? { forDay: params.forDay } : {}),
      ...(params.today ? { today: params.today } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
    });
    return result.source === "ai" ? fromResult(result) : local();
  } catch {
    return local();
  }
}

/** A new, empty list for the night being planned. */
export function emptyNightList(target: NightTarget, at: string): NightList {
  return { forDay: target.forDate, nightOf: target.nightOf, text: "", items: [], source: "local", createdAt: at };
}

/**
 * The list after a (re)sort: the new rows in their order; one the user had
 * already ticked "first" stays ticked and keeps its id (Edit, then Make it a
 * list again, never loses a choice).
 */
export function withSortedItems(list: NightList, sort: NightSort, makeId: (index: number) => string): NightList {
  const before = new Map(list.items.map((item) => [looseKey(item.text), item]));
  const items = uniq(sort.items.map((text) => cleanTaskText(text) ?? "").filter(Boolean))
    .slice(0, MAX_NIGHT_ITEMS)
    .map((text, index) => {
      const had = before.get(looseKey(text));
      return had ? { ...had, text } : { id: makeId(index), text, picked: false };
    });
  const { dates: _old, ...rest } = list;
  return { ...rest, items, source: sort.source, ...(sort.dates ? { dates: sort.dates } : {}) };
}

/** A row's soft date when it's added or saved: the AI's or its own words', read against the evening, if not past. */
export function nightItemWhen(list: NightList, text: string, today: string): TaskWhen | null {
  const read = list.dates?.[looseKey(text)] ?? parseLocalWhen(text, list.nightOf);
  return normalizeWhen(read, today);
}

/** The list without one row (null once the last is gone: nothing is left to decide). */
export function withoutNightItem(state: AppState, id: string): AppState {
  const list = state.nightList;
  if (!list || !list.items.some((item) => item.id === id)) return state;
  const items = list.items.filter((item) => item.id !== id);
  return { ...state, nightList: items.length > 0 ? { ...list, items } : null };
}

/**
 * "Save" on a morning row: into Saved for later with its date (if it has
 * one) and the night's tag; one already saved under the same words gets the
 * tag instead of a copy. Never pushes an old item out: with Saved for later
 * full, nothing changes (the row stays).
 */
export function saveNightItem(state: AppState, id: string, at: string, today: string): AppState {
  const list = state.nightList;
  const item = list?.items.find((row) => row.id === id);
  if (!list || !item) return state;
  const key = looseKey(item.text);
  const existing = state.parkedTasks.find((parked) => looseKey(parked.text) === key);
  if (existing) {
    const parkedTasks = state.parkedTasks.map((parked) => (parked === existing ? { ...parked, nightFor: list.forDay } : parked));
    return withoutNightItem({ ...state, parkedTasks }, id);
  }
  if (state.parkedTasks.length >= MAX_PARKED_TASKS) return state;
  const when = nightItemWhen(list, item.text, today);
  const before = new Set(state.parkedTasks.map((parked) => parked.id));
  const parked = parkTasks(state, [item.text], at, when ? { [key]: when } : undefined, { today });
  // Skipped (it's on Today already): the row has nothing left to do either way.
  const parkedTasks = parked.parkedTasks.map((row) => (before.has(row.id) ? row : { ...row, nightFor: list.forDay }));
  return withoutNightItem({ ...parked, parkedTasks }, id);
}

/** "6 items · 2 first" (or that it's half-written). */
export function heldLine(list: NightList): string {
  if (list.items.length === 0) return "Half-written. Open the list to finish it.";
  const count = `${list.items.length} ${list.items.length === 1 ? "item" : "items"}`;
  const first = list.items.filter((item) => item.picked).length;
  return first > 0 ? `${count} · ${first} first` : count;
}

/** The done step's line. */
export function nightDoneLine(list: NightList, day: "tomorrow" | "today"): string {
  const count = list.items.length;
  const first = list.items.filter((item) => item.picked).length;
  const what = `${count} ${count === 1 ? "item" : "items"}${first > 0 ? `, ${first} marked first` : ""}`;
  return day === "today"
    ? `Kept: ${what}. It's on Today now: add what you want, or save it for later.`
    : `Kept till morning: ${what}. Then add what you want to Today, or save it for later.`;
}

/** What VoiceOver hears once it's kept. */
export function nightDoneSpoken(list: NightList, day: "tomorrow" | "today"): string {
  const count = list.items.length;
  return `${count} ${count === 1 ? "item" : "items"} kept for ${day === "today" ? "today" : "the morning"}.`;
}

/** The toast on Today after Done. */
export function nightToast(day: "tomorrow" | "today"): string {
  return day === "today" ? "Your list is on Today." : "Your list is waiting for the morning.";
}

/** "6 items. None ticked yet." after sorting. */
export function sortedSpoken(items: NightItem[]): string {
  if (items.length === 0) return "Nothing came out of that.";
  const first = items.filter((item) => item.picked).length;
  return `${items.length} ${items.length === 1 ? "item" : "items"}. ${first > 0 ? `${first} ticked first.` : "None ticked yet."}`;
}

/** The morning's finishing button, spoken: "Let the other 3 go". */
export function letRestGoSpoken(count: number): string {
  return count === 1 ? "Let the last one go" : `Let the other ${count} go`;
}

/** 8:30 PM (en-US, like the rest of the app's reminder copy). */
export function reminderTimeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * The night-before notification (free and Plus, off by default): at the
 * chosen time on each of the next few evenings, skipping one already kept
 * ("Keep till morning") or closed ("Not tonight"), and a Sunday whose reset
 * notification is already planned (one evening nudge is enough). No task
 * words. The store leaves `nightBefore` out during first run.
 * fitPlanToLimit still decides whether they fit under iOS's 64.
 */
export function nightBeforeReminder(context: ReminderContext): ReminderPlanItem[] {
  const record = context.nightBefore;
  if (!record || !record.reminder) return [];
  if (!context.settings.enabled || context.permissionState !== "granted") return [];
  const { now } = context;
  const sunday = sundayResetReminder(context);
  const sundayKey = sunday ? toDateKey(sunday.fireAt) : null;
  const hour = Math.floor(record.reminderMinutes / 60);
  const minute = record.reminderMinutes % 60;
  const hhmm = `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
  const out: ReminderPlanItem[] = [];
  for (let offset = 0; offset < REMINDER_NIGHTS; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const at = new Date(day);
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    const key = toDateKey(day);
    if (record.doneFor === key || record.dismissedFor === key || key === sundayKey) continue;
    out.push({
      id: `${MANAGED_REMINDER_PREFIX}${key}:${NIGHT_BEFORE_KIND}:${hhmm}`,
      fireAt: at,
      title: NIGHT_REMINDER_COPY.title,
      body: NIGHT_REMINDER_COPY.body,
      kind: NIGHT_BEFORE_KIND,
      interruptionLevel: "active",
    });
  }
  return out;
}

/** `strategy`'s plan plus the night-before notifications, when they're due. */
export function withNightBefore(strategy: ReminderStrategy): ReminderStrategy {
  return async (context) => {
    const plan = await strategy(context);
    const ids = new Set(plan.map((item) => item.id));
    const extra = nightBeforeReminder(context).filter((item) => !ids.has(item.id));
    return extra.length > 0 ? [...plan, ...extra] : plan;
  };
}

/** "Thursday" for the AI's `forDay`. */
export function weekdayFor(day: string): string {
  return fromDateKey(day).toLocaleDateString("en-US", { weekday: "long" });
}
