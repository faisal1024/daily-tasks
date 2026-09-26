import {
  AI_REQUEST_TIMEOUT_MS,
  PROXY_SECRET_HEADER,
  getMomentumAiProxyUrl,
  getMomentumProxySecret,
  postToProxy,
} from "./ai-client";
import { MomentumAiError } from "./ai-status";

import {
  MILESTONE_IDS,
  buildMilestones,
  buildMomentumPlan,
  summarizeRecentPerformance,
  summarizeRecentTasks,
  validateGeneratedTasks,
  type RecentTask,
} from "./momentum";
import type {
  History,
  MomentumMilestone,
  MomentumPlan,
  MomentumProfile,
  MomentumSettings,
} from "./types";

// Re-exported for existing callers.
export { AI_REQUEST_TIMEOUT_MS, PROXY_SECRET_HEADER, getMomentumAiProxyUrl, getMomentumProxySecret };

interface ProxyResponse {
  milestones?: unknown;
  todaySuggestions?: unknown;
  taskPool?: unknown;
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

/**
 * AI milestones get the same positional ids as template milestones
 * (MILESTONE_IDS) regardless of what the model sends: completion is tracked by
 * id in completedMilestoneIds across daily plan refreshes, whichever source
 * built the plan, so ids must stay stable. completedAt
 * is never taken from the model (a hallucinated timestamp would mark a
 * milestone done); completion is owned by the app.
 */
function normalizeMilestones(value: unknown): MomentumMilestone[] {
  if (!Array.isArray(value)) return [];
  const milestones: MomentumMilestone[] = [];
  for (const item of value) {
    if (milestones.length >= MILESTONE_IDS.length) break;
    if (!item || typeof item !== "object") continue;
    const m = item as Partial<MomentumMilestone>;
    if (typeof m.title !== "string" || !m.title.trim()) continue;
    milestones.push({
      id: MILESTONE_IDS[milestones.length],
      title: m.title.trim().slice(0, 80),
      description: typeof m.description === "string" ? m.description.trim().slice(0, 200) : "",
      completedAt: null,
    });
  }
  return milestones;
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
  /** Today's AI plan for this goal is already in hand (e.g. restored on launch). */
  hasFreshAiPlan?: boolean;
}): string | null {
  if (!params.ready) return null;
  if (!params.proxyUrl) return null;
  if (!params.profileComplete) return null;
  if (params.status === "loading") return null;
  if (params.hasFreshAiPlan) return null;
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
  proxySecret = getMomentumProxySecret(),
  now = new Date(),
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
}: {
  profile: MomentumProfile;
  history: History;
  settings: MomentumSettings;
  proxyUrl?: string | null;
  proxySecret?: string | null;
  now?: Date;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<MomentumPlan> {
  if (!proxyUrl) {
    throw new Error("Momentum AI proxy URL is not configured.");
  }

  const payload = buildAiPlanRequestPayload({ profile, history, settings, now });
  if (!payload) {
    throw new Error("Momentum profile is incomplete.");
  }

  const data = (await postToProxy({
    url: proxyUrl,
    payload,
    proxySecret,
    timeoutMs,
    fetchImpl,
  })) as ProxyResponse;

  // Accept 1–3 usable suggestions: a model occasionally returns fewer than asked,
  // and a short list is better than falling back to templates.
  const todaySuggestions = validateGeneratedTasks(data.todaySuggestions, "ai_today");
  if (todaySuggestions.length === 0) {
    throw new MomentumAiError("invalid_response", "Momentum AI returned an invalid daily plan.");
  }

  const aiMilestones = normalizeMilestones(data.milestones);
  const generatedAt = now.toISOString();
  return {
    id: `plan_ai_${generatedAt}`,
    goalTitle: payload.profile.goalTitle,
    generatedAt,
    provider: "ai",
    milestones: aiMilestones.length > 0 ? aiMilestones : buildMilestones(payload.profile.goalTitle),
    taskPool: validateGeneratedTasks(data.taskPool ?? data.todaySuggestions, "ai_pool"),
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
