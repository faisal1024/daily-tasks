// The night before (1.7): an evening brain dump for tomorrow that becomes a
// list, held until the morning.
//
// At night nothing is thrown out and nothing is filed: what's typed and the
// list made from it are kept as they are in `state.nightLists` (not in Saved
// for later, not in the draft). Ticking a row only marks it "do first". The
// decision is made in the morning of the day it's for: each row is added to
// Today or saved for later (both tagged `nightFor`, so "From last night"
// shows that day only); whatever is left is let go when the user finishes,
// or when that day ends. Leftovers are never moved into Saved for later.
//
// There are at most two lists, one per day: this morning's (still to
// decide) and tonight's (for tomorrow), so writing tonight's never touches
// this morning's.
//
// Pure, apart from sortNight's AI call (the brain-dump route, no new server).

import {
  cleanTaskText,
  MAX_BRAIN_DUMP_CHARS,
  MAX_PARKED,
  requestBrainDump,
  tidyDumpLine,
  type BrainDumpResult,
} from "./ai-helpers";
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
/** The reminder's time stays in the evening window: 6 PM to 3:59 AM. */
export const NIGHT_REMINDER_EARLIEST = NIGHT_BEFORE_HOUR * 60;
export const NIGHT_REMINDER_LATEST = NIGHT_LATE_HOUR * 60 - 1;
/** The notification's `kind` (in its id and data). */
export const NIGHT_BEFORE_KIND = "night_before";
/** Nights ahead the reminder is planned for (rewritten whenever the app is opened). */
const REMINDER_NIGHTS = 3;
/**
 * Rows a list keeps: as many as a dump can hold (every line is at least one
 * character and a separator), so no line typed is ever cut.
 */
export const MAX_NIGHT_ITEMS = Math.ceil(MAX_BRAIN_DUMP_CHARS / 2);
/** Rows the AI path can give back (its three picks and the parked ones it keeps). */
export const NIGHT_AI_MAX_ROWS = MAX_TASKS + MAX_PARKED;
/** Lists held at once: this morning's and tonight's. */
export const MAX_NIGHT_LISTS = 2;
/** The typed words are written to the store this long after the last keystroke. */
export const NIGHT_TEXT_SAVE_MS = 450;

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
  heldTitle: "Kept till morning",
  heldOpen: "Open list",
  heldDismiss: "Hide",
  sheetTitle: "Tomorrow",
  sheetTitleToday: "Today",
  writeHint: "Everything on your mind for {day}. One per line is fine. It all waits till morning.",
  writeButton: "Make it a list",
  sorting: "Turning it into a list…",
  reviewTitle: "Your list for the morning",
  reviewHint: "Tick what to do first. Everything waits till morning, ticked or not. You choose then what to add or save.",
  clear: "Clear ticks",
  edit: "Edit",
  rowFirst: "Do first",
  keep: "Keep till morning",
  done: "Done",
  nudgeAsk: "Want a reminder to do this each evening at {time}?",
  nudgeYes: "Yes",
  nudgeNo: "No thanks",
  nudgeBlocked: "Notifications are off for Three Today. Turn them on in iOS Settings to get the reminder.",
  seePlus: "See Plus",
  aiMissed: "Couldn't reach smart sorting, so here's a simple split you can adjust.",
  empty: "Nothing came out of that. Edit it, or close: it's kept as you wrote it.",
  morningTitle: "Last night's list",
  morningHint: "Add what you want to Today, or save it for later. Anything left is let go at the end of the day.",
  add: "Add",
  save: "Save",
  letRestGo: "Let the rest go",
  confirmBody: "They won't be saved.",
  confirmCancel: "Cancel",
  confirmLetGo: "Let go",
  morningFull: "Today's three are set. Save it for later instead.",
  morningLocked: "Today is set. Save it for later instead.",
  savedFull: "Saved for later is full. Add it to Today, or let it go.",
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

/** A reminder time inside the evening window (6 PM to 3:59 AM): one outside moves to the nearer end. */
export function clampReminderMinutes(minutes: number): number {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  if (m >= NIGHT_REMINDER_EARLIEST || m <= NIGHT_REMINDER_LATEST) return m;
  return m - NIGHT_REMINDER_LATEST < NIGHT_REMINDER_EARLIEST - m ? NIGHT_REMINDER_LATEST : NIGHT_REMINDER_EARLIEST;
}

