// Client for the AI helper routes: brain dump → today's picks, and break a task
// into tiny steps. Responses are untrusted: everything is trimmed, capped,
// de-duplicated and validated before it reaches app state.

import { getMomentumAiProxyUrl, postToProxy, proxyRouteUrl } from "./ai-client";
import { MomentumAiError } from "./ai-status";
import { MAX_TASKS } from "./types";

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

function uniqueTexts(items: unknown[], limit: number, seen = new Set<string>()): string[] {
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
  }
  return out;
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

/** Normalize the proxy's brain-dump response; throws if nothing usable. */
export function parseBrainDumpResponse(data: unknown, openSlots: number): BrainDumpResult {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const picks = uniqueTexts(Array.isArray(record.picks) ? record.picks : [], clampSlots(openSlots), seen);
  if (picks.length === 0) {
    throw new MomentumAiError("invalid_response", "Brain dump returned no picks.");
  }
  const parked = uniqueTexts(Array.isArray(record.parked) ? record.parked : [], MAX_PARKED, seen);
  return { picks, parked, source: "ai" };
}

export async function requestBrainDump({
  text,
  openSlots,
  goalTitle,
  agenda = [],
  planUrl = getMomentumAiProxyUrl(),
  fetchImpl,
}: {
  text: string;
  openSlots: number;
  goalTitle: string | null;
  /** Today's events and reminders, pre-formatted (see agenda.ts). */
  agenda?: string[];
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
    },
    fetchImpl,
  });
  return parseBrainDumpResponse(data, openSlots);
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
}

/** Shown on the review when a free user's AI sorts are used up. */
export const FREE_LIMIT_NOTICE =
  "Your free AI sorts are used up, so this is a simple split. Plus turns your notes into clear tasks.";

/**
 * Sort a brain dump with the AI, falling back to the simple local split (with a
 * friendly notice) if the request fails, so the user never loses what they typed.
 */
export async function sortBrainDump(
  params: { text: string; openSlots: number; goalTitle: string | null; agenda?: string[] },
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
