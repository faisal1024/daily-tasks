import AsyncStorage from "@react-native-async-storage/async-storage";

import { todayKey } from "./date";
import { DEFAULT_JOURNEY, type Journey } from "./journey";
import type {
  AppState,
  AutoLockConfig,
  DayRecord,
  DayTaskRecord,
  GeneratedTask,
  MomentumMilestone,
  MomentumPlan,
  MomentumProfile,
  MomentumSettings,
  NotificationConfig,
  PendingRollover,
  ReflectionResult,
  Task,
} from "./types";
import {
  DEFAULT_AUTO_LOCK,
  DEFAULT_MOMENTUM_PROFILE,
  DEFAULT_MOMENTUM_SETTINGS,
  DEFAULT_NOTIFICATIONS,
} from "./types";

const STORAGE_KEY = "daily-tasks/state/v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeDayTaskRecord(value: unknown): DayTaskRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") {
    return null;
  }

  return {
    id: value.id,
    text: value.text,
    completed: typeof value.completed === "boolean" ? value.completed : false,
    carriedOver: typeof value.carriedOver === "boolean" ? value.carriedOver : false,
    rolloverOutcome:
      value.rolloverOutcome === "carried" ||
      value.rolloverOutcome === "dropped" ||
      value.rolloverOutcome === "unresolved"
        ? value.rolloverOutcome
        : null,
  };
}

function normalizeDayRecord(date: string, value: unknown): DayRecord | null {
  if (!isRecord(value)) return null;

  const tasks = Array.isArray(value.tasks)
    ? value.tasks
        .map((task) => normalizeDayTaskRecord(task))
        .filter((task): task is DayTaskRecord => task !== null)
    : [];

  return {
    date,
    total: typeof value.total === "number" ? value.total : tasks.length,
    completed:
      typeof value.completed === "number"
        ? value.completed
        : tasks.filter((task) => task.completed).length,
    locked: typeof value.locked === "boolean" ? value.locked : false,
    lockSource:
      value.lockSource === "manual" || value.lockSource === "auto" ? value.lockSource : null,
    tasks,
    reflection: typeof value.reflection === "string" ? value.reflection : null,
    reflectionResult: normalizeReflectionResult(value.reflectionResult),
  };
}

function normalizeHistory(value: unknown): AppState["history"] {
  if (!isRecord(value)) return {};

  const history: AppState["history"] = {};
  for (const [date, record] of Object.entries(value)) {
    const normalized = normalizeDayRecord(date, record);
    if (normalized) {
      history[date] = normalized;
    }
  }
  return history;
}

function normalizePendingRollover(value: unknown): PendingRollover | null {
  if (!isRecord(value) || typeof value.sourceDate !== "string" || !Array.isArray(value.tasks)) {
    return null;
  }

  const tasks = value.tasks
    .map((task) => normalizeDayTaskRecord(task))
    .filter((task): task is DayTaskRecord => task !== null);

  if (tasks.length === 0) return null;

  return {
    sourceDate: value.sourceDate,
    tasks,
  };
}

function getLegacySlotEnabled(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.enabled === "boolean" ? value.enabled : undefined;
}

function normalizeNotifications(value: unknown): NotificationConfig {
  if (!isRecord(value)) {
    return DEFAULT_NOTIFICATIONS;
  }

  const hasModernShape =
    typeof value.enabled === "boolean" ||
    typeof value.morning === "boolean" ||
    typeof value.progress === "boolean" ||
    typeof value.evening === "boolean";

  if (hasModernShape) {
    return {
      enabled:
        typeof value.enabled === "boolean" ? value.enabled : DEFAULT_NOTIFICATIONS.enabled,
      morning:
        typeof value.morning === "boolean" ? value.morning : DEFAULT_NOTIFICATIONS.morning,
      progress:
        typeof value.progress === "boolean" ? value.progress : DEFAULT_NOTIFICATIONS.progress,
      evening:
        typeof value.evening === "boolean" ? value.evening : DEFAULT_NOTIFICATIONS.evening,
    };
  }

  const morning = getLegacySlotEnabled(value.morning);
  const evening = getLegacySlotEnabled(value.evening);
  const night = getLegacySlotEnabled(value.night);
  const legacyValues = [morning, evening, night].filter(
    (slot): slot is boolean => typeof slot === "boolean",
  );

  return {
    enabled: legacyValues.length > 0 ? legacyValues.some(Boolean) : DEFAULT_NOTIFICATIONS.enabled,
    morning: morning ?? DEFAULT_NOTIFICATIONS.morning,
    progress: DEFAULT_NOTIFICATIONS.progress,
    evening:
      legacyValues.length > 0
        ? Boolean((evening ?? false) || (night ?? false))
        : DEFAULT_NOTIFICATIONS.evening,
  };
}

function normalizeHour(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : DEFAULT_AUTO_LOCK.hour;
}

function normalizeMinute(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 59
    ? value
    : DEFAULT_AUTO_LOCK.minute;
}

