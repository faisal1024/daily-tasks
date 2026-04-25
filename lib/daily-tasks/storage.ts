import AsyncStorage from "@react-native-async-storage/async-storage";

import { todayKey } from "./date";
import type {
  AppState,
  DayRecord,
  DayTaskRecord,
  NotificationConfig,
  PendingRollover,
  Task,
} from "./types";
import {
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
    // Existing users (any stored state) have already used the app — skip onboarding.
    hasSeenOnboarding:
      typeof value.hasSeenOnboarding === "boolean" ? value.hasSeenOnboarding : true,
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
      },
    },
    notifications: DEFAULT_NOTIFICATIONS,
    hasSeenOnboarding: false,
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
