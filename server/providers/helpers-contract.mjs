// Contracts for the AI helper endpoints (brain dump, break it down).
//
// Like plan-contract.mjs, everything here is provider-independent: each helper
// has a system prompt, a prompt builder, a JSON schema for structured output,
// a payload validator, and a response validator. The route table in
// server/routes.mjs wires them to URLs.

import { agendaPromptLines, isValidAgenda } from "./agenda.mjs";
import { foldForMatch, HAS_BIDI, LINK_PATTERN } from "./nag-contract.mjs";
import { cleanStats, statsPromptLines } from "./stats.mjs";
const SAFETY =
  "Never use shame, guilt, urgency, medical advice, financial advice, or unsafe " +
  "instructions. Keep wording short, concrete and kind.";

export const MAX_BRAIN_DUMP_CHARS = 2000;
export const MAX_TASK_CHARS = 120;
export const MAX_TASK_TEXT = 64;
export const MAX_PARKED = 20; // keep in sync with lib/daily-tasks/ai-helpers.ts
export const MIN_STEPS = 3;
export const MAX_STEPS = 5;
export const MAX_STEP_TEXT = 60;
// Items this long aren't a verbose task, they're the model echoing the input:
// reject so the client falls back (the on-device split) instead of shortening.
export const MAX_ECHO_TEXT = 200;
// A pick's reason (1.5) is a few words shown under it ("Quick win"): longer
// ones are dropped (the app shows its own), never shortened.
export const MAX_REASON_WORDS = 5;
export const MAX_REASON_CHARS = 40;

function nonEmptyString(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function optionalGoal(value) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= 120);
}

// --- Brain dump → today's three ---------------------------------------------

export const BRAIN_DUMP_SYSTEM_PROMPT =
  "You help an overwhelmed person turn a messy brain dump into today's plan. " +
  "Pick at most the requested number of items that matter most and are doable " +
  "today, and park everything else. Only use items the person actually wrote; " +
  "rephrase each as a short, concrete task starting with a verb, at most 8 " +
  "words (under 60 characters). Merge " +
  "duplicates. Drop items that aren't tasks (feelings, notes). " +
  SAFETY;

export const BRAIN_DUMP_TOOL_NAME = "emit_brain_dump";
export const BRAIN_DUMP_TOOL_DESCRIPTION =
  "Return today's picks (at most openSlots), each with a reason of at most five words, and the parked items, each with its date (when) or null. Call this tool.";

// A soft date on an item (1.6 F): `on` a day it's for, or `by` a deadline,
// with `date` the last day it can be done. Always present (strict schemas
// need every property required), null when the person wrote no day.
export const WHEN_SCHEMA = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["date", "kind"],
      properties: {
        date: { type: "string" },
        kind: { type: "string", enum: ["on", "by"] },
      },
    },
  ],
};
// The furthest ahead a date may be: a year and a day (keep in step with
// MAX_WHEN_DAYS_AHEAD in lib/daily-tasks/resurface.ts).
export const MAX_WHEN_DAYS_AHEAD = 366;
// Days listed in the prompt so the model reads weekdays off a table instead
// of doing calendar sums.
export const WHEN_TABLE_DAYS = 14;

export const BRAIN_DUMP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks", "parked"],
  properties: {
    picks: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "reason", "when"],
        properties: {
          text: { type: "string" },
          reason: { type: "string" },
          when: WHEN_SCHEMA,
        },
      },
    },
    parked: {
      type: "array",
      maxItems: MAX_PARKED,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "when"],
        properties: { text: { type: "string" }, when: WHEN_SCHEMA },
      },
    },
  },
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A real calendar day as yyyy-MM-dd, as UTC midnight ms; NaN otherwise. */
function dateKeyMs(value) {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return NaN;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const date = new Date(ms);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? ms : NaN;
}

function dateKeyOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Words that say an item's own text names a day or date (1.6 F). An item
// without any loses its `when`, so a date the model made up for "Call Mark"
// or "Go to the market" never gets through. Checked per item, on the text
// the model wrote, which the prompt asks to keep the day words in. Kept
// narrow on purpose: whole weekday and month names, an abbreviated month only
// with a dot or a day number ("Mar. 1", "Oct 31"), "May" only with a number,
// short weekdays only after by/on/before/due, date-like numbers ("3/14", "the
// 5th"). It can't prove the date is right, only that one was written.
const MONTHS = "january|february|march|april|june|july|august|september|october|november|december";
const MONTH_SHORT = "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const COUNT_WORDS = "\\d+|a|an|one|two|three|four|five|six|a couple of|a few";
export const DATE_CUE = new RegExp(
  [
    "\\b(?:today|tonight|tomorrow|tmrw|eod|eow|eom)\\b",
    "\\b(?:next|this)\\s+(?:week|weekend|month)\\b",
    "\\bend\\s+of\\s+(?:the\\s+)?(?:week|month)\\b",
    `\\b(?:${WEEKDAYS})\\b`,
    `\\b(?:by|on|before|due|until|till|next|this)\\s+(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\b`,
    `\\b(?:${MONTHS})\\b`,
    `\\b(?:${MONTH_SHORT})(?:\\.|\\s+\\d)`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS}|${MONTH_SHORT}|may)\\b`,
    "\\bmay\\s+\\d{1,2}\\b",
    "\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b",
    "\\b\\d{4}-\\d{2}-\\d{2}\\b",
    "\\b\\d{1,2}(?:st|nd|rd|th)\\b",
    `\\bin\\s+(?:${COUNT_WORDS})\\s+(?:days?|weeks?|months?)\\b`,
  ].join("|"),
  "i",
);

/**
 * A model's `when` for one item, or null: a real date, a known kind, not
 * before the payload's `today` and at most MAX_WHEN_DAYS_AHEAD after it, and
 * only when the item's own text names a day or date (DATE_CUE). No `today`
 * sent (an older app, a free sort): always null.
 */
export function cleanWhen(value, payload, itemText) {
  const today = dateKeyMs(payload?.today);
  if (!Number.isFinite(today) || typeof itemText !== "string" || !DATE_CUE.test(itemText)) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const at = dateKeyMs(value.date);
  if (!Number.isFinite(at) || (value.kind !== "on" && value.kind !== "by")) return null;
  const ahead = Math.round((at - today) / DAY_MS);
  if (ahead < 0 || ahead > MAX_WHEN_DAYS_AHEAD) return null;
  return { date: value.date, kind: value.kind };
}

/** The prompt lines that let the model date items (only with `today`). */
export function whenPromptLines(payload) {
  const today = dateKeyMs(payload?.today);
  if (!Number.isFinite(today)) return ["Set when to null on every item."];
  const day = (ms) => `${WEEKDAY_NAMES[new Date(ms).getUTCDay()]} ${dateKeyOf(ms)}`;
  const next = Array.from({ length: WHEN_TABLE_DAYS }, (_, i) => day(today + (i + 1) * DAY_MS));
  return [
    `Today is ${day(today)}. The next days: ${next.join(", ")}.`,
    "Set when on an item only if they wrote a day or date for it (\"deck for Tuesday\", \"passport before March\"), " +
      'as { date: "YYYY-MM-DD", kind }: kind "on" for a day it is for, "by" for a deadline, with date the last day ' +
      "it can be done (by Friday → that Friday; before Friday → the Thursday; before March → the last day of February). " +
      "Use the next matching day from the list above. Keep the day or date words in that item's text " +
      '("Send the deck for Tuesday"): an item whose text names no day gets no date. ' +
      "Otherwise when is null. Never guess a date, never one before today.",
  ];
}

export function validateBrainDumpPayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  if (!nonEmptyString(payload.text, MAX_BRAIN_DUMP_CHARS)) return "Missing or too long text";
  if (!Number.isInteger(payload.openSlots) || payload.openSlots < 1 || payload.openSlots > 3) {
    return "openSlots must be 1-3";
  }
  if (!optionalGoal(payload.goalTitle)) return "Invalid goalTitle";
  if (!isValidAgenda(payload.agenda)) return "Invalid agenda";
  // `today` (1.6 F) is optional (older apps, free sorts don't send it); when
  // sent it must be a real yyyy-MM-dd day.
  if (payload.today !== undefined && !Number.isFinite(dateKeyMs(payload.today))) return "Invalid today";
  // `stats` (1.5) isn't checked here: a malformed one is ignored
  // (statsPromptLines), so a brain dump is never refused over it.
  return null;
}

export function buildBrainDumpPrompt(payload) {
  return [
    payload.goalTitle ? `The person's bigger goal: ${payload.goalTitle}` : "No specific goal set.",
    `Pick at most ${payload.openSlots} item(s) for today.`,
    ...agendaPromptLines(payload.agenda),
    ...statsPromptLines(payload.stats, { counts: false }),
    ...((cleanStats(payload.stats)?.moved.length ?? 0) > 0
      ? ["Those titles are context only: never add one as a pick or a parked item unless it is in the brain dump below."]
      : []),
    "Brain dump (their words):",
    '"""',
    payload.text.trim(),
    '"""',
    ...whenPromptLines(payload),
    "Give each pick a reason of at most five words saying why it's for today, " +
      'like "Quick win", "Due Friday", "Unblocks the rest" or "Been waiting a while". ' +
      "Name a deadline only if they wrote one. " +
      'Say "Been waiting a while" only for a task listed above as one they keep moving. ' +
      "A reason never says how many times something was moved, and never blames or shames. " +
      "Don't repeat the task's words.",
  ].join("\n");
}

