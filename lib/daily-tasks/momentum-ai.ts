import {
  buildMomentumPlan,
  summarizeRecentPerformance,
  summarizeRecentTasks,
  validateGeneratedTasks,
  type RecentTask,
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
    motivation: MomentumProfile["motivation"];
    preferredTime: MomentumProfile["preferredTime"];
    cadence: MomentumProfile["cadence"];
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
  recentReflectionResult: string | null;
  recentTasks: RecentTask[];
}

export function getMomentumAiProxyUrl(): string | null {
  return process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL ?? null;
}

export type MomentumPlanStatus = "idle" | "loading" | "ready" | "error";

/**
 * Decide the dedupe key for an automatic AI plan fetch, or null if the app
 * should not auto-fetch right now (not ready, no proxy configured, profile
 * incomplete, a fetch is in flight, or this day+goal was already fetched).
 * Pure + testable; the store effect just acts on the result.
 */
export function nextAiPlanFetchKey(params: {
  ready: boolean;
  proxyUrl: string | null;
  profileComplete: boolean;
  status: MomentumPlanStatus;
  today: string;
  goalTitle: string | null;
  lastFetchedKey: string | null;
}): string | null {
  if (!params.ready) return null;
  if (!params.proxyUrl) return null;
  if (!params.profileComplete) return null;
  if (params.status === "loading") return null;
  const key = `${params.today}:${params.goalTitle ?? ""}`;
  return key === params.lastFetchedKey ? null : key;
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
      motivation: profile.motivation,
      preferredTime: profile.preferredTime,
      cadence: profile.cadence,
    },
    settings,
    recentPerformance: summarizeRecentPerformance(history, now),
    recentReflection: latestReflection(history, now),
    recentReflectionResult: latestReflectionResult(history, now),
    recentTasks: summarizeRecentTasks(history, now),
  };
}

export async function requestMomentumAiPlan({
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

function latestReflectionResult(history: History, now: Date): string | null {
  const today = dateKey(now);
  const record = Object.values(history)
    .filter((day) => day.date < today && day.reflectionResult)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return record?.reflectionResult ?? null;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
