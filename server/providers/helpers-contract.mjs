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

/** Rebuild the brain-dump response from validated fields only. */
// Words too common to show an item came from the dump.
const STOPWORDS = new Set(
  "the a an and or for to of in on at with my your our do get go make take buy call the this that some more".split(" "),
);
function words(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}

/**
 * Whether an item plausibly comes from the person's own words: it shares at
 * least one meaningful word (or a 4-letter stem, e.g. "groceries"/"groc")
 * with the dump. The model is told to use only what they wrote; this makes
 * sure an invented task ("Check in with yourself") never reaches the app.
 */
export function fromDump(itemText, dumpText) {
  const dump = words(dumpText);
  if (dump.length === 0) return true;
  const stems = new Set(dump.map((w) => w.slice(0, 4)));
  const exact = new Set(dump);
  return words(itemText).some((w) => exact.has(w) || stems.has(w.slice(0, 4)));
}

export function sanitizeBrainDump(result, payload) {
  const keep = (item) => !payload || fromDump(item.text, payload.text);
  return {
    picks: textItems(result.picks, MAX_TASK_TEXT, 3).filter(keep),
    parked: textItems(result.parked, MAX_TASK_TEXT, MAX_PARKED)
      .filter(keep)
      .map(({ text }) => ({ text })),
  };
}

export function isValidBrainDump(result, payload) {
  // Over-long items are shortened by sanitizeBrainDump rather than failing the
  // request; only an echo of the input (> MAX_ECHO_TEXT) makes an item unusable.
  // At least one pick must come from the dump itself (see fromDump); if none
  // does, the app falls back to its simple on-device split.
  return Boolean(
    result &&
      typeof result === "object" &&
      Array.isArray(result.picks) &&
      Array.isArray(result.parked) &&
      result.picks.some(
        (item) => isShortTask(item, MAX_ECHO_TEXT) && (!payload || fromDump(item.text, payload.text)),
      ),
  );
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