function isShortTask(item, max) {
  return Boolean(item) && typeof item === "object" && nonEmptyString(item.text, max);
}

/** Shorten (never drop) over-long text, counting whole characters. */
function shorten(text, max) {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

/** The raw items textItems keeps, in the same order. */
function textItemSources(list, limit) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item === "object" && typeof item.text === "string" && item.text.trim())
    .filter((item) => item.text.length <= MAX_ECHO_TEXT)
    .slice(0, limit);
}

function textItems(list, max, limit) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item === "object" && typeof item.text === "string" && item.text.trim())
    // An echo of the input isn't a task: drop it rather than shortening it.
    .filter((item) => item.text.length <= MAX_ECHO_TEXT)
    .slice(0, limit)
    .map((item) => {
      const text = shorten(item.text, max);
      const reason = cleanReason(item.reason, text);
      return { text, ...(reason ? { reason } : {}) };
    });
}

// C0/C1 control characters and the Unicode line/paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// Invisible format characters taken out of a reason (joiners stay: emoji).
const FORMAT_SHOWN = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g;

// Keep these in step with lib/daily-tasks/ai-helpers.ts (a test compares them).
// A count of times: "3 times", "moved twice", "put off four times". The move
// words are past-tense claims (not "Moves the project forward").
export const ONCE_TWICE = /\b(?:once|twice|thrice)\b/i;
export const COUNT = /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|multiple|countless|a few)\b/i;
export const MOVE_WORDS =
  /\b(?:times?|moved|put off|pushed|postponed|slipped|carried|delayed|rescheduled|again)\b/i;
// Blame or shame: never under a pick.
export const SHAME =
  /\b(?:lazy|laziness|fail(?:ing|ed|ure)?|pathetic|useless|excuses?|shame(?:ful)?|guilt(?:y)?|slack(?:ing|er)|procrastinat\w*|still not done)\b|\bagain\s*[?!]/i;
// "Been waiting a while" and the like: only for a task the app says keeps moving.
export const WAITING_REASON =
  /\b(?:been waiting|waiting (?:a while|for a while|a long time|for ages|ages)|for a while|a while now|still on (?:your|the) (?:plate|list)|keeps? coming back|(?:been|was|got|keeps? getting) (?:moved|put off|pushed|postponed|delayed|rescheduled|carried over)|put off|pushed back|postponed|rescheduled|carried over|dodged)\b/i;

/** Same words, ignoring case and spacing (the app's memoryTaskKey). */
const taskKey = (text) => String(text).trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A pick's reason as shown under it (1.5), or "" when there is none to show:
 * one line, at most five words and 40 characters (a longer one is dropped,
 * never cut), no bidi controls, no link, email or bare domain (also when
 * hidden behind accents or zero-width characters), never a count of moves
 * ("Moved 3 times"), no blame or shame, and not just the task's own words
 * again. Older apps never read it.
 */
export function cleanReason(value, taskText = "") {
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
  if ([text, folded].some((form) => LINK_PATTERN.test(form))) return "";
  if (ONCE_TWICE.test(folded) || (COUNT.test(folded) && MOVE_WORDS.test(folded)) || SHAME.test(folded)) return "";
  if (folded.toLowerCase() === foldForMatch(String(taskText)).trim().toLowerCase()) return "";
  return text;
}

// Words too common to show an item came from the dump.
const STOPWORDS = new Set(
  "the a an and or for to of in on at with my your our do get go make take buy call this that some more out new all now up off".split(
    " ",
  ),
);
// Scripts written without spaces between words: word matching can't judge them.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

