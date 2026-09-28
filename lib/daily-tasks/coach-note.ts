// The Coach's note (1.2): one short line under the three, about the next
// open task. `start` is a tiny first step (the morning, until the first
// tick); `momentum` is why it matters or what's next (after a tick, midday).
//
// Free: built-in lines, picked stably per day and task. Plus (confirmed): one
// AI call once the three are set returns both lines for every task; it's
// cached per day and task text, asked again at most once that day if the
// texts change, and any failure quietly keeps the built-in lines.
//
// Pure except requestCoachNotes (fetch only), so it's unit-tested.

import { getMomentumAiProxyUrl, postToProxy, proxyRouteUrl } from "./ai-client";
import { MomentumAiError } from "./ai-status";
import { pickStable } from "./coach-messages";
import type { TodayPhase } from "./today-phase";
import type { CoachNoteLines, CoachNotesCache, MomentumSettings, Task, TaskId } from "./types";
import { MAX_COACH_REQUESTS_PER_DAY, MAX_TASKS } from "./types";

export { MAX_COACH_REQUESTS_PER_DAY };

export type CoachNoteKind = keyof CoachNoteLines;

export interface CoachNote {
  kind: CoachNoteKind;
  text: string;
  source: "ai" | "local";
}

/** The task as quoted in a built-in line. */
export const COACH_TASK_QUOTE_CHARS = 40;
/** Same cap as the proxy (~20 words). */
export const MAX_COACH_LINE = 140;
// The proxy's limit for a task (and the goal title) in the payload.
const MAX_TASK_CHARS = 120;

// Calm, second person, 20 words or fewer with the task quoted; no
// exclamation marks, no guilt, no hype, no emoji. {task} is the quoted task.
export const START_LINES = [
  "Open {task} and give it two minutes. That's all it needs for now.",
  "For {task}, get out the one thing you need first.",
  "Start {task} small: set a five-minute timer and begin.",
  "Give {task} ten quiet minutes before anything else asks for you.",
  "Name the very first step of {task}, then take just that one.",
  "Clear a little space for {task} and begin before you feel ready.",
  "Make {task} smaller. What could you finish in five minutes?",
  "Begin {task} with the easiest part. The rest gets lighter after.",
] as const;

export const MOMENTUM_LINES = [
  "Next up: {task}. One small push keeps the day moving.",
  "{task} is next. A few focused minutes will move it forward.",
  "{task} matters because it moves today toward what you chose.",
  "Keep it steady: pick up {task} and do the next small part.",
  "{task} doesn't need to be perfect, just a little further along.",
  "When you're ready, {task} is waiting. Start where it's easiest.",
  "Bring a steady pace to {task}. Ten minutes is plenty.",
  "{task} is the next piece of today. One step at a time.",
] as const;

/** Cache key: the task text, trimmed, single-spaced and lower-cased. */
export function coachTaskKey(text: string): string {
  return Array.from(text.trim().replace(/\s+/g, " ").toLowerCase()).slice(0, MAX_TASK_CHARS).join("");
}

/** “The task”, cut to about 40 characters (never mid-emoji). */
export function quoteTask(text: string): string {
  const chars = Array.from(text.trim().replace(/\s+/g, " "));
  const short =
    chars.length > COACH_TASK_QUOTE_CHARS
      ? `${chars.slice(0, COACH_TASK_QUOTE_CHARS - 1).join("").trimEnd()}…`
      : chars.join("");
  return `“${short}”`;
}

/** The task the note is about: the first one not yet ticked off. */
export function nextOpenTask(tasks: Task[], completedIds: TaskId[]): Task | null {
  const done = new Set(completedIds);
  return tasks.find((task) => !done.has(task.id)) ?? null;
}

/** The phases that show the note (the others have their own lower section). */
export function showsCoachNote(phase: TodayPhase): boolean {
  return phase === "morning" || phase === "midday";
}

/** A tiny first step in the morning before the first tick; momentum otherwise. */
export function coachNoteKind(phase: TodayPhase, completedCount: number): CoachNoteKind {
  return phase === "morning" && completedCount === 0 ? "start" : "momentum";
}

/** The built-in line: the same one all day for the same task and kind. */
export function localCoachLine(kind: CoachNoteKind, taskText: string, dateKey: string): string {
  const lines = kind === "start" ? START_LINES : MOMENTUM_LINES;
  const template = pickStable<string>([...lines], [dateKey, kind, coachTaskKey(taskText)]);
  return template.replace("{task}", quoteTask(taskText));
}

/** Today's AI lines for this task, if the cache has them. */
export function cachedCoachLines(
  cache: CoachNotesCache | null,
  today: string,
  taskText: string,
): CoachNoteLines | null {
  if (!cache || cache.date !== today) return null;
  const key = coachTaskKey(taskText);
  return Object.prototype.hasOwnProperty.call(cache.notes, key) ? cache.notes[key] : null;
}

/** The line to show: the cached AI line when there is one, else the built-in one. */
export function coachNote(input: {
  cache: CoachNotesCache | null;
  today: string;
  taskText: string;
  kind: CoachNoteKind;
}): CoachNote {
  const cached = cachedCoachLines(input.cache, input.today, input.taskText)?.[input.kind];
  return cached
    ? { kind: input.kind, text: cached, source: "ai" }
    : { kind: input.kind, text: localCoachLine(input.kind, input.taskText, input.today), source: "local" };
}

