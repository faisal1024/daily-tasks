// Contract for the Coach's note (1.2): for each of today's tasks, one tiny
// first step ("start") and one line on why it matters or what's next
// ("momentum"). The app shows one line at a time under the three.
//
// Provider-independent, like plan-contract.mjs and evening-contract.mjs.

export const MAX_COACH_TASKS = 3;
export const MAX_COACH_TASK_CHARS = 120;
// ~20 words; anything longer is shortened, never trusted as-is.
export const MAX_COACH_LINE = 140;
export const COACH_TONES = ["calm", "friendly", "direct"];

export const COACH_SYSTEM_PROMPT =
  "You are a calm daily coach. For each task you are given, write two lines in " +
  "the second person, each 20 words or fewer: 'start', one concrete, tiny first " +
  "step they can take in the next few minutes; and 'momentum', why the task " +
  "matters or what to do next once they're moving. Plain, specific words. No " +
  "exclamation marks, no emoji, no hype ('crush it'), no guilt ('you still " +
  "haven't'), no urgency, no links, no medical or financial advice. Respond " +
  "with JSON only, one entry per task, in the order given.";

export const COACH_TOOL_NAME = "emit_coach_notes";
export const COACH_TOOL_DESCRIPTION =
  "Return one { start, momentum } entry per task, in the order given. Call this tool.";

export const COACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes"],
  properties: {
    notes: {
      type: "array",
      minItems: 1,
      maxItems: MAX_COACH_TASKS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "momentum"],
        properties: {
          start: { type: "string" },
          momentum: { type: "string" },
        },
      },
    },
  },
};

function charLength(value) {
  return Array.from(value).length;
}

export function validateCoachPayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  if (!Array.isArray(payload.tasks) || payload.tasks.length < 1 || payload.tasks.length > MAX_COACH_TASKS) {
    return "tasks must be 1-3 items";
  }
  for (const task of payload.tasks) {
    if (typeof task !== "string" || !task.trim() || charLength(task) > MAX_COACH_TASK_CHARS) {
      return "Invalid task";
    }
  }
  if (
    payload.goalTitle !== undefined &&
    payload.goalTitle !== null &&
    (typeof payload.goalTitle !== "string" || charLength(payload.goalTitle) > 120)
  ) {
    return "Invalid goalTitle";
  }
  if (payload.tone !== undefined && payload.tone !== null && !COACH_TONES.includes(payload.tone)) {
    return "Invalid tone";
  }
  return null;
}

export function buildCoachPrompt(payload) {
  const tasks = payload.tasks.map((task, index) => `${index + 1}. ${task.trim()}`).join("\n");
  return [
    payload.goalTitle ? `Their bigger goal (context only): ${payload.goalTitle}` : "No specific goal set.",
    `Voice: ${COACH_TONES.includes(payload.tone) ? payload.tone : "calm"}, but always calm underneath.`,
    `Today's tasks:\n${tasks}`,
    `Return exactly ${payload.tasks.length} entries, one per task, in this order.`,
  ].join("\n");
}

// C0/C1 control characters (newlines included: a note is one line).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// Links of any kind: the note never sends anyone anywhere.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.(?:com|net|org|io|co|app|ai|dev|ly)(?:\/\S*)?\b/gi;

/** One clean line: no control characters or links, one space, capped. "" when nothing's left. */
export function cleanCoachLine(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(CONTROL, " ").replace(URL_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length > MAX_COACH_LINE ? `${chars.slice(0, MAX_COACH_LINE - 1).join("").trimEnd()}…` : text;
}

/** Usable when at least one entry has both lines after cleaning. */
export function isValidCoach(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.notes)) return false;
  return sanitizeCoach(result).notes.some((note) => note.start && note.momentum);
}

/**
 * Rebuild the response from cleaned fields only. Positions are kept (one
 * entry per task sent, at most), so a bad entry reads as { start: "",
 * momentum: "" } and the app falls back to its built-in line for that task.
 */
export function sanitizeCoach(result, payload) {
  const limit = Array.isArray(payload?.tasks) ? payload.tasks.length : MAX_COACH_TASKS;
  const notes = (Array.isArray(result?.notes) ? result.notes : []).slice(0, limit).map((item) => {
    const record = item && typeof item === "object" ? item : {};
    return { start: cleanCoachLine(record.start), momentum: cleanCoachLine(record.momentum) };
  });
  return { notes };
}
