// Client for the AI helper routes: brain dump → today's picks, and break a task
// into tiny steps. Responses are untrusted: everything is trimmed, capped,
// de-duplicated and validated before it reaches app state.

import { getMomentumAiProxyUrl, postToProxy, proxyRouteUrl } from "./ai-client";
import { MomentumAiError } from "./ai-status";
import type { MemoryStatsPayload } from "./coach-memory";
import { isDateKey, normalizeWhen } from "./resurface";
import { MAX_TASKS, type TaskWhen } from "./types";

export const MAX_BRAIN_DUMP_CHARS = 2000;
export const MAX_TASK_TEXT = 64;
export const MAX_PARKED = 20;
export const MAX_STEPS = 5;
export const MAX_STEP_TEXT = 60;

export interface BrainDumpResult {
  picks: string[];
  parked: string[];
  /** "ai" when the proxy sorted it, "local" for the simple offline split. */
  source: "ai" | "local";
  /**
   * A short reason per pick, same order as `picks` ("" where there is none),
   * e.g. "Quick win" (1.5). Absent when no pick has one (an older proxy, the
   * on-device split): see pickReason for what is shown then.
   */
  reasons?: string[];
  /**
   * Soft dates the AI sort read from the dump (1.6 F, Plus), keyed by the
   * item's text, lowercased with spacing collapsed (as parkTasks looks
   * them up). Absent when there are none: an older proxy, a free sort, the
   * on-device split (which reads its own when an item is saved).
   */
  dates?: Record<string, TaskWhen>;
}

const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** The dates on kept items (`when`), checked against `today`. */
function itemDates(lists: unknown[][], kept: string[], today: string): Record<string, TaskWhen> {
  const keep = new Set(kept.map(looseKey));
  const dates: Record<string, TaskWhen> = {};
  for (const list of lists) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const text = cleanTaskText((item as { text?: unknown }).text);
      const when = normalizeWhen((item as { when?: unknown }).when, today);
      if (!text || !when || !keep.has(looseKey(text)) || dates[looseKey(text)]) continue;
      dates[looseKey(text)] = when;
    }
  }
  return dates;
}

// Bullets may hug the text ("-walk"); numbered markers need a space so
// "1.5 mile walk" isn't read as item "1." + "5 mile walk".
const LIST_MARKER = /^\s*(?:[-*•·]\s*|\d+[.)](?:\s+|$)|\[\s?[xX]?\s?\]\s*)/;

/** Strip leading list markers, repeatedly for stacked ones like "- [ ] call mum". */
function stripListMarkers(value: string): string {
  let text = value;
  for (let i = 0; i < 3 && LIST_MARKER.test(text); i++) text = text.replace(LIST_MARKER, "");
  return text;
}

/** Trim, collapse whitespace, strip list markers, and cap length. */
export function cleanTaskText(value: unknown, max = MAX_TASK_TEXT): string | null {
  if (typeof value !== "string") return null;
  let text = stripListMarkers(value);
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  // Tasks read as a list of actions: "book dentist" → "Book dentist".
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  // Count by code points so an emoji is never cut in half.
  const chars = Array.from(capitalized);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : capitalized;
}

/**
 * Cleaned, de-duplicated texts. With `reasons`, each kept item's reason
 * (cleanReason; "" for none) is pushed there, in the same order.
 */
function uniqueTexts(items: unknown[], limit: number, seen = new Set<string>(), reasons?: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    const raw = item && typeof item === "object" ? (item as { text?: unknown }).text : item;
    const text = cleanTaskText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    reasons?.push(item && typeof item === "object" ? cleanReason((item as { reason?: unknown }).reason, text) : "");
  }
  return out;
}

export const MAX_REASON_WORDS = 5;
export const MAX_REASON_CHARS = 40;
// C0/C1 control characters and the Unicode line/paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// Bidi controls: a reason holding one is dropped (server/providers/nag-contract.mjs, HAS_BIDI).
const HAS_BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
// Invisible format characters: taken out of the reason (joiners stay: emoji),
// and all of them out of the copy the checks read.
const FORMAT_SHOWN = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g;
const FORMAT = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g;
// Links, emails and bare hosts on common endings (nag-contract.mjs, LINK_PATTERN).
const LINK =
  /\bhttps?:\/\/|\bwww\.|[^\s@]+@[^\s@]+\.[a-z]{2,}|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|me|ly|info|biz|xyz)\b/i;
