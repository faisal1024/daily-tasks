import { fromDateKey, storeDayFor } from "./date";
import { unparkTexts } from "./task-extras";
import { MAX_TASKS } from "./types";
import type {
  AppState,
  DayRecord,
  DayTaskRecord,
  LockSource,
  ReflectionResult,
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
      ...(task.steps && task.steps.length > 0 ? { steps: task.steps } : {}),
      ...(task.routineId ? { routineId: task.routineId } : {}),
    };
  });
}

function buildDayRecord(
  date: string,
  tasks: Task[],
  completedIds: TaskId[],
  locked: boolean,
  lockSource: LockSource | null,
  reflection: string | null,
  reflectionResult: ReflectionResult | null,
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
    reflection,
    reflectionResult,
  };
}

function markIncompleteTasksUnresolved(record: DayRecord): DayRecord {
  return {
    ...record,
    tasks: record.tasks.map((task) => ({
      ...task,
      rolloverOutcome: task.completed ? null : task.rolloverOutcome ?? "unresolved",
    })),
  };
}

function taskRecordsMatchTasks(record: DayRecord, tasks: Task[]): boolean {
  if (record.tasks.length !== tasks.length) return false;
  return record.tasks.every((task, index) => {
    const liveTask = tasks[index];
    return liveTask?.id === task.id && liveTask.text === task.text;
  });
}

function restoreTasksFromRecord(record: DayRecord): Task[] {
  // Local midnight of that day, not UTC midnight: east of UTC, "T00:00Z" is
  // already mid-day (14:00 in Kiritimati), past the auto-lock time, so the
  // restored tasks would never count towards locking the day.
  const createdAt = fromDateKey(record.date).toISOString();
  return record.tasks.map((task) => ({
    id: task.id,
    text: task.text,
    createdAt,
    carriedOver: task.carriedOver,
    ...(task.steps && task.steps.length > 0 ? { steps: task.steps } : {}),
    ...(task.routineId ? { routineId: task.routineId } : {}),
  }));
}

function completedIdsFromRecord(record: DayRecord): TaskId[] {
  return record.tasks.filter((task) => task.completed).map((task) => task.id);
}

// Same normalization as the evening draft's, so "Walk " and "walk" match.
const taskKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** Mark a source day's still-unresolved tasks with an outcome (by id). */
function settleSource(
  state: AppState,
  sourceDate: string,
  outcome: (task: DayRecord["tasks"][number]) => "carried" | "dropped" | null,
): AppState {
  const record = state.history[sourceDate];
  if (!record) return state;
  return {
    ...state,
    history: {
      ...state.history,
      [sourceDate]: {
        ...record,
        tasks: record.tasks.map((task) => {
          if (task.completed || task.rolloverOutcome !== "unresolved") return task;
          const next = outcome(task);
          return next ? { ...task, rolloverOutcome: next } : task;
        }),
      },
    },
  };
}

/**
 * Yesterday's unfinished ones are a card on Today (not a blocking modal), so
 * the day can change underneath it. Keep it honest: anything already on Today
 * (e.g. from last night's draft) counts as carried and leaves the card, and a
 * full or set day has no room, so the rest stay in history (dropped).
 */
export function settlePendingRollover(state: AppState): AppState {
  const pending = state.pendingRollover;
  if (!pending) return state;
  const onToday = new Set(state.tasks.map((task) => taskKey(task.text)));
  const noRoom = state.todayLocked || state.tasks.length >= MAX_TASKS;
  const covered = pending.tasks.filter((task) => onToday.has(taskKey(task.text)));
  if (covered.length === 0 && !noRoom) return state;
  const coveredIds = new Set(covered.map((task) => task.id));
  const settled = settleSource(state, pending.sourceDate, (task) =>
    coveredIds.has(task.id) ? "carried" : noRoom ? "dropped" : null,
  );
  const rest = noRoom ? [] : pending.tasks.filter((task) => !coveredIds.has(task.id));
  return { ...settled, pendingRollover: rest.length > 0 ? { ...pending, tasks: rest } : null };
}

export function applyRollover(state: AppState, today: string): AppState {
  // Same day, or a one-day step back (travel west): keep the current day
  // rather than "rolling over" into an earlier one. See storeDayFor.
  if (storeDayFor(state.lastOpenedDate, today) === state.lastOpenedDate) return state;
  // A card left unanswered for a whole day: those stay in their day's history.
  if (state.pendingRollover) {
    state = { ...settleSource(state, state.pendingRollover.sourceDate, () => "dropped"), pendingRollover: null };
  }

  const previousDate = state.lastOpenedDate;
  const existingTodayRecord = state.history[today];
  const existingPreviousRecord = state.history[previousDate];
  const previousRecord = existingPreviousRecord
    ? markIncompleteTasksUnresolved(existingPreviousRecord)
    : buildDayRecord(
        previousDate,
        existingTodayRecord ? [] : state.tasks,
        existingTodayRecord ? [] : state.todayCompletions,
        state.todayLocked,
        state.todayLockSource,
        state.todayReflection,
        state.todayReflectionResult,
        "unresolved",
      );

  const pendingTasks = previousRecord.tasks.filter(
    (task) => !task.completed && task.rolloverOutcome === "unresolved",
  );
  const todayTasks = existingTodayRecord
    ? taskRecordsMatchTasks(existingTodayRecord, state.tasks)
      ? state.tasks
      : restoreTasksFromRecord(existingTodayRecord)
    : [];
  const todayCompletions = existingTodayRecord
    ? taskRecordsMatchTasks(existingTodayRecord, state.tasks)
      ? state.todayCompletions
      : completedIdsFromRecord(existingTodayRecord)
    : [];

  return syncTodayHistory(
    {
      ...state,
      tasks: todayTasks,
      todayCompletions,
      lastOpenedDate: today,
      todayLocked: existingTodayRecord?.locked ?? false,
      todayLockSource: existingTodayRecord?.lockSource ?? null,
      todayLockedAt: null,
      manualUnlockDate: null,
      todayReflection: existingTodayRecord?.reflection ?? null,
      todayReflectionResult: existingTodayRecord?.reflectionResult ?? null,
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

  // A set day takes nothing new (like addTask/addTasks).
  const availableSlots = state.todayLocked ? 0 : Math.max(0, MAX_TASKS - state.tasks.length);
  const carrySet = new Set(carriedTaskIds);
  const onToday = new Set(state.tasks.map((task) => taskKey(task.text)));
  // Already on Today (e.g. from last night's draft): carried, not added twice.
  const alreadyThere = state.pendingRollover.tasks.filter((task) => onToday.has(taskKey(task.text)));
  const carriedTasks = state.pendingRollover.tasks
    .filter((task) => carrySet.has(task.id) && !onToday.has(taskKey(task.text)))
    .slice(0, availableSlots);
  const carriedIds = new Set([...carriedTasks, ...alreadyThere].map((task) => task.id));

  const nextTasks = [
    ...state.tasks,
    ...carriedTasks.map((task) => ({
      id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text: task.text,
      createdAt: now.toISOString(),
      carriedOver: true,
      // A carried task is usually the stuck one: keep its steps (and progress).
      ...(task.steps && task.steps.length > 0 ? { steps: task.steps } : {}),
      // Still that routine's task: it isn't suggested again today.
      ...(task.routineId ? { routineId: task.routineId } : {}),
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

  // What's carried in (or already here) leaves Saved for later: one place only.
  const unparked = unparkTexts(state, [...carriedTasks, ...alreadyThere].map((task) => task.text));
  return syncTodayHistory(
    {
      ...unparked,
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
    state.todayReflection,
    state.todayReflectionResult,
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
