import {
  buildMomentumPlan,
  summarizeRecentPerformance,
  validateGeneratedTasks,
} from "./momentum";
import type {
  GeneratedTask,
  History,
  MomentumMilestone,
  MomentumPlan,
  MomentumProfile,
  MomentumSettings,
} from "./types";

interface ProxyResponse {
  milestones: MomentumMilestone[];
  todaySuggestions: GeneratedTask[];
  taskPool?: GeneratedTask[];
}

export interface AiPlanRequestPayload {
  profile: {
    goalTitle: string;
    timeAvailability: MomentumProfile["timeAvailability"];
    experienceLevel: MomentumProfile["experienceLevel"];
    struggleType: MomentumProfile["struggleType"];
  };
  settings: MomentumSettings;
  recentPerformance: {
    daysReviewed: number;
    completed: number;
    total: number;
    missed: number;
    completionRate: number;
  };
  recentReflection: string | null;
}

export function getMomentumAiProxyUrl(): string | null {
  return process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL ?? null;
}

export function buildAiPlanRequestPayload({
  profile,
  history,
  settings,
  now = new Date(),
}: {
  profile: MomentumProfile;
  history: History;
  settings: MomentumSettings;
  now?: Date;
}): AiPlanRequestPayload | null {
  if (
    !profile.goalTitle ||
    !profile.timeAvailability ||
    !profile.experienceLevel ||
    !profile.struggleType
  ) {
    return null;
  }

  return {
    profile: {
      goalTitle: profile.goalTitle,
      timeAvailability: profile.timeAvailability,
      experienceLevel: profile.experienceLevel,
      struggleType: profile.struggleType,
    },
    settings,
    recentPerformance: summarizeRecentPerformance(history, now),
    recentReflection: latestReflection(history, now),
  };
}

export async function requestOpenAiMomentumPlan({
  profile,
  history,
  settings,
  proxyUrl = getMomentumAiProxyUrl(),
  now = new Date(),
}: {
  profile: MomentumProfile;
  history: History;
  settings: MomentumSettings;
  proxyUrl?: string | null;
  now?: Date;
}): Promise<MomentumPlan> {
  if (!proxyUrl) {
    throw new Error("Momentum AI proxy URL is not configured.");
  }

  const payload = buildAiPlanRequestPayload({ profile, history, settings, now });
  if (!payload) {
    throw new Error("Momentum profile is incomplete.");
  }

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Momentum AI request failed with ${response.status}.`);
  }

  const data = (await response.json()) as ProxyResponse;
  const todaySuggestions = validateGeneratedTasks(data.todaySuggestions ?? []);
  if (todaySuggestions.length !== 3) {
    throw new Error("Momentum AI returned an invalid daily plan.");
  }

  const generatedAt = now.toISOString();
  return {
    id: `plan_ai_${generatedAt}`,
    goalTitle: payload.profile.goalTitle,
    generatedAt,
    provider: "ai",
    milestones: data.milestones.slice(0, 3),
    taskPool: validateGeneratedTasks(data.taskPool ?? data.todaySuggestions ?? []),
    todaySuggestions,
    promptSummary: [
      `Goal: ${payload.profile.goalTitle}`,
      `Time: ${payload.profile.timeAvailability}`,
      `Experience: ${payload.profile.experienceLevel}`,
      `Struggle: ${payload.profile.struggleType}`,
      `Recent: ${payload.recentPerformance.completed}/${payload.recentPerformance.total}`,
    ].join(" | "),
    version: 1,
  };
}

export function buildFallbackMomentumPlan({
  profile,
  history,
  settings,
  now = new Date(),
}: {
  profile: MomentumProfile;
  history: History;
  settings: MomentumSettings;
  now?: Date;
}): MomentumPlan | null {
  return buildMomentumPlan({ profile, history, settings, now });
}

function latestReflection(history: History, now: Date): string | null {
  const today = dateKey(now);
  const record = Object.values(history)
    .filter((day) => day.date < today && day.reflection)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return record?.reflection ?? null;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