/** A saved (or missing, or malformed) record as the app reads it. */
export function normalizeNightBefore(value: unknown): NightBeforeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_NIGHT_BEFORE;
  const record = value as Record<string, unknown>;
  const minutes = record.reminderMinutes;
  return {
    reminder: record.reminder === true,
    reminderMinutes:
      typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0 && minutes < 24 * 60
        ? clampReminderMinutes(minutes)
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

/** The app state's lists (older saves have none). */
export function nightListsOf(state: Pick<AppState, "nightLists">): NightList[] {
  return state.nightLists ?? [];
}

const capText = (value: unknown): string =>
  typeof value === "string" ? Array.from(value).slice(0, MAX_BRAIN_DUMP_CHARS).join("") : "";

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
  const dates: Record<string, TaskWhen> = {};
  if (record.dates && typeof record.dates === "object" && !Array.isArray(record.dates)) {
    for (const [key, when] of Object.entries(record.dates as Record<string, unknown>)) {
      const valid = normalizeWhen(when);
      if (valid && key.length <= 200) dates[key] = valid;
    }
  }
  const taken = record.taken;
  return {
    forDay: record.forDay,
    nightOf: record.nightOf,
    text: capText(record.text),
    items,
    source: record.source === "ai" ? "ai" : "local",
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
    ...(typeof record.sortedText === "string" ? { sortedText: capText(record.sortedText) } : {}),
    ...(typeof taken === "number" && Number.isInteger(taken) && taken > 0 ? { taken: Math.min(taken, 999) } : {}),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
  };
}

/** Lists in a list, newest day last, one per day, at most two (the older days go). */
function capLists(lists: NightList[]): NightList[] {
  const byDay = new Map<string, NightList>();
  for (const list of lists) byDay.set(list.forDay, list);
  return [...byDay.values()].sort((a, b) => (a.forDay < b.forDay ? -1 : 1)).slice(-MAX_NIGHT_LISTS);
}

/**
 * The saved lists as the app reads them: `nightLists`, or a 1.7 beta save's
 * single `nightList`. Bad ones are dropped, never the save.
 */
export function normalizeNightLists(value: unknown, legacy?: unknown): NightList[] {
  const raw = Array.isArray(value) ? value : legacy !== undefined && legacy !== null ? [legacy] : [];
  return capLists(raw.map(normalizeNightList).filter((list): list is NightList => list !== null));
}