function normalizeAutoLock(value: unknown): AutoLockConfig {
  if (!isRecord(value)) {
    return DEFAULT_AUTO_LOCK;
  }

  return {
    enabled:
      typeof value.enabled === "boolean" ? value.enabled : DEFAULT_AUTO_LOCK.enabled,
    hour: normalizeHour(value.hour),
    minute: normalizeMinute(value.minute),
  };
}

function normalizeMomentumProfile(value: unknown): MomentumProfile {
  if (!isRecord(value)) {
    return DEFAULT_MOMENTUM_PROFILE;
  }

  return {
    goalTitle: typeof value.goalTitle === "string" ? value.goalTitle : null,
    goalSource:
      value.goalSource === "suggested" || value.goalSource === "custom"
        ? value.goalSource
        : null,
    timeAvailability:
      value.timeAvailability === "15_min" ||
      value.timeAvailability === "30_min" ||
      value.timeAvailability === "60_min"
        ? value.timeAvailability
        : null,
    experienceLevel:
      value.experienceLevel === "beginner" ||
      value.experienceLevel === "intermediate" ||
      value.experienceLevel === "advanced"
        ? value.experienceLevel
        : null,
    struggleType:
      value.struggleType === "overwhelm" ||
      value.struggleType === "consistency" ||
      value.struggleType === "motivation" ||
      value.struggleType === "time"
        ? value.struggleType
        : null,
    onboardingCompletedAt:
      typeof value.onboardingCompletedAt === "string" ? value.onboardingCompletedAt : null,
  };
}

function normalizeGeneratedTask(value: unknown): GeneratedTask | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") {
    return null;
  }

  return {
    id: value.id,
    text: value.text,
    estimatedMinutes:
      typeof value.estimatedMinutes === "number" ? value.estimatedMinutes : 15,
    difficulty:
      value.difficulty === "easy" ||
      value.difficulty === "medium" ||
      value.difficulty === "stretch"
        ? value.difficulty
        : "easy",
    reason: typeof value.reason === "string" ? value.reason : "Suggested for today.",
    source: value.source === "ai" || value.source === "template" ? value.source : "template",
  };
}

function normalizeMilestone(value: unknown): MomentumMilestone | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    description: typeof value.description === "string" ? value.description : "",
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
  };
}

function normalizeReflectionResult(value: unknown): ReflectionResult | null {
  return value === "easy" || value === "good" || value === "hard" || value === "missed"
    ? value
    : null;
}

function normalizeAdaptationSnapshot(value: unknown): AppState["adaptationSnapshot"] {
  if (!isRecord(value) || typeof value.date !== "string") return null;

  return {
    date: value.date,
    completionRate:
      typeof value.completionRate === "number" ? value.completionRate : 0,
    missedCount: typeof value.missedCount === "number" ? value.missedCount : 0,
    recommendation:
      value.recommendation === "simplify" ||
      value.recommendation === "maintain" ||
      value.recommendation === "increase"
        ? value.recommendation
        : "maintain",
    reason: typeof value.reason === "string" ? value.reason : "Momentum is staying steady.",
  };
}

function normalizeMomentumPlan(value: unknown): MomentumPlan | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.goalTitle !== "string" ||
    typeof value.generatedAt !== "string"
  ) {
    return null;
  }

  const taskPool = Array.isArray(value.taskPool)
    ? value.taskPool
        .map((task) => normalizeGeneratedTask(task))
        .filter((task): task is GeneratedTask => task !== null)
    : [];
  const todaySuggestions = Array.isArray(value.todaySuggestions)
    ? value.todaySuggestions
        .map((task) => normalizeGeneratedTask(task))
        .filter((task): task is GeneratedTask => task !== null)
    : taskPool.slice(0, 3);
  const milestones = Array.isArray(value.milestones)
    ? value.milestones
        .map((milestone) => normalizeMilestone(milestone))
        .filter((milestone): milestone is MomentumMilestone => milestone !== null)
    : [];

  return {
    id: value.id,
    goalTitle: value.goalTitle,
    generatedAt: value.generatedAt,
    provider: value.provider === "ai" || value.provider === "template" ? value.provider : "template",
    milestones,
    taskPool,
    todaySuggestions: todaySuggestions.slice(0, 3),
    promptSummary: typeof value.promptSummary === "string" ? value.promptSummary : "",
    version: typeof value.version === "number" ? value.version : 1,
  };
}

function normalizeMomentumSettings(value: unknown): MomentumSettings {
  if (!isRecord(value)) {
    return DEFAULT_MOMENTUM_SETTINGS;
  }

  return {
    adaptivePlanning:
      typeof value.adaptivePlanning === "boolean"
        ? value.adaptivePlanning
        : DEFAULT_MOMENTUM_SETTINGS.adaptivePlanning,
    eveningReflection:
      typeof value.eveningReflection === "boolean"
        ? value.eveningReflection
        : DEFAULT_MOMENTUM_SETTINGS.eveningReflection,
    suggestionTone:
      value.suggestionTone === "calm" ||
      value.suggestionTone === "friendly" ||
      value.suggestionTone === "direct"
        ? value.suggestionTone
        : DEFAULT_MOMENTUM_SETTINGS.suggestionTone,
  };
}

