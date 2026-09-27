// Contract for the evening close: how today went → a short, kind note, a
// draft of tomorrow's three (with the reason they look the way they do), and
// an updated "coach memory" (a rolling summary the next plan can use).
//
// Provider-independent, like plan-contract.mjs and helpers-contract.mjs.

const SAFETY =
  "Never use shame, guilt, urgency, streak pressure, medical advice, financial " +
  "advice, or unsafe instructions. Keep wording short, concrete and kind.";

export const MAX_EVENING_NOTE = 160;
export const MAX_BECAUSE = 100;
export const MAX_DRAFT_TASK = 64;
export const MAX_MEMORY = 500;
export const MAX_DRAFT_TASKS = 3;

export const EVENING_SYSTEM_PROMPT =
  "You are a calm daily coach closing someone's day. Reply with: a one- or " +
  "two-sentence note that acknowledges how today went without judging it; a " +
  "draft of tomorrow's (at most) three tasks, each a short verb phrase they can " +
  "do tomorrow; a short 'because' line explaining the draft in plain words " +
  "(e.g. 'Because today was hard, tomorrow is lighter.'); and an updated memory: " +
  "a brief running summary of patterns worth remembering (what they finish, " +
  "what keeps slipping, what helps), rewritten to stay under 500 characters. " +
  "Tomorrow's draft should carry over what still matters, shrink tasks that " +
  "keep slipping, and match how the day felt. " +
  SAFETY;

export const EVENING_TOOL_NAME = "emit_evening_close";
export const EVENING_TOOL_DESCRIPTION =
  "Return the evening note, tomorrow's draft (up to three tasks), the because line, and the updated memory. Call this tool.";

export const EVENING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["note", "because", "tomorrow", "memory"],
  properties: {
    note: { type: "string" },
    because: { type: "string" },
    tomorrow: {
      type: "array",
      minItems: 1,
      maxItems: MAX_DRAFT_TASKS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
    },
    memory: { type: "string" },
  },
};

const RESULTS = new Set(["easy", "good", "hard", "missed"]);

// Lengths are whole characters (code points), matching the app, so an emoji
// near a limit can't get a request rejected.
function charLength(value) {
  return Array.from(value).length;
}

function isShortString(value, max) {
  return typeof value === "string" && charLength(value) <= max;
}

export function validateEveningPayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  if (!RESULTS.has(payload.result)) return "result must be easy, good, hard or missed";
  if (!Array.isArray(payload.tasks) || payload.tasks.length > 3) return "tasks must be 0-3 items";
  for (const task of payload.tasks) {
    if (!task || typeof task !== "object") return "Invalid task";
    if (!isShortString(task.text, 120) || !task.text.trim()) return "Invalid task text";
    if (typeof task.done !== "boolean") return "Invalid task done";
  }
  // note and memory are shortened (not rejected) when long: see buildEveningPrompt.
  if (payload.note !== undefined && payload.note !== null && !isShortString(payload.note, 2000)) {
    return "Invalid note";
  }
  if (payload.goalTitle !== undefined && payload.goalTitle !== null && !isShortString(payload.goalTitle, 120)) {
    return "Invalid goalTitle";
  }
  if (payload.memory !== undefined && payload.memory !== null && !isShortString(payload.memory, 2000)) {
    return "Invalid memory";
  }
  return null;
}

export function buildEveningPrompt(payload) {
  const tasks =
    payload.tasks.length > 0
      ? payload.tasks.map((task) => `- ${task.text.trim()} (${task.done ? "done" : "not done"})`).join("\n")
      : "- (no tasks were picked today)";
  return [
    payload.goalTitle ? `Their bigger goal: ${payload.goalTitle}` : "No specific goal set.",
    `How today felt: ${payload.result}`,
    `Today's tasks:\n${tasks}`,
    `Their note about today: ${payload.note?.trim() ? shorten(payload.note, 500) : "none"}`,
    `What you remember about them so far: ${payload.memory?.trim() ? shorten(payload.memory, MAX_MEMORY) : "nothing yet"}`,
    "Write the note, tomorrow's draft (at most three tasks, 64 characters each), the because line, and the updated memory.",
    "If the day was hard or missed, draft fewer or smaller tasks; one is fine.",
    "Never list in the note what they didn't do.",
    "Only draft tasks related to today's tasks or their goal.",
  ].join("\n");
}

/** Shorten (never drop) over-long text, counting whole characters. */
function shorten(text, max) {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

export function isValidEvening(result) {
  return Boolean(
    result &&
      typeof result === "object" &&
      typeof result.note === "string" &&
      result.note.trim() &&
      typeof result.because === "string" &&
      typeof result.memory === "string" &&
      Array.isArray(result.tomorrow) &&
      result.tomorrow.some(
        (item) => item && typeof item.text === "string" && item.text.trim() && item.text.length <= 200,
      ),
  );
}

/** Rebuild the response from validated fields only, with length caps. */
export function sanitizeEvening(result) {
  const seen = new Set();
  const tomorrow = [];
  for (const item of result.tomorrow) {
    if (tomorrow.length >= MAX_DRAFT_TASKS) break;
    if (!item || typeof item.text !== "string" || !item.text.trim() || item.text.length > 200) continue;
    const text = shorten(item.text, MAX_DRAFT_TASK);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tomorrow.push({ text });
  }
  return {
    note: shorten(result.note, MAX_EVENING_NOTE),
    because: shorten(result.because, MAX_BECAUSE),
    tomorrow,
    memory: shorten(result.memory, MAX_MEMORY),
  };
}
