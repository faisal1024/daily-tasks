// Nag mode, 1.6 G (Plus): up to five short lines of the user's own ("what my
// mom actually says"), mixed into the day's nags in the chosen voice's
// title. Pure, so it is unit-tested; nag-plan.ts puts them into the plan.
//
// The rules:
// - Kept in Settings (`notifications.nagOwnLines`), on the phone only: never
//   sent to the AI service and never to analytics (not even a count).
// - Checked as they're typed and again when saved state loads
//   (checkNagOwnLine): one line, at most 80 characters, no link, invisible
//   format characters (bidi marks and overrides, zero-width characters)
//   taken out, no two the same. The voices' blocklists (affection, the Drill
//   sergeant's rudeness) are NOT applied: they are the user's own words, for
//   their own phone, and they wrote them.
// - `{task}` (at most once) is the name of the task the nag is about,
//   cleaned and quoted like a built-in line's. A line with it is only used
//   while task names are shown, and never names a sensitive task. With
//   "Hide task names" on, a line without it is still used, unless it holds
//   the words of one of the open tasks.
// - At most 1 in 3 of the day's nags is one of them, never two in a row
//   (nagOwnSteps), and none is said twice in a day.

import { cleanNagText, MAX_NAG_LINE, nagTaskName, nagTextHasLink, seededRandom } from "./nag";

export const MAX_NAG_OWN_LINES = 5;
export const MAX_NAG_OWN_LINE_CHARS = 80;
/** Where the task's name goes in a line of the user's own. */
export const NAG_OWN_TASK = "{task}";

export type NagOwnLineProblem = "empty" | "long" | "link" | "placeholder" | "duplicate" | "full";

/** What to say when a line can't be added. */
export const NAG_OWN_LINE_PROBLEMS: Record<NagOwnLineProblem, string> = {
  empty: "Write a few words first.",
  long: `Keep it to ${MAX_NAG_OWN_LINE_CHARS} characters.`,
  link: "Links can't go in a nag.",
  placeholder: "Braces only go in {task}, once. Take out any other { or }.",
  duplicate: "You already have that one.",
  full: `That's ${MAX_NAG_OWN_LINES} already. Remove one to add another.`,
};

/** Said instead of the placeholder problem when a brace has no partner ("Do {task now"). */
export const NAG_OWN_LINE_UNMATCHED = "A brace is missing its partner. Write {task} with both, or take it out.";

/** What to say about `problem` for the line `raw` (unmatched braces get their own message). */
export function nagOwnLineProblemMessage(problem: NagOwnLineProblem, raw: string): string {
  if (problem === "placeholder") {
    const text = typeof raw === "string" ? raw : "";
    if ((text.match(/\{/g) ?? []).length !== (text.match(/\}/g) ?? []).length) return NAG_OWN_LINE_UNMATCHED;
  }
  return NAG_OWN_LINE_PROBLEMS[problem];
}

/** From this many characters the editor shows how many are used. */
export const NAG_OWN_LINE_COUNTER_FROM = 60;

const PLACEHOLDER = /\{\s*task\s*\}/gi;

/**
 * A line as it would be kept, and what's wrong with it (null when nothing).
 * `existing` are the lines already kept (for duplicates and the limit).
 */
export function checkNagOwnLine(raw: string, existing: readonly string[] = []): { text: string; problem: NagOwnLineProblem | null } {
  const text = cleanNagText(typeof raw === "string" ? raw : "").replace(PLACEHOLDER, NAG_OWN_TASK);
  const withoutTask = text.split(NAG_OWN_TASK).join("");
  if (!withoutTask.trim()) return { text, problem: "empty" };
  if (Array.from(text).length > MAX_NAG_OWN_LINE_CHARS) return { text, problem: "long" };
  if (nagTextHasLink(text)) return { text, problem: "link" };
  if (text.split(NAG_OWN_TASK).length > 2 || /[{}]/.test(withoutTask)) return { text, problem: "placeholder" };
  const key = text.toLowerCase();
  if (existing.some((line) => line.toLowerCase() === key)) return { text, problem: "duplicate" };
  if (existing.length >= MAX_NAG_OWN_LINES) return { text, problem: "full" };
  return { text, problem: null };
}

/** The saved lines, checked again: anything that isn't a usable line is left out, at most five. */
export function normalizeNagOwnLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const { text, problem } = checkNagOwnLine(item, lines);
    if (problem === null) lines.push(text);
  }
  return lines;
}

/** The line has `{task}`. */
export function nagOwnLineNamesTask(line: string): boolean {
  return line.includes(NAG_OWN_TASK);
}

/**
 * The line as the nag says it: `{task}` is the task's name, cleaned and quoted
 * (nagTaskName). Never over MAX_NAG_LINE (an AI line's cap), whatever it holds.
 */
export function fillNagOwnLine(line: string, taskText: string | null): string | null {
  const filled = !nagOwnLineNamesTask(line) ? line : taskText ? line.replace(NAG_OWN_TASK, () => nagTaskName(taskText)) : null;
  if (filled === null) return null;
  const chars = Array.from(filled);
  return chars.length > MAX_NAG_LINE ? chars.slice(0, MAX_NAG_LINE - 1).join("").trimEnd() + "\u2026" : filled;
}

const fold = (value: string) => cleanNagText(value).toLowerCase().replace(/[‘’]/g, "'");

/**
 * With "Hide task names" on, a line of the user's own isn't used when it
 * holds the words of one of the open tasks (three characters or more), so
 * it can't put a task's name on the lock screen.
 */
export function nagOwnLineHoldsTask(line: string, openTexts: readonly string[]): boolean {
  const folded = fold(line);
  return openTexts.some((text) => {
    const task = fold(text);
    return task.length >= 3 && folded.includes(task);
  });
}

/**
 * Which steps of a day of `total` nags say one of the user's lines: at most
 * one in three (floor(total / 3), and no more than `count` lines), never two
 * steps in a row. The day is cut into that many equal parts of three steps
 * or more, and each part's step is drawn from all but its last, so the next
 * part's is at least two steps on. The same seed gives the same steps.
 */
export function nagOwnSteps(total: number, count: number, seed: string): number[] {
  const whole = Number.isFinite(total) ? Math.floor(total) : 0;
  const parts = Math.min(Math.floor(whole / 3), Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);
  if (parts <= 0) return [];
  const random = seededRandom(`${seed}|own`);
  const steps: number[] = [];
  for (let part = 0; part < parts; part += 1) {
    const first = Math.floor((part * whole) / parts) + 1;
    const last = Math.floor(((part + 1) * whole) / parts);
    // All but the part's last step: the next part starts right after it.
    steps.push(first + Math.floor(random() * (last - first)));
  }
  return steps;
}
