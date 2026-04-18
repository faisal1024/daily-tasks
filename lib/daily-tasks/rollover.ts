import type { AppState, Task } from "./types";

export function applyRollover(state: AppState, today: string): AppState {
  if (state.lastOpenedDate === today) return state;

  const completedSet = new Set(state.todayCompletions);
  const tasks: Task[] = state.tasks.map((task) => ({
    ...task,
    carriedOver: !completedSet.has(task.id),
  }));

  return {
    ...state,
    tasks,
    todayCompletions: [],
    lastOpenedDate: today,
  };
}

export function syncTodayHistory(state: AppState, today: string): AppState {
  const total = state.tasks.length;
  const completed = state.todayCompletions.filter((id) =>
    state.tasks.some((t) => t.id === id),
  ).length;

  if (total === 0 && !state.history[today]) return state;

  const existing = state.history[today];
  if (existing && existing.total === total && existing.completed === completed) {
    return state;
  }

  return {
    ...state,
    history: {
      ...state.history,
      [today]: { date: today, total, completed },
    },
  };
}
