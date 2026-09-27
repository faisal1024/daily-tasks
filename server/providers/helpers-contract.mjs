// Contracts for the AI helper endpoints (brain dump, break it down).
//
// Like plan-contract.mjs, everything here is provider-independent: each helper
// has a system prompt, a prompt builder, a JSON schema for structured output,
// a payload validator, and a response validator. The route table in
// server/routes.mjs wires them to URLs.

import { agendaPromptLines, isValidAgenda } from "./agenda.mjs";
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
  "Return today's picks (at most openSlots) and the parked items. Call this tool.";

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
        required: ["text", "reason"],
        properties: {
          text: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    parked: {
      type: "array",
      maxItems: MAX_PARKED,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
    },
  },
};

export function validateBrainDumpPayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  if (!nonEmptyString(payload.text, MAX_BRAIN_DUMP_CHARS)) return "Missing or too long text";
  if (!Number.isInteger(payload.openSlots) || payload.openSlots < 1 || payload.openSlots > 3) {
    return "openSlots must be 1-3";
  }
  if (!optionalGoal(payload.goalTitle)) return "Invalid goalTitle";
  if (!isValidAgenda(payload.agenda)) return "Invalid agenda";
  return null;
}

export function buildBrainDumpPrompt(payload) {
  return [
    payload.goalTitle ? `The person's bigger goal: ${payload.goalTitle}` : "No specific goal set.",
    `Pick at most ${payload.openSlots} item(s) for today.`,
    ...agendaPromptLines(payload.agenda),
    "Brain dump (their words):",
    '"""',
    payload.text.trim(),
    '"""',
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

function textItems(list, max, limit) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item === "object" && typeof item.text === "string" && item.text.trim())
    // An echo of the input isn't a task: drop it rather than shortening it.
    .filter((item) => item.text.length <= MAX_ECHO_TEXT)
    .slice(0, limit)
    .map((item) => ({
      text: shorten(item.text, max),
      ...(typeof item.reason === "string" ? { reason: item.reason.slice(0, 200) } : {}),
    }));
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
export function sanitizeBrainDump(result) {
  return {
    picks: textItems(result.picks, MAX_TASK_TEXT, 3),
    parked: textItems(result.parked, MAX_TASK_TEXT, MAX_PARKED).map(({ text }) => ({ text })),
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
