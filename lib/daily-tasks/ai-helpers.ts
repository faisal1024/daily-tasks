// Client for the AI helper routes: brain dump → today's picks, and break a task
// into tiny steps. Responses are untrusted: everything is trimmed, capped,
// de-duplicated and validated before it reaches app state.

import { getMomentumAiProxyUrl, postToProxy, proxyRouteUrl } from "./ai-client";
import { MomentumAiError } from "./ai-status";
import { MAX_TASKS } from "./types";

export const MAX_BRAIN_DUMP_CHARS = 2000;
export const MAX_TASK_TEXT = 64;
export const MAX_PARKED = 10;
export const MAX_STEPS = 5;
export const MAX_STEP_TEXT = 60;

export interface BrainDumpResult {
  picks: string[];
  parked: string[];
  /** "ai" when the proxy sorted it, "local" for the simple offline split. */
  source: "ai" | "local";
}

/** Trim, collapse whitespace, strip list markers, and cap length. */
export function cleanTaskText(value: unknown, max = MAX_TASK_TEXT): string | null {
  if (typeof value !== "string") return null;
  const text = value
    // Bullets may hug the text ("-walk"); numbered markers need a space so
    // "1.5 mile walk" isn't read as item "1." + "5 mile walk".
    .replace(/^\s*(?:[-*•·]\s*|\d+[.)](?:\s+|$)|\[\s?\]\s*)/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  // Tasks read as a list of actions: "book dentist" → "Book dentist".
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return capitalized.length > max ? `${capitalized.slice(0, max - 1).trimEnd()}…` : capitalized;
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
  const parts = text
    .split(/\r?\n|;|•/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const picks = uniqueTexts(parts, clampSlots(openSlots), seen);
  const parked = uniqueTexts(parts, MAX_PARKED, seen);
  return { picks, parked, source: "local" };
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
  planUrl = getMomentumAiProxyUrl(),
  fetchImpl,
}: {
  text: string;
  openSlots: number;
  goalTitle: string | null;
  planUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<BrainDumpResult> {
  const trimmed = text.trim().slice(0, MAX_BRAIN_DUMP_CHARS);
  if (!trimmed) throw new MomentumAiError("invalid_response", "Nothing to sort.");
  const url = proxyRouteUrl(planUrl, "brain-dump");
  if (!url) return localBrainDump(trimmed, openSlots);
  const data = await postToProxy({
    url,
    payload: { text: trimmed, openSlots: clampSlots(openSlots), goalTitle },
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
}

/**
 * Sort a brain dump with the AI, falling back to the simple local split (with a
 * friendly notice) if the request fails, so the user never loses what they typed.
 */
export async function sortBrainDump(
  params: { text: string; openSlots: number; goalTitle: string | null },
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
