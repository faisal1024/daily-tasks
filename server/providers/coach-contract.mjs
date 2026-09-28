// Contract for the Coach's note (1.2): for each of today's tasks, one tiny
// first step ("start") and the next small piece once they're moving
// ("momentum"). The app shows one line at a time under the three.
//
// Provider-independent, like plan-contract.mjs and evening-contract.mjs.

export const MAX_COACH_TASKS = 3;
export const MAX_COACH_TASK_CHARS = 120;
// ~20 words; a longer line is dropped (the app uses its built-in one).
export const MAX_COACH_LINE = 140;
export const COACH_TONES = ["calm", "friendly", "direct"];

export const COACH_SYSTEM_PROMPT =
  "You are a calm daily coach. For each task, write two lines in the second " +
  "person, each under 18 words and 110 characters. 'start': one concrete, " +
  "physical first action they could do in the next two minutes (open, write, " +
  "find, put on, text). 'momentum': the next small piece to do once they're " +
  "moving; mention their bigger goal only if one is given and it clearly fits. " +
  "Mention the task by a short name (two to four words from its text) so each " +
  "line makes sense on its own. Use only what the task says: never invent " +
  "people, tools, deadlines or reasons. If a task is personal or emotional, be " +
  "gentle and practical. No exclamation marks, emoji, hype ('crush it'), guilt " +
  "('you still haven't'), urgency ('now', 'before it's too late'), 'just', " +
  "'should', links, or medical/financial advice. JSON only, one entry per task, " +
  "in order.\n\n" +
  'Example: task "Draft Q3 report" -> start "Open a blank page for the Q3 ' +
  'report and write one heading.", momentum "With the Q3 report started, fill ' +
  'in the easiest section next."';

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

/** User text for the prompt: control characters (newlines too) become spaces. */
function promptText(value) {
  return value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

export function buildCoachPrompt(payload) {
  const tasks = payload.tasks.map((task, index) => `${index + 1}. ${promptText(task)}`).join("\n");
  const goal = typeof payload.goalTitle === "string" ? promptText(payload.goalTitle) : "";
  return [
    goal ? `Their bigger goal (context only): ${goal}` : "No specific goal set.",
    `Voice: ${COACH_TONES.includes(payload.tone) ? payload.tone : "calm"}, but always calm underneath.`,
    `Today's tasks:\n${tasks}`,
    `Return exactly ${payload.tasks.length} entries, one per task, in this order.`,
  ].join("\n");
}

// C0/C1 control characters (newlines included: a note is one line).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// Real links only: a scheme URL, a "www." host, or an email. The note never
// sends anyone anywhere. Bare "word.word" (README.md, Node.js) is fine. Same
// pattern as the app (lib/daily-tasks/coach-note.ts).
const LINK_PATTERN = /\bhttps?:\/\/|\bwww\.|[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/**
 * One clean line: control characters become spaces, one space between words.
 * "" when nothing's left, it's over MAX_COACH_LINE, or it holds a link or
 * email: the whole line goes (the app uses its built-in line for that task),
 * never a half-sentence.
 */
export function cleanCoachLine(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > MAX_COACH_LINE || LINK_PATTERN.test(text)) return "";
  return text;
}

/** Usable when at least one entry (of those for the tasks sent) has both lines after cleaning. */
export function isValidCoach(result, payload) {
  if (!result || typeof result !== "object" || !Array.isArray(result.notes)) return false;
  return sanitizeCoach(result, payload).notes.some((note) => note.start && note.momentum);
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