// Keep these in step with server/providers/helpers-contract.mjs (a test compares them).
// A count of times: "3 times", "moved twice", "put off four times". The move
// words are past-tense claims (not "Moves the project forward").
const ONCE_TWICE = /\b(?:once|twice|thrice)\b/i;
const COUNT = /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|multiple|countless|a few)\b/i;
const MOVE_WORDS =
  /\b(?:times?|moved|put off|pushed|postponed|slipped|carried|delayed|rescheduled|again)\b/i;
// Blame or shame: never under a pick.
const SHAME =
  /\b(?:lazy|laziness|fail(?:ing|ed|ure)?|pathetic|useless|excuses?|shame(?:ful)?|guilt(?:y)?|slack(?:ing|er)|procrastinat\w*|still not done)\b|\bagain\s*[?!]/i;
// "Been waiting a while" and the like: only for a task the memory says keeps moving.
const WAITING =
  /\b(?:been waiting|waiting (?:a while|for a while|a long time|for ages|ages)|for a while|a while now|still on (?:your|the) (?:plate|list)|keeps? coming back|(?:been|was|got|keeps? getting) (?:moved|put off|pushed|postponed|delayed|rescheduled|carried over)|put off|pushed back|postponed|rescheduled|carried over|dodged)\b/i;

/** Accents, full-width letters and invisible characters folded away, for the checks only. */
function foldForMatch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(FORMAT, "").normalize("NFKC");
}

/** The fallback reason for a pick the memory says keeps moving (never a count). */
export const WAITING_REASON = "Been waiting a while";

/** A reason that says the task has been waiting or moving ("Been waiting a while"). */
export function isWaitingReason(reason: string): boolean {
  return WAITING.test(foldForMatch(reason));
}

/**
 * A pick's reason as shown under it (1.5), or "": one line, at most five
 * words and 40 characters (a longer one is dropped, never cut), no bidi
 * controls, no link, email or bare domain (also behind accents or
 * zero-width characters), never a count of moves, no blame or shame, not
 * the task's own words again. Starts with a capital.
 */