function words(text) {
  return (String(text).normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}

/**
 * Whether an item plausibly comes from the person's own words: it shares a
 * meaningful word with the dump, or one word starts the other ("run" /
 * "running", "groc" / "groceries"). Items with no meaningful words, and dumps
 * in scripts without spaces, always pass (there's nothing reliable to check).
 */
export function fromDump(itemText, dumpText) {
  if (UNSPACED_SCRIPT.test(String(dumpText))) return true;
  const dump = words(dumpText);
  const item = words(itemText);
  if (dump.length === 0 || item.length === 0) return true;
  return item.some((w) =>
    dump.some((d) => d === w || (Math.min(d.length, w.length) >= 3 && (d.startsWith(w) || w.startsWith(d)))),
  );
}

/** Rebuild the brain-dump response from validated fields only. */
export function sanitizeBrainDump(result, payload) {
  // "Been waiting a while" is only true of a task the app said keeps moving
  // (same words as one in stats.moved); on any other pick it is dropped.
  const moved = new Set((cleanStats(payload?.stats)?.moved ?? []).map((item) => taskKey(item.text)));
  const honest = (item) =>
    !item.reason || !WAITING_REASON.test(foldForMatch(item.reason)) || moved.has(taskKey(item.text)) ? item : { text: item.text };
  // A date (1.6 F) only when valid, the app sent today, and the item's own
  // words name a day (cleanWhen).
  const dated = (item, raw) => {
    const when = cleanWhen(raw?.when, payload, item.text);
    return when ? { ...item, when } : item;
  };
  const rawPicks = textItemSources(result.picks, 3);
  const rawParked = textItemSources(result.parked, MAX_PARKED);
  return {
    picks: textItems(result.picks, MAX_TASK_TEXT, 3).map((item, i) => dated(honest(item), rawPicks[i])),
    parked: textItems(result.parked, MAX_TASK_TEXT, MAX_PARKED).map(({ text }, i) => dated({ text }, rawParked[i])),
  };
}

/**
 * Valid when there's a usable pick and the answer is about what they wrote.
 * The guard only rejects the clear failure: when NONE of the (kept) picks
 * shares anything with the dump (e.g. the model invented "Check in with
 * yourself" from a garbled dump). Single rewritten items are left alone, so
 * nothing the person typed goes missing; the app then uses its simple split.
 */
export function isValidBrainDump(result, payload) {
  if (!result || typeof result !== "object" || !Array.isArray(result.picks) || !Array.isArray(result.parked)) {
    return false;
  }
  // Judge the same picks the response will contain.
  const picks = sanitizeBrainDump(result).picks;
  if (picks.length === 0) return false;
  if (typeof payload?.text !== "string") return true; // nothing to compare against
  return picks.some((item) => fromDump(item.text, payload.text));
}

// --- Break it down → 3-5 tiny steps -----------------------------------------

export const BREAK_DOWN_SYSTEM_PROMPT =
  "You break one task into 3 to 5 tiny, concrete first steps that someone who " +
  "feels stuck can start right now. Each step takes a few minutes, starts with " +
  "a verb, is at most 8 words (under 55 characters), and together they finish " +
  "the task (or make clear progress on it). " +
  "Don't add unrelated work. " +
  SAFETY;

export const BREAK_DOWN_TOOL_NAME = "emit_steps";
export const BREAK_DOWN_TOOL_DESCRIPTION = "Return 3 to 5 tiny steps. Call this tool.";

export const BREAK_DOWN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["steps"],
  properties: {
    steps: {
      type: "array",
      minItems: MIN_STEPS,
      maxItems: MAX_STEPS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
    },
  },
};

export function validateBreakDownPayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  if (!nonEmptyString(payload.task, MAX_TASK_CHARS)) return "Missing or too long task";
  if (!optionalGoal(payload.goalTitle)) return "Invalid goalTitle";
  return null;
}

export function buildBreakDownPrompt(payload) {
  return [
    payload.goalTitle ? `Their bigger goal (context only): ${payload.goalTitle}` : "",
    `Task to break down: ${payload.task.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Rebuild the break-down response from validated fields only. */
export function sanitizeBreakDown(result) {
  return {
    steps: textItems(result.steps, MAX_STEP_TEXT, MAX_STEPS).map(({ text }) => ({ text })),
  };
}

export function isValidBreakDown(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.steps)) return false;
  // Long steps count (sanitizeBreakDown shortens them): a model that writes
  // 70-character steps shouldn't turn into a failed request. Echoes don't.
  const usable = result.steps.filter((step) => isShortTask(step, MAX_ECHO_TEXT));
  // Accept 2+ usable steps: a slightly short list is still useful.
  return usable.length >= 2;
}
