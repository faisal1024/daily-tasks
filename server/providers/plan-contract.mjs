// Shared, provider-independent contract for the Momentum plan endpoint.
//
// Everything in this file is the same no matter which AI backend is used.
// Provider adapters (openai.mjs, anthropic.mjs, ...) consume SYSTEM_PROMPT,
// buildPrompt(), and RESPONSE_SCHEMA and return an object matching the schema.

export const SYSTEM_PROMPT =
  "You generate calm, concrete daily momentum plans. Never create a backlog. " +
  "Never use shame, guilt, urgency, streak pressure, medical advice, financial " +
  "advice, or unsafe instructions. Keep every task achievable today.";

export function generatedTaskSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "text", "estimatedMinutes", "difficulty", "reason", "source"],
    properties: {
      id: { type: "string" },
      text: { type: "string" },
      estimatedMinutes: { type: "integer", minimum: 5, maximum: 60 },
      difficulty: { type: "string", enum: ["easy", "medium", "stretch"] },
      reason: { type: "string" },
      source: { type: "string", enum: ["ai"] },
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
        required: ["id", "title", "description", "completedAt"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          completedAt: { type: ["string", "null"] },
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

export function buildPrompt(payload) {
  return [
    "Create a Momentum plan for a daily app limited to exactly three tasks per day.",
    `Goal: ${payload.profile.goalTitle}`,
    `Time available: ${payload.profile.timeAvailability}`,
    `Experience level: ${payload.profile.experienceLevel}`,
    `Main struggle: ${payload.profile.struggleType}`,
    `Suggestion tone: ${payload.settings.suggestionTone}`,
    `Adaptive planning enabled: ${payload.settings.adaptivePlanning}`,
    `Recent completion: ${payload.recentPerformance.completed}/${payload.recentPerformance.total} tasks across ${payload.recentPerformance.daysReviewed} active days`,
    `Recent missed tasks: ${payload.recentPerformance.missed}`,
    `Recent reflection: ${payload.recentReflection ?? "none"}`,
    `Recent reflection result: ${payload.recentReflectionResult ?? "none"}`,
    "Return three milestones and exactly three todaySuggestions.",
    "Tasks must be short verb phrases, 64 characters or fewer, specific enough to do today, and sized to the user's time.",
    "If recent completion is weak, make tasks easier. If recent completion is strong, make tasks a gentle step up.",
  ].join("\n");
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  const { profile, settings, recentPerformance } = payload;
  if (!profile || typeof profile.goalTitle !== "string") return "Missing profile";
  if (!settings || typeof settings.suggestionTone !== "string") return "Missing settings";
  if (!recentPerformance || typeof recentPerformance.completed !== "number") {
    return "Missing recent performance";
  }
  return null;
}

/** Lightweight shape check on a provider's returned plan before sending it on. */
export function isValidPlan(plan) {
  return Boolean(
    plan &&
      typeof plan === "object" &&
      Array.isArray(plan.milestones) &&
      Array.isArray(plan.todaySuggestions) &&
      Array.isArray(plan.taskPool),
  );
}