export function cleanReason(value: unknown, taskText = ""): string {
  if (typeof value !== "string" || HAS_BIDI.test(value)) return "";
  const text = value
    .replace(FORMAT_SHOWN, "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/u, "")
    .trim();
  if (!text || Array.from(text).length > MAX_REASON_CHARS || text.split(" ").length > MAX_REASON_WORDS) return "";
  const folded = foldForMatch(text);
  if ([text, folded].some((form) => LINK.test(form))) return "";
  if (ONCE_TWICE.test(folded) || (COUNT.test(folded) && MOVE_WORDS.test(folded)) || SHAME.test(folded)) return "";
  if (folded.toLowerCase() === foldForMatch(taskText).trim().toLowerCase()) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The muted line under pick `index` (1.5): the AI's reason, or one from the
 * memory (withMovedReasons). Null when there is none: an older proxy, or
 * the on-device split, which says nothing it can't know.
 */
export function pickReason(result: BrainDumpResult, index: number): string | null {
  if (index < 0 || index >= result.picks.length) return null;
  return result.reasons?.[index] || null;
}

function clampSlots(openSlots: number): number {
  return Math.max(1, Math.min(MAX_TASKS, Math.floor(openSlots)));
}

/**
 * Offline fallback: split the dump into lines/bullets/semicolons, keep the first
 * `openSlots` as picks and park the rest. Used when no proxy is configured or
 * the AI request fails, so the feature always does something useful.
 */
export function localBrainDump(text: string, openSlots: number): BrainDumpResult {
  let parts = text
    .split(/\r?\n|;|•/)
    .map(tidyDumpLine)
    .filter(Boolean);
  // One line written as a list ("report, dentist, groceries"): split on commas.
  if (parts.length === 1 && parts[0].includes(",")) {
    parts = parts[0]
      .split(",")
      .map(tidyDumpLine)
      .filter(Boolean);
  }
  const seen = new Set<string>();
  const picks = uniqueTexts(parts, clampSlots(openSlots), seen);
  const parked = uniqueTexts(parts, MAX_PARKED, seen);
  return { picks, parked, source: "local" };
}

// Filler at the start of a dump line: "I need to call mum" → "call mum".
// Longest phrases first, so "I need to" wins over "need to". Bare "got to" is
// left alone ("got to the gym at 6" is a fact, not filler), and so is
// "should"/"must" before a pronoun. Apostrophes may be curly (iOS Smart
// Punctuation types ’).
// A label like "todo:" or "Reminder:" says nothing about the task itself.
const LABEL_PREFIX = /^(?:to[\s-]?do|todo|reminder|task)\s*:\s*/i;
const FILLER_PREFIX = new RegExp(
  "^(?:(?:and|also|then|oh|ok|okay),?\\s+)*(?:" +
    [
      "(?:i|we)\\s+(?:really\\s+)?(?:need|have|ought|want)\\s+to",
      "(?:i|we)(?:['’]ve|\\s+have)\\s+got\\s+to",
      "(?:i|we)\\s+(?:should|must|gotta)",
      "(?:really\\s+)?(?:need|have|want)\\s+to",
      "gotta",
      "(?:should|must)(?!\\s+(?:i|we|you|he|she|they|it)\\b)",
      "(?:please\\s+)?(?:remember|don['’]?t\\s+forget|do\\s+not\\s+forget)\\s+to",
    ].join("|") +
    ")\\s+|" +
    LABEL_PREFIX.source,
  "i",
);

/**
 * Light tidy-up for the offline split (the AI rewrites properly): drop filler
 * like "need to" and trailing punctuation. Never empties a line: if nothing
 * is left, the original words stay.
 */
export function tidyDumpLine(line: string): string {
  const original = stripListMarkers(line).replace(/\s+/g, " ").trim();
  // A question stays a question ("Should I quit?" must not become "I quit"):
  // only a label like "Reminder:" comes off.
  if (original.endsWith("?")) return original.replace(LABEL_PREFIX, "").trim() || original;
  let text = original;
  for (let i = 0; i < 3; i++) text = text.replace(FILLER_PREFIX, "");
  text = text.replace(/[\s.,;:!…]+$/u, "").trim();
  return text || original.replace(/[\s.,;:!…]+$/u, "").trim();
}

/**
 * Normalize the proxy's brain-dump response; throws if nothing usable. With
 * `today` (the local date key sent), items' `when` are kept when valid and
 * not in the past; without it they are ignored.
 */
export function parseBrainDumpResponse(data: unknown, openSlots: number, today?: string | null): BrainDumpResult {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const reasons: string[] = [];
  const picks = uniqueTexts(Array.isArray(record.picks) ? record.picks : [], clampSlots(openSlots), seen, reasons);
  if (picks.length === 0) {
    throw new MomentumAiError("invalid_response", "Brain dump returned no picks.");
  }
  const parked = uniqueTexts(Array.isArray(record.parked) ? record.parked : [], MAX_PARKED, seen);
  const dates = isDateKey(today)
    ? itemDates(
        [Array.isArray(record.picks) ? record.picks : [], Array.isArray(record.parked) ? record.parked : []],
        [...picks, ...parked],
        today,
      )
    : {};
  // An older proxy sends no usable reasons: then there is no field at all.
  return {
    picks,
    parked,
    source: "ai",
    ...(reasons.some(Boolean) ? { reasons } : {}),
    ...(Object.keys(dates).length > 0 ? { dates } : {}),
  };
}

export async function requestBrainDump({
  text,
  openSlots,
  goalTitle,
  agenda = [],
  stats = null,
  today = null,
  forDay,
  saved = [],
  timeoutMs,
  planUrl = getMomentumAiProxyUrl(),
  fetchImpl,
}: {
  text: string;
  openSlots: number;
  goalTitle: string | null;
  /**
   * The local date key (1.6 F, Plus only): sent so the AI can turn "deck for
   * Tuesday" into a date. Without it no dates are asked for.
   */
  today?: string | null;
  /** Today's events and reminders, pre-formatted (see agenda.ts). */
  agenda?: string[];
  /** The last 30 days in numbers and a few titles (memoryStatsPayload), or null. */
  stats?: MemoryStatsPayload | null;
  /** The Sunday reset (1.6): the weekday the picks are for, when it isn't today. */
  forDay?: string;
  /** The Sunday reset (1.6): saved-for-later items the picks may come from too. */
  saved?: string[];
  /** How long to wait for the proxy (default: the client's usual timeout). */
  timeoutMs?: number;
  planUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<BrainDumpResult> {
  const trimmed = text.trim().slice(0, MAX_BRAIN_DUMP_CHARS);
  if (!trimmed) throw new MomentumAiError("invalid_response", "Nothing to sort.");
  const url = proxyRouteUrl(planUrl, "brain-dump");
  if (!url) return localBrainDump(trimmed, openSlots);
  const data = await postToProxy({
    url,
    payload: {
      text: trimmed,
      openSlots: clampSlots(openSlots),
      goalTitle,
      ...(agenda.length > 0 ? { agenda } : {}),
      ...(stats ? { stats } : {}),
      ...(isDateKey(today) ? { today } : {}),
      ...(forDay ? { forDay } : {}),
      // Whole characters (code points), as the Worker counts them.
      ...(saved.length > 0 ? { saved: saved.map((item) => Array.from(item.trim()).slice(0, 120).join("")) } : {}),
    },
    fetchImpl,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return parseBrainDumpResponse(data, openSlots, isDateKey(today) ? today : null);
}

/** Normalize the proxy's break-down response into 2–5 short steps. */
export function parseBreakDownResponse(data: unknown): string[] {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (out.length >= MAX_STEPS) break;
    const raw = step && typeof step === "object" ? (step as { text?: unknown }).text : step;
    const text = cleanTaskText(raw, MAX_STEP_TEXT);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  if (out.length < 2) {
    throw new MomentumAiError("invalid_response", "Break down returned too few steps.");
  }
  return out;
}

export async function requestBreakDown({
  task,
  goalTitle,
  planUrl = getMomentumAiProxyUrl(),
  fetchImpl,
}: {
  task: string;
  goalTitle: string | null;
  planUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const url = proxyRouteUrl(planUrl, "break-down");
  // No offline equivalent: without the AI we can't invent good steps.
  if (!url) throw new MomentumAiError("unavailable", "Smart steps aren't available.");
  const data = await postToProxy({
    url,
    payload: { task: task.trim().slice(0, 120), goalTitle },
    fetchImpl,
  });
  return parseBreakDownResponse(data);
}

export interface SortedBrainDump {
  result: BrainDumpResult;
  /** Shown above the review when we fell back to the simple split. */
  notice: string | null;
  /** The simple split was used because the free AI sorts ran out (offer Plus). */
  freeLimit?: boolean;
  /** One of the free AI sorts was used; `notice` says how many are left. */
  freeSortUsed?: boolean;
}

/** Shown on the review when a free user's AI sorts are used up. */
export const FREE_LIMIT_NOTICE =
  "Your free AI sorts are used up, so this is a simple split. Plus turns your notes into clear tasks.";

/**
 * Sort a brain dump with the AI, falling back to the simple local split (with a
 * friendly notice) if the request fails, so the user never loses what they typed.
 */
export async function sortBrainDump(
  params: {
    text: string;
    openSlots: number;
    goalTitle: string | null;
    agenda?: string[];
    stats?: MemoryStatsPayload | null;
    today?: string | null;
  },
  request: typeof requestBrainDump = requestBrainDump,
): Promise<SortedBrainDump> {
  try {
    return { result: await request(params), notice: null };
  } catch {
    return {
      result: localBrainDump(params.text, params.openSlots),
      notice: "Couldn't reach smart sorting, so here's a simple split you can adjust.",
    };
  }
}
