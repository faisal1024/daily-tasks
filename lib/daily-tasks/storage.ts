import AsyncStorage from "@react-native-async-storage/async-storage";

import { todayKey } from "./date";
import type { AppState, Task } from "./types";
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_TASKS,
} from "./types";

const STORAGE_KEY = "daily-tasks/state/v1";

export function makeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildInitialState(now: Date = new Date()): AppState {
  const today = todayKey(now);
  const tasks: Task[] = DEFAULT_TASKS.map((t) => ({
    id: makeId(),
    text: t.text,
    createdAt: now.toISOString(),
    carriedOver: false,
  }));
  return {
    tasks,
    todayCompletions: [],
    lastOpenedDate: today,
    history: { [today]: { date: today, total: tasks.length, completed: 0 } },
    notifications: DEFAULT_NOTIFICATIONS,
  };
}

export async function loadState(): Promise<AppState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    return parsed;
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
