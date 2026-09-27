// The evening close: how today went → a kind note, a draft of tomorrow's three
// (with a plain "because" line), and an updated coach memory.
//
// AI when available (Plus + proxy); otherwise a simple on-device version so
// the ritual always works. Responses are untrusted and cleaned like every
// other AI response.

import { getMomentumAiProxyUrl, postToProxy, proxyRouteUrl } from "./ai-client";
import { cleanTaskText } from "./ai-helpers";
import { MomentumAiError } from "./ai-status";
import { addDays, fromDateKey } from "./date";
import type { AppState, DayRecord, EveningCloseRecord, ReflectionResult, TomorrowDraft } from "./types";
import { MAX_TASKS } from "./types";

export const MAX_EVENING_NOTE = 160;
export const MAX_BECAUSE = 100;
export const MAX_MEMORY = 500;

export interface EveningInput {
  result: ReflectionResult;
  tasks: { text: string; done: boolean }[];
  note: string | null;
  goalTitle: string | null;
  memory: string | null;
}

export interface EveningClose {
  note: string;
  because: string;
  tomorrow: string[];
  /** Updated coach memory; null keeps the current one (the local version). */
  memory: string | null;
  source: "ai" | "local";
}

function capText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

/** What to send: today's tasks with done flags, the check-in, goal and memory. */
export function buildEveningInput(
  state: Pick<AppState, "tasks" | "todayCompletions" | "todayReflection" | "momentumProfile" | "coachMemory">,
  result: ReflectionResult,
  /** The note as typed right now (it may not be saved to state yet). */
  note?: string | null,
): EveningInput {
  const done = new Set(state.todayCompletions);
  const typed = typeof note === "string" && note.trim() ? note.trim() : null;
  return {
    result,
    tasks: state.tasks.slice(0, MAX_TASKS).map((task) => ({ text: task.text, done: done.has(task.id) })),
    note: typed ?? state.todayReflection,
    goalTitle: state.momentumProfile.goalTitle,
    memory: state.coachMemory,
  };
}

const LOCAL_NOTES: Record<ReflectionResult, string> = {
  easy: "Nicely done. You made today look easy.",
  good: "A good day. You showed up and followed through.",
  hard: "Hard days count too. You still showed up.",
  missed: "Some days go sideways. Tomorrow is a fresh start.",
};

/**
 * On-device close: tomorrow carries over what's still open (at most three),
 * with a note and because line that match how the day felt.
 */
export function localEveningClose(input: EveningInput): EveningClose {
  const open = input.tasks.filter((task) => !task.done).map((task) => task.text);
  const tomorrow = open.slice(0, MAX_TASKS);
  const because =
    tomorrow.length === 0
      ? "Everything's done, so tomorrow starts fresh."
      : input.result === "hard" || input.result === "missed"
        ? "Just what's still open, nothing new on top."
        : "Picking up where today left off.";
  return { note: LOCAL_NOTES[input.result], because, tomorrow, memory: null, source: "local" };
}

/** Normalise the proxy's evening response; throws if nothing usable. */
export function parseEveningResponse(data: unknown): EveningClose {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const note = capText(record.note, MAX_EVENING_NOTE);
  const because = capText(record.because, MAX_BECAUSE) ?? "";
  const memory = capText(record.memory, MAX_MEMORY);
  const seen = new Set<string>();
  const tomorrow: string[] = [];
  for (const item of Array.isArray(record.tomorrow) ? record.tomorrow : []) {
    if (tomorrow.length >= MAX_TASKS) break;
    const raw = item && typeof item === "object" ? (item as { text?: unknown }).text : item;
    const text = cleanTaskText(raw);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    tomorrow.push(text);
  }
  if (!note || tomorrow.length === 0) {
    throw new MomentumAiError("invalid_response", "Evening close returned nothing usable.");
  }
  return { note, because, tomorrow, memory, source: "ai" };
}

export async function requestEveningClose({
  input,
  planUrl = getMomentumAiProxyUrl(),
  fetchImpl,
}: {
  input: EveningInput;
  planUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<EveningClose> {
  const url = proxyRouteUrl(planUrl, "evening");
  if (!url) throw new MomentumAiError("unavailable", "The evening coach isn't available.");
  const data = await postToProxy({ url, payload: input, fetchImpl });
  return parseEveningResponse(data);
}

/**
 * Close the day: the AI version when allowed, otherwise (or if it fails) the
 * on-device one, so the user always gets a note and tomorrow's draft.
 */
export async function closeDay(
  input: EveningInput,
  options: { useAi: boolean; request?: typeof requestEveningClose },
): Promise<EveningClose> {
  if (!options.useAi) return localEveningClose(input);
  try {
    return await (options.request ?? requestEveningClose)({ input });
  } catch {
    return localEveningClose(input);
  }
}

/** The draft to keep for tomorrow (null when there's nothing to suggest). */
export function draftForTomorrow(close: EveningClose, today: string): TomorrowDraft | null {
  if (close.tomorrow.length === 0) return null;
  return {
    forDate: addDays(today, 1),
    tasks: close.tomorrow,
    note: close.note,
    because: close.because,
    source: close.source,
  };
}

/** Whether `day` has been closed (for this answer, when one is given). */
export function isDayClosed(
  record: EveningCloseRecord | null,
  day: string,
  result?: ReflectionResult,
): boolean {
  if (!record || record.date !== day) return false;
  return result === undefined || record.result === result;
}

/**
 * The draft to show this morning: only for today, when there's room, and
 * without anything already on today's list, anything finished after the
 * close yesterday, or anything dropped at the rollover.
 */
export function draftToShow(
  draft: TomorrowDraft | null,
  input: { today: string; locked: boolean; taskTexts: string[]; sourceDay?: DayRecord | null },
): TomorrowDraft | null {
  if (!draft || draft.forDate !== input.today || input.locked) return null;
  const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const have = new Set(input.taskTexts.map(key));
  for (const task of input.sourceDay?.tasks ?? []) {
    if (task.completed || task.rolloverOutcome === "dropped") have.add(key(task.text));
  }
  const remaining = draft.tasks.filter((text) => !have.has(key(text)));
  if (remaining.length === 0 || input.taskTexts.length >= MAX_TASKS) return null;
  return { ...draft, tasks: remaining };
}

/** "Tuesday" for the morning notification. */
export function weekdayName(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString("en-US", { weekday: "long" });
}

/** Evening check-in is offered once there are tasks and the day is winding down. */
export function showEveningCheckIn(input: {
  taskCount: number;
  locked?: boolean;
  perfect: boolean;
  hour: number;
  enabled: boolean;
}): boolean {
  if (!input.enabled || input.taskCount === 0) return false;
  // Not just because the day is locked (auto-lock is around noon): closing
  // the day at lunch would draft tomorrow from a half-finished snapshot.
  return input.perfect || input.hour >= 17;
}