/** "The three are set": three tasks, or a set (locked) day with at least one. */
export function coachTasksSet(taskCount: number, locked: boolean): boolean {
  return taskCount >= MAX_TASKS || (locked && taskCount >= 1);
}

/** Whether an AI call is due: a task not asked about today, and calls left. */
export function needsCoachRequest(cache: CoachNotesCache | null, today: string, taskTexts: string[]): boolean {
  if (taskTexts.length === 0) return false;
  const current = cache && cache.date === today ? cache : null;
  if ((current?.requests ?? 0) >= MAX_COACH_REQUESTS_PER_DAY) return false;
  const asked = new Set(current?.asked ?? []);
  return taskTexts.some((text) => !asked.has(coachTaskKey(text)));
}

function emptyCache(today: string): CoachNotesCache {
  return { date: today, notes: {}, requests: 0, asked: [], logged: false };
}

/**
 * The cache to update for `day`: today's as is, a fresh one for a new day,
 * or null when `day` is older than what's cached (a reply that landed after
 * midnight mustn't wipe the new day).
 */
function cacheFor(cache: CoachNotesCache | null, day: string): CoachNotesCache | null {
  if (!cache || cache.date < day) return emptyCache(day);
  return cache.date === day ? cache : null;
}

/** Count a call (made now, whatever its answer) and remember what it asked about. */
export function claimCoachRequest(
  cache: CoachNotesCache | null,
  day: string,
  taskTexts: string[],
): CoachNotesCache | null {
  const base = cacheFor(cache, day);
  if (!base) return cache;
  const asked = new Set(base.asked);
  for (const text of taskTexts) asked.add(coachTaskKey(text));
  return { ...base, requests: base.requests + 1, asked: [...asked] };
}

/** Keep the AI lines that came back (keyed by task text). */
export function mergeCoachNotes(
  cache: CoachNotesCache | null,
  day: string,
  notes: Record<string, CoachNoteLines>,
): CoachNotesCache | null {
  if (Object.keys(notes).length === 0) return cache;
  const base = cacheFor(cache, day);
  if (!base) return cache;
  return { ...base, notes: { ...base.notes, ...notes } };
}

/** coach_note_loaded went out for `day`. */
export function markCoachNoteLogged(cache: CoachNotesCache | null, day: string): CoachNotesCache | null {
  const base = cacheFor(cache, day);
  if (!base || base.logged) return cache;
  return { ...base, logged: true };
}

/** Whether coach_note_loaded has gone out today. */
export function coachNoteLogged(cache: CoachNotesCache | null, today: string): boolean {
  return Boolean(cache && cache.date === today && cache.logged);
}

// C0/C1 control characters (newlines included: the note is one line).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.(?:com|net|org|io|co|app|ai|dev|ly)(?:\/\S*)?\b/gi;

/** An untrusted line, cleaned: no control characters or links, capped. Null when nothing's left. */
export function cleanCoachLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL, " ").replace(URL_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > MAX_COACH_LINE ? `${chars.slice(0, MAX_COACH_LINE - 1).join("").trimEnd()}…` : text;
}

/**
 * The proxy's answer, matched to the tasks sent (in order). Entries missing
 * either line, or past the tasks sent, are dropped: those tasks keep their
 * built-in lines.
 */
export function parseCoachResponse(data: unknown, taskTexts: string[]): Record<string, CoachNoteLines> {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(record.notes) ? record.notes : [];
  const out: Record<string, CoachNoteLines> = {};
  taskTexts.forEach((text, index) => {
    const item = list[index];
    if (!item || typeof item !== "object") return;
    const start = cleanCoachLine((item as { start?: unknown }).start);
    const momentum = cleanCoachLine((item as { momentum?: unknown }).momentum);
    const key = coachTaskKey(text);
    // A plain object keyed by task text: "__proto__" can't be a key.
    if (start && momentum && key !== "__proto__") out[key] = { start, momentum };
  });
  return out;
}

export interface CoachRequestInput {
  tasks: string[];
  goalTitle: string | null;
  tone: MomentumSettings["suggestionTone"];
}

/** Ask the proxy for both lines for every task; throws on any failure or an empty answer. */
export async function requestCoachNotes({
  input,
  planUrl = getMomentumAiProxyUrl(),
  fetchImpl,
}: {
  input: CoachRequestInput;
  planUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, CoachNoteLines>> {
  const url = proxyRouteUrl(planUrl, "coach-note");
  if (!url) throw new MomentumAiError("unavailable", "The coach's note isn't available.");
  const tasks = input.tasks
    .map((text) => Array.from(text.trim()).slice(0, MAX_TASK_CHARS).join(""))
    .filter(Boolean)
    .slice(0, MAX_TASKS);
  const data = await postToProxy({
    url,
    payload: {
      tasks,
      goalTitle: input.goalTitle ? Array.from(input.goalTitle).slice(0, MAX_TASK_CHARS).join("") : null,
      tone: input.tone,
    },
    fetchImpl,
  });
  const notes = parseCoachResponse(data, tasks);
  if (Object.keys(notes).length === 0) {
    throw new MomentumAiError("invalid_response", "The coach's note came back empty.");
  }
  return notes;
}
