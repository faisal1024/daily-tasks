// Shared, provider-independent contract for the Momentum plan endpoint.
//
// Everything in this file is the same no matter which AI backend is used.
// Provider adapters (openai.mjs, anthropic.mjs, ...) consume SYSTEM_PROMPT,
// buildPrompt(), and RESPONSE_SCHEMA and return an object matching the schema.

import { agendaPromptLines, isValidAgenda } from "./agenda.mjs";
export const SYSTEM_PROMPT =
  "You generate calm, concrete daily momentum plans. Never create a backlog. " +
  "Never use shame, guilt, urgency, streak pressure, medical advice, financial " +
  "advice, or unsafe instructions. Keep every task achievable today.";

export function generatedTaskSchema() {
  return {
    type: "object",
    additionalProperties: false,
    // Only what the app reads: it assigns ids and the source itself.
    required: ["text", "estimatedMinutes", "difficulty", "reason"],
    properties: {
      text: { type: "string" },
      estimatedMinutes: { type: "integer", minimum: 5, maximum: 60 },
      difficulty: { type: "string", enum: ["easy", "medium", "stretch"] },
      reason: { type: "string" },
    },
  };
}

export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["milestones", "todaySuggestions", "taskPool"],
  properties: {
    milestones: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        // The app gives milestones stable ids and owns completion.
        required: ["title", "description"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    todaySuggestions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: generatedTaskSchema(),
    },
    taskPool: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: generatedTaskSchema(),
    },
  },
};

/** Name used for structured-output tools / schema labels. */
export const PLAN_TOOL_NAME = "emit_momentum_plan";
export const PLAN_TOOL_DESCRIPTION =
  "Return the structured Momentum plan: three milestones, exactly three " +
  "todaySuggestions, and a task pool. Call this tool with the plan as input.";

// One short example per tone, so "calm" / "friendly" / "direct" read differently.
// Voice only: the activity in the example is never meant to be reused.
const TONE_EXAMPLES = {
  calm: 'voice only, e.g. "Sketch the outline for section one", reason "A small, steady start is enough today."',
  friendly: 'voice only, e.g. "Knock out the outline for section one", reason "Nice quick win to get rolling!"',
  direct: 'voice only, e.g. "Outline section one.", reason "Unblocks the rest."',
};
export const TONES = Object.keys(TONE_EXAMPLES);

export function toneExample(tone) {
  return Object.prototype.hasOwnProperty.call(TONE_EXAMPLES, tone) ? TONE_EXAMPLES[tone] : TONE_EXAMPLES.calm;
}

export function buildPrompt(payload) {
  return [
    "Create a Momentum plan for a daily app limited to exactly three tasks per day.",
    `Goal: ${payload.profile.goalTitle}`,
    `Time available: ${payload.profile.timeAvailability}`,
    `Experience level: ${payload.profile.experienceLevel}`,
    `Main struggle: ${payload.profile.struggleType}`,
    `Why it matters to them: ${payload.profile.motivation ?? "not shared"}`,
    `Best time of day: ${payload.profile.preferredTime ?? "any"}`,
    `Commitment cadence: ${payload.profile.cadence ?? "flexible"}`,
    `Suggestion tone: ${payload.settings.suggestionTone} (${toneExample(payload.settings.suggestionTone)})`,
    "The tone example shows voice only; never reuse its activity. Tasks must come from the goal and recent tasks.",
    `Adaptive planning enabled: ${payload.settings.adaptivePlanning}`,
    `Recent completion: ${payload.recentPerformance.completed}/${payload.recentPerformance.total} tasks across ${payload.recentPerformance.daysReviewed} active days`,
    `Recent missed tasks: ${payload.recentPerformance.missed}`,
    `Recent reflection: ${payload.recentReflection ?? "none"}`,
    `Recent reflection result: ${payload.recentReflectionResult ?? "none"}`,
    formatRecentTasks(payload.recentTasks),
    `What you remember about them: ${
      typeof payload.coachMemory === "string" && payload.coachMemory.trim()
        ? payload.coachMemory.trim().slice(0, 500)
        : "nothing yet"
    }`,
    ...agendaPromptLines(payload.agenda),
    "Return three milestones and exactly three todaySuggestions.",
    "Tasks must be short verb phrases, 64 characters or fewer, specific enough to do today, and sized to the user's time.",
    "If recent completion is weak, make tasks easier. If recent completion is strong, make tasks a gentle step up.",
    "Build on the user's own recent tasks: lean toward the kinds of tasks they actually completed, and gently reshape or replace ones they repeatedly skipped. Do not just repeat their exact tasks.",
  ].join("\n");
}

function formatRecentTasks(recentTasks) {
  if (!Array.isArray(recentTasks) || recentTasks.length === 0) {
    return "Recent tasks the user chose: none yet";
  }
  const lines = recentTasks
    .slice(0, 12)
    .map((task) => `- ${task.text} (${task.completed ? "done" : "skipped"})`)
    .join("\n");
  return `Recent tasks the user chose (newest first):\n${lines}`;
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  const { profile, settings, recentPerformance } = payload;
  if (!profile || typeof profile.goalTitle !== "string") return "Missing profile";
  if (!settings || typeof settings.suggestionTone !== "string") return "Missing settings";
  if (!TONES.includes(settings.suggestionTone)) return "Invalid settings";
  if (!recentPerformance || typeof recentPerformance.completed !== "number") {
    return "Missing recent performance";
  }
  if (!isValidAgenda(payload.agenda)) return "Invalid agenda";
  return null;
}

const str = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
function cleanTask(task) {
  return {
    text: str(task?.text, 200),
    estimatedMinutes: task?.estimatedMinutes,
    difficulty: str(task?.difficulty, 16),
    reason: str(task?.reason, 300),
  };
}

/** Rebuild the plan from the fields the app reads (never raw model output). */
export function sanitizePlan(plan) {
  return {
    milestones: (Array.isArray(plan?.milestones) ? plan.milestones : [])
      .slice(0, 3)
      .map((m) => ({ title: str(m?.title, 120), description: str(m?.description, 300) })),
    todaySuggestions: (Array.isArray(plan?.todaySuggestions) ? plan.todaySuggestions : []).slice(0, 3).map(cleanTask),
    taskPool: (Array.isArray(plan?.taskPool) ? plan.taskPool : []).slice(0, 6).map(cleanTask),
  };
}

/** Lightweight shape check on a provider's returned plan before sending it on. */
export function isValidPlan(plan) {
  return Boolean(
    plan &&
      typeof plan === "object" &&
      Array.isArray(plan.milestones) &&
      Array.isArray(plan.todaySuggestions) &&
      Array.isArray(plan.taskPool) &&
      // At least one suggestion the app will accept, or it has nothing to show.
      plan.todaySuggestions.some(isUsableSuggestion),
  );
}

/**
 * Mirrors the app's validateGeneratedTasks (lib/daily-tasks/momentum.ts) so the
 * proxy never returns 200 for a plan the client will reject.
 */
export function isUsableSuggestion(task) {
  if (!task || typeof task !== "object" || typeof task.text !== "string") return false;
  const text = task.text.trim();
  const minutes = task.estimatedMinutes;
  return (
    text.length > 0 &&
    text.length <= 64 &&
    Number.isInteger(minutes) &&
    minutes >= 5 &&
    minutes <= 60
  );
}