function normalizeJourney(value: unknown): Journey {
  if (!isRecord(value)) return DEFAULT_JOURNEY;

  const num = (input: unknown, fallback: number): number =>
    typeof input === "number" && Number.isFinite(input) ? input : fallback;

  return {
    xp: Math.max(0, num(value.xp, DEFAULT_JOURNEY.xp)),
    showedUpStreak: Math.max(0, num(value.showedUpStreak, DEFAULT_JOURNEY.showedUpStreak)),
    longestShowedUpStreak: Math.max(
      0,
      num(value.longestShowedUpStreak, DEFAULT_JOURNEY.longestShowedUpStreak),
    ),
    showedUpFreezes: Math.max(0, num(value.showedUpFreezes, DEFAULT_JOURNEY.showedUpFreezes)),
    lastShowedUpDate:
      typeof value.lastShowedUpDate === "string" ? value.lastShowedUpDate : null,
    lastCelebratedLevel: Math.max(
      1,
      num(value.lastCelebratedLevel, DEFAULT_JOURNEY.lastCelebratedLevel),
    ),
    awardDate: typeof value.awardDate === "string" ? value.awardDate : null,
    awardedTaskIds: Array.isArray(value.awardedTaskIds)
      ? value.awardedTaskIds.filter((id): id is string => typeof id === "string")
      : [],
    perfectAwarded: typeof value.perfectAwarded === "boolean" ? value.perfectAwarded : false,
    selectedCosmeticId:
      typeof value.selectedCosmeticId === "string"
        ? value.selectedCosmeticId
        : DEFAULT_JOURNEY.selectedCosmeticId,
  };
}

function normalizeState(value: unknown): AppState | null {
  if (!isRecord(value)) return null;

  return {
    tasks: Array.isArray(value.tasks) ? (value.tasks as Task[]) : [],
    todayCompletions: Array.isArray(value.todayCompletions)
      ? value.todayCompletions.filter((id): id is string => typeof id === "string")
      : [],
    lastOpenedDate:
      typeof value.lastOpenedDate === "string" ? value.lastOpenedDate : todayKey(),
    todayLocked: typeof value.todayLocked === "boolean" ? value.todayLocked : false,
    todayLockSource:
      value.todayLockSource === "manual" || value.todayLockSource === "auto"
        ? value.todayLockSource
        : null,
    autoLockNoticeDate:
      typeof value.autoLockNoticeDate === "string" ? value.autoLockNoticeDate : null,
    pendingRollover: normalizePendingRollover(value.pendingRollover),
    history: normalizeHistory(value.history),
    notifications: normalizeNotifications(value.notifications),
    autoLock: normalizeAutoLock(value.autoLock),
    // Existing users (any stored state) have already used the app — skip onboarding.
    hasSeenOnboarding:
      typeof value.hasSeenOnboarding === "boolean" ? value.hasSeenOnboarding : true,
    todayReflection:
      typeof value.todayReflection === "string" ? value.todayReflection : null,
    todayReflectionResult: normalizeReflectionResult(value.todayReflectionResult),
    momentumProfile: normalizeMomentumProfile(value.momentumProfile),
    momentumPlan: normalizeMomentumPlan(value.momentumPlan),
    momentumSettings: normalizeMomentumSettings(value.momentumSettings),
    momentumPlanStatus:
      value.momentumPlanStatus === "loading" ||
      value.momentumPlanStatus === "ready" ||
      value.momentumPlanStatus === "error"
        ? value.momentumPlanStatus
        : normalizeMomentumPlan(value.momentumPlan)
          ? "ready"
          : "idle",
    momentumPlanError:
      typeof value.momentumPlanError === "string" ? value.momentumPlanError : null,
    adaptationSnapshot: normalizeAdaptationSnapshot(value.adaptationSnapshot),
    journey: normalizeJourney(value.journey),
  };
}

export function makeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildInitialState(now: Date = new Date()): AppState {
  const today = todayKey(now);
  const tasks: Task[] = [];
  return {
    tasks,
    todayCompletions: [],
    lastOpenedDate: today,
    todayLocked: false,
    todayLockSource: null,
    autoLockNoticeDate: null,
    pendingRollover: null,
    history: {
      [today]: {
        date: today,
        total: 0,
        completed: 0,
        locked: false,
        lockSource: null,
        tasks: [],
        reflection: null,
        reflectionResult: null,
      },
    },
    notifications: DEFAULT_NOTIFICATIONS,
    autoLock: DEFAULT_AUTO_LOCK,
    hasSeenOnboarding: false,
    todayReflection: null,
    todayReflectionResult: null,
    momentumProfile: DEFAULT_MOMENTUM_PROFILE,
    momentumPlan: null,
    momentumSettings: DEFAULT_MOMENTUM_SETTINGS,
    momentumPlanStatus: "idle",
    momentumPlanError: null,
    adaptationSnapshot: null,
    journey: DEFAULT_JOURNEY,
  };
}

export async function loadState(): Promise<AppState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    console.warn("[daily-tasks] failed to load state", err);
    return null;
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[daily-tasks] failed to save state", err);
  }
}

export async function clearState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("[daily-tasks] failed to clear state", err);
  }
}
