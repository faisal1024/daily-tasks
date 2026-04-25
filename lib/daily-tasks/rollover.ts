import { MAX_TASKS } from "./types";
import type {
  AppState,
  DayRecord,
  DayTaskRecord,
  LockSource,
  Task,
  TaskId,
} from "./types";

function buildDayTaskRecords(
  tasks: Task[],
  completedIds: TaskId[],
  incompleteOutcome: DayTaskRecord["rolloverOutcome"] = null,
): DayTaskRecord[] {
  const completedSet = new Set(completedIds);

  return tasks.map((task) => {
    const completed = completedSet.has(task.id);
    return {
      id: task.id,
      text: task.text,
      completed,
      carriedOver: task.carriedOver,
      rolloverOutcome: completed ? null : incompleteOutcome,
    };
  });
}

function buildDayRecord(
  date: string,
  tasks: Task[],
  completedIds: TaskId[],
  locked: boolean,
  lockSource: LockSource | null,
  incompleteOutcome: DayTaskRecord["rolloverOutcome"] = null,
): DayRecord {
  const taskRecords = buildDayTaskRecords(tasks, completedIds, incompleteOutcome);
  const completed = taskRecords.filter((task) => task.completed).length;

  return {
    date,
    total: tasks.length,
    completed,
    locked,
    lockSource,
    tasks: taskRecords,
  };
}

export function applyRollover(state: AppState, today: string): AppState {
  if (state.lastOpenedDate === today) return state;

  const previousDate = state.lastOpenedDate;
  const previousRecord = buildDayRecord(
    previousDate,
    state.tasks,
    state.todayCompletions,
    state.todayLocked,
    state.todayLockSource,
    "unresolved",
  );

  const pendingTasks = previousRecord.tasks.filter((task) => !task.completed);

  return syncTodayHistory(
    {
      ...state,
      tasks: [],
      todayCompletions: [],
      lastOpenedDate: today,
      todayLocked: false,
      todayLockSource: null,
      autoLockNoticeDate: null,
      pendingRollover:
        pendingTasks.length > 0
          ? {
              sourceDate: previousDate,
              tasks: pendingTasks,
            }
          : null,
      history: {
        ...state.history,
        [previousDate]: previousRecord,
      },
    },
    today,
  );
}

export function resolvePendingRollover(
  state: AppState,
  carriedTaskIds: TaskId[],
  now: Date = new Date(),
): AppState {
  if (!state.pendingRollover) return state;

  const sourceDate = state.pendingRollover.sourceDate;
  const sourceRecord = state.history[sourceDate];
  if (!sourceRecord) {
    return {
      ...state,
      pendingRollover: null,
    };
  }

  const availableSlots = Math.max(0, MAX_TASKS - state.tasks.length);
  const carrySet = new Set(carriedTaskIds);
  const carriedTasks = state.pendingRollover.tasks
    .filter((task) => carrySet.has(task.id))
    .slice(0, availableSlots);
  const carriedIds = new Set(carriedTasks.map((task) => task.id));

  const nextTasks = [
    ...state.tasks,
    ...carriedTasks.map((task) => ({
      id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text: task.text,
      createdAt: now.toISOString(),
      carriedOver: true,
    })),
  ];

  const updatedSource: DayRecord = {
    ...sourceRecord,
    tasks: sourceRecord.tasks.map((task) => {
      if (task.completed || task.rolloverOutcome === null) return task;
      return {
        ...task,
        rolloverOutcome: carriedIds.has(task.id) ? "carried" : "dropped",
      };
    }),
  };

  return syncTodayHistory(
    {
      ...state,
      tasks: nextTasks,
      pendingRollover: null,
      history: {
        ...state.history,
        [sourceDate]: updatedSource,
      },
    },
    state.lastOpenedDate,
  );
}

export function syncTodayHistory(state: AppState, today: string): AppState {
  const nextRecord = buildDayRecord(
    today,
    state.tasks,
    state.todayCompletions,
    state.todayLocked,
    state.todayLockSource,
  );

  const existing = state.history[today];
  if (existing && JSON.stringify(existing) === JSON.stringify(nextRecord)) {
    return state;
  }

  return {
    ...state,
    history: {
      ...state.history,
      [today]: nextRecord,
    },
  };
}