/** The lists with `list` in place of the one for its day (or added). */
export function withNightList(lists: NightList[], list: NightList): NightList[] {
  return capLists([...lists.filter((other) => other.forDay !== list.forDay), list]);
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

/** The list for `forDay`, if there is one. */
export function listFor(lists: NightList[] | null | undefined, forDay: string): NightList | null {
  return lists?.find((list) => list.forDay === forDay) ?? null;
}

/** Something was written: typed text, or a list made from it. */
export function hasContent(list: NightList | null | undefined): boolean {
  return Boolean(list && (list.items.length > 0 || list.text.trim()));
}

/**
 * The typed words have moved on from the rows (Edit, then closed without
 * making the list again), or were never made into rows. A list from before
 * `sortedText` with rows counts as made from its words.
 */
export function textAhead(list: NightList): boolean {
  if (!list.text.trim()) return false;
  return list.sortedText !== undefined ? list.text !== list.sortedText : list.items.length === 0;
}

/**
 * The on-device split, as the brain dump's but with room for a long dump
 * (MAX_NIGHT_ITEMS): lines, bullets and semicolons; one line of commas.
 */
export function nightSplit(text: string): string[] {
  let parts = text
    .split(/\r?\n|;|•/)
    .map(tidyDumpLine)
    .filter(Boolean);
  if (parts.length === 1 && parts[0].includes(",")) parts = parts[0].split(",").map(tidyDumpLine).filter(Boolean);
  return uniq(parts.map((part) => cleanTaskText(part)).filter((part): part is string => part !== null)).slice(
    0,
    MAX_NIGHT_ITEMS,
  );
}

/**
 * The AI path can give back every line of this dump. A longer one is split
 * on the device instead (no AI call, no free sort spent), so nothing is cut.
 */
export function aiCanHoldAll(dump: string): boolean {
  return nightSplit(dump).length <= NIGHT_AI_MAX_ROWS;
}

/** A short stable id for a line (same words, same id), so the screen and the store agree without saving first. */
function lineId(forDay: string, text: string): string {
  let hash = 5381;
  for (const ch of looseKey(text)) hash = ((hash * 33) ^ ch.codePointAt(0)!) >>> 0;
  return `night_${forDay}_${hash.toString(36)}`;
}

/**
 * The rows with the lines typed since they were made added at the end (as
 * the on-device split reads them), keeping every existing row, its id and
 * its tick. Nothing typed is ever lost: a dump never made into a list, or
 * words added after Edit, become rows. Lines that were already there when
 * the rows were made aren't added again (the AI may have reworded them).
 * Unchanged when the text is the rows' own.
 */
export function withTextLines(list: NightList): NightList {
  if (!textAhead(list)) return list;
  const have = new Set([
    ...list.items.map((item) => looseKey(item.text)),
    ...(list.sortedText ? nightSplit(list.sortedText).map(looseKey) : []),
  ]);
  const added = nightSplit(list.text)
    .filter((text) => !have.has(looseKey(text)))
    .map((text) => ({ id: lineId(list.forDay, text), text, picked: false }));
  const items = [...list.items, ...added].slice(0, MAX_NIGHT_ITEMS);
  return { ...list, items, sortedText: list.text };
}

export type NightCardKind = "prompt" | "held";

/**
 * The evening's Today card: the prompt, or "Kept till morning" once
 * something is held for the night's day. Nothing once it was closed for the
 * night, during first run, or while the Sunday reset's card is up (the
 * bigger version of the same thing). After midnight a held list is the
 * morning card's (it's for today), so this card steps back.
 */
export function showsNightCard(input: {
  target: NightTarget | null;
  today: string;
  record: NightBeforeState;
  lists: NightList[] | null | undefined;
  firstRunActive: boolean;
  sundayCardShowing: boolean;
}): NightCardKind | null {
  const { target, record } = input;
  if (!target || input.firstRunActive || input.sundayCardShowing) return null;
  if (record.dismissedFor === target.nightOf) return null;
  if (target.forDate === input.today && morningList(input.lists, input.today)) return null;
  return hasContent(listFor(input.lists, target.forDate)) ? "held" : "prompt";
}

/** The morning's list: the one for today, with rows left (typed lines included). */
export function morningList(lists: NightList[] | null | undefined, today: string): NightList | null {
  const held = listFor(lists, today);
  if (!held) return null;
  const full = withTextLines(held);
  return full.items.length > 0 ? full : null;
}

/** The rows in the morning's order: the ones ticked "do first" lead, each group as written. */
export function morningOrder(items: NightItem[]): NightItem[] {
  return [...items.filter((item) => item.picked), ...items.filter((item) => !item.picked)];
}

/** The tag shows on the day the item was for, and on no other. */
export function isFromLastNight(nightFor: string | undefined, today: string): boolean {
  return Boolean(nightFor) && nightFor === today;
}

/** The lists whose day hasn't ended (the rollover lets the rest go). */
export function liveNightLists(lists: NightList[] | undefined, today: string): NightList[] | undefined {
  if (!lists || lists.every((list) => list.forDay >= today)) return lists;
  return lists.filter((list) => list.forDay >= today);
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
 * reset's sort), else the on-device split. Never throws: a failed or slow AI
 * call falls back to the split.
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
  const local = (): NightSort => ({ items: nightSplit(dump), source: "local" });
  if (!params.useAi || !aiCanHoldAll(dump)) return local();
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
 * The list after a (re)sort of `sortedText`: the new rows in their order; one
 * the user had already ticked keeps its tick and id (Edit, then Make it a
 * list again, never loses a choice).
 */
export function withSortedItems(
  list: NightList,
  sort: NightSort,
  sortedText: string,
  makeId: (index: number) => string,
): NightList {
  const before = new Map(list.items.map((item) => [looseKey(item.text), item]));
  const items = uniq(sort.items.map((text) => cleanTaskText(text) ?? "").filter(Boolean))
    .slice(0, MAX_NIGHT_ITEMS)
    .map((text, index) => {
      const had = before.get(looseKey(text));
      return had ? { ...had, text } : { id: makeId(index), text, picked: false };
    });
  const { dates: _old, ...rest } = list;
  return { ...rest, items, sortedText, source: sort.source, ...(sort.dates ? { dates: sort.dates } : {}) };
}

/** A row's soft date when it's added or saved: the AI's or its own words', read against the evening, if not past. */
export function nightItemWhen(list: NightList, text: string, today: string): TaskWhen | null {
  const read = list.dates?.[looseKey(text)] ?? parseLocalWhen(text, list.nightOf);
  return normalizeWhen(read, today);
}

/** The state with the list for `forDay` changed (gone when `change` gives null). */
function updateList(state: AppState, forDay: string, change: (list: NightList) => NightList | null): AppState {
  const lists = nightListsOf(state);
  const list = listFor(lists, forDay);
  if (!list) return state;
  const next = change(list);
  const others = lists.filter((other) => other.forDay !== forDay);
  return { ...state, nightLists: next ? withNightList(others, next) : others };
}

/** The day's list without one row, counted as taken (the list goes once the last is gone). */
export function withoutNightItem(state: AppState, forDay: string, id: string): AppState {
  const list = listFor(nightListsOf(state), forDay);
  if (!list || !list.items.some((item) => item.id === id)) return state;
  return updateList(state, forDay, (current) => {
    const items = current.items.filter((item) => item.id !== id);
    return items.length > 0 ? { ...current, items, taken: (current.taken ?? 0) + 1 } : null;
  });
}

/**
 * "Save" on a morning row: into Saved for later with its date (if it has
 * one) and the night's tag; one already saved under the same words gets the
 * tag instead of a copy. Never pushes an old item out: with Saved for later
 * full, nothing changes (the row stays).
 */
export function saveNightItem(state: AppState, forDay: string, id: string, at: string, today: string): AppState {
  const list = listFor(nightListsOf(state), forDay);
  const item = list?.items.find((row) => row.id === id);
  if (!list || !item) return state;
  const key = looseKey(item.text);
  const existing = state.parkedTasks.find((parked) => looseKey(parked.text) === key);
  if (existing) {
    const parkedTasks = state.parkedTasks.map((parked) => (parked === existing ? { ...parked, nightFor: list.forDay } : parked));
    return withoutNightItem({ ...state, parkedTasks }, forDay, id);
  }
  if (state.parkedTasks.length >= MAX_PARKED_TASKS) return state;
  const when = nightItemWhen(list, item.text, today);
  const before = new Set(state.parkedTasks.map((parked) => parked.id));
  const parked = parkTasks(state, [item.text], at, when ? { [key]: when } : undefined, { today });
  // Skipped (it's on Today already): the row has nothing left to do either way.
  const parkedTasks = parked.parkedTasks.map((row) => (before.has(row.id) ? row : { ...row, nightFor: list.forDay }));
  return withoutNightItem({ ...parked, parkedTasks }, forDay, id);
}

/** "6 items, 2 marked first" (or that it's half-written). */
export function heldLine(list: NightList): string {
  const rows = withTextLines(list).items;
  if (rows.length === 0) return "Half-written. Open the list to finish it.";
  const count = `${rows.length} ${rows.length === 1 ? "item" : "items"}`;
  const first = rows.filter((item) => item.picked).length;
  return first > 0 ? `${count}, ${first} marked first` : count;
}

/** The done step's line. */
export function nightDoneLine(list: NightList, day: "tomorrow" | "today"): string {
  const count = list.items.length;
  const first = list.items.filter((item) => item.picked).length;
  const what = `${count} ${count === 1 ? "item" : "items"}`;
  const marked = first > 0 ? `, ${first} marked first` : "";
  return day === "today"
    ? `${what} kept${marked}. They're on Today now: add what you want or save it for later. The rest is let go at the end of the day.`
    : `${what} kept till morning${marked}. In the morning, add what you want to Today or save it for later. The rest is let go.`;
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

/** The morning's finishing button: "Let all 6 go" until something was taken, then "Let the rest go". */
export function letGoLabel(list: NightList): string {
  return (list.taken ?? 0) > 0 ? NIGHT_COPY.letRestGo : `Let all ${list.items.length} go`;
}

/** Its confirm: "Let 3 go?" */
export function letGoQuestion(count: number): string {
  return `Let ${count} go?`;
}

/** "Add the 2 marked first", up to the room Today has. */
export function addFirstLabel(count: number): string {
  return count === 1 ? "Add the one marked first" : `Add the ${count} marked first`;
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
 * chosen time on each of the next few evenings (a time after midnight goes
 * off early the next day, for that evening), skipping an evening already
 * kept ("Keep till morning") or closed ("Not tonight"), and a Sunday whose
 * reset notification is already planned. Keyed by the evening (`nightOf`).
 * No task words. The store leaves `nightBefore` out during first run.
 * fitPlanToLimit still decides whether they fit under iOS's 64.
 */
export function nightBeforeReminder(context: ReminderContext): ReminderPlanItem[] {
  const record = context.nightBefore;
  if (!record || !record.reminder) return [];
  if (!context.settings.enabled || context.permissionState !== "granted") return [];
  const { now } = context;
  const sunday = sundayResetReminder(context);
  const sundayKey = sunday ? toDateKey(sunday.fireAt) : null;
  const minutes = clampReminderMinutes(record.reminderMinutes);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const afterMidnight = hour < NIGHT_LATE_HOUR;
  const hhmm = `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
  const out: ReminderPlanItem[] = [];
  // From yesterday evening: a 1 AM reminder for last night may still be ahead.
  for (let offset = -1; offset < REMINDER_NIGHTS; offset++) {
    const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const at = new Date(evening.getFullYear(), evening.getMonth(), evening.getDate() + (afterMidnight ? 1 : 0));
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    const nightOf = toDateKey(evening);
    if (record.doneFor === nightOf || record.dismissedFor === nightOf || nightOf === sundayKey) continue;
    out.push({
      id: `${MANAGED_REMINDER_PREFIX}${nightOf}:${NIGHT_BEFORE_KIND}:${hhmm}`,
      fireAt: at,
      title: NIGHT_REMINDER_COPY.title,
      body: NIGHT_REMINDER_COPY.body,
      kind: NIGHT_BEFORE_KIND,
      interruptionLevel: "active",
    });
    if (out.length >= REMINDER_NIGHTS) break;
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
