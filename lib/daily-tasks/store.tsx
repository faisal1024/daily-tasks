import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AppState as RNAppState, type AppStateStatus } from "react-native";

import { todayKey } from "./date";
import { syncNotifications } from "./notifications";
import { applyRollover, syncTodayHistory } from "./rollover";
import {
  buildInitialState,
  clearState,
  loadState,
  makeId,
  saveState,
} from "./storage";
import type {
  AppState,
  NotificationConfig,
  NotificationKey,
  NotificationSlot,
  TaskId,
} from "./types";
import { DEFAULT_NOTIFICATIONS, DEFAULT_TASKS, MAX_TASKS } from "./types";

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "rollover"; today: string }
  | { type: "addTask"; text: string; today: string }
  | { type: "editTask"; id: TaskId; text: string }
  | { type: "deleteTask"; id: TaskId; today: string }
  | { type: "toggleTask"; id: TaskId; today: string }
  | { type: "setNotificationEnabled"; key: NotificationKey; enabled: boolean }
  | { type: "setNotificationTime"; key: NotificationKey; hour: number; minute: number }
  | { type: "reset"; state: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "rollover": {
      const rolled = applyRollover(state, action.today);
      return syncTodayHistory(rolled, action.today);
    }
    case "addTask": {
      if (state.tasks.length >= MAX_TASKS) return state;
      const text = action.text.trim();
      if (!text) return state;
      const next: AppState = {
        ...state,
        tasks: [
          ...state.tasks,
          { id: makeId(), text, createdAt: new Date().toISOString(), carriedOver: false },
        ],
      };
      return syncTodayHistory(next, action.today);
    }
    case "editTask": {
      const text = action.text.trim();
      if (!text) return state;
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, text } : t)),
      };
    }
    case "deleteTask": {
      const next: AppState = {
        ...state,
        tasks: state.tasks.filter((t) => t.id !== action.id),
        todayCompletions: state.todayCompletions.filter((id) => id !== action.id),
      };
      return syncTodayHistory(next, action.today);
    }
    case "toggleTask": {
      const isCompleted = state.todayCompletions.includes(action.id);
      const todayCompletions = isCompleted
        ? state.todayCompletions.filter((id) => id !== action.id)
        : [...state.todayCompletions, action.id];
      const next: AppState = {
        ...state,
        todayCompletions,
        tasks: state.tasks.map((t) =>
          t.id === action.id && !isCompleted ? { ...t, carriedOver: false } : t,
        ),
      };
      return syncTodayHistory(next, action.today);
    }
    case "setNotificationEnabled":
      return {
        ...state,
        notifications: {
          ...state.notifications,
          [action.key]: { ...state.notifications[action.key], enabled: action.enabled },
        },
      };
    case "setNotificationTime":
      return {
        ...state,
        notifications: {
          ...state.notifications,
          [action.key]: {
            ...state.notifications[action.key],
            hour: action.hour,
            minute: action.minute,
          },
        },
      };
    case "reset":
      return action.state;
  }
}

interface StoreContextValue {
  ready: boolean;
  state: AppState;
  today: string;
  completedCount: number;
  isCompleted: (id: TaskId) => boolean;
  addTask: (text: string) => void;
  editTask: (id: TaskId, text: string) => void;
  deleteTask: (id: TaskId) => void;
  toggleTask: (id: TaskId) => void;
  setNotificationEnabled: (key: NotificationKey, enabled: boolean) => void;
  setNotificationTime: (key: NotificationKey, hour: number, minute: number) => void;
  resetAll: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function DailyTasksProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, () => buildInitialState());
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState(() => todayKey());
  const lastSyncedNotifications = useRef<NotificationConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadState();
      const baseToday = todayKey();
      if (cancelled) return;
      if (stored) {
        dispatch({ type: "hydrate", state: stored });
        dispatch({ type: "rollover", today: baseToday });
      } else {
        dispatch({ type: "rollover", today: baseToday });
      }
      setToday(baseToday);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveState(state);
  }, [ready, state]);

  useEffect(() => {
    if (!ready) return;
    const current = state.notifications;
    const prev = lastSyncedNotifications.current;
    if (prev && JSON.stringify(prev) === JSON.stringify(current)) return;
    lastSyncedNotifications.current = current;
    void syncNotifications(current);
  }, [ready, state.notifications]);

  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status !== "active") return;
      const fresh = todayKey();
      if (fresh !== today) {
        setToday(fresh);
        dispatch({ type: "rollover", today: fresh });
      }
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [today]);

  useEffect(() => {
    const id = setInterval(() => {
      const fresh = todayKey();
      if (fresh !== today) {
        setToday(fresh);
        dispatch({ type: "rollover", today: fresh });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [today]);

  const completedCount = state.todayCompletions.filter((id) =>
    state.tasks.some((t) => t.id === id),
  ).length;

  const isCompleted = useCallback(
    (id: TaskId) => state.todayCompletions.includes(id),
    [state.todayCompletions],
  );

  const addTask = useCallback(
    (text: string) => dispatch({ type: "addTask", text, today: todayKey() }),
    [],
  );
  const editTask = useCallback(
    (id: TaskId, text: string) => dispatch({ type: "editTask", id, text }),
    [],
  );
  const deleteTask = useCallback(
    (id: TaskId) => dispatch({ type: "deleteTask", id, today: todayKey() }),
    [],
  );
  const toggleTask = useCallback(
    (id: TaskId) => dispatch({ type: "toggleTask", id, today: todayKey() }),
    [],
  );
  const setNotificationEnabled = useCallback(
    (key: NotificationKey, enabled: boolean) =>
      dispatch({ type: "setNotificationEnabled", key, enabled }),
    [],
  );
  const setNotificationTime = useCallback(
    (key: NotificationKey, hour: number, minute: number) =>
      dispatch({ type: "setNotificationTime", key, hour, minute }),
    [],
  );
  const resetAll = useCallback(async () => {
    await clearState();
    const fresh = buildInitialState();
    dispatch({ type: "reset", state: fresh });
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      ready,
      state,
      today,
      completedCount,
      isCompleted,
      addTask,
      editTask,
      deleteTask,
      toggleTask,
      setNotificationEnabled,
      setNotificationTime,
      resetAll,
    }),
    [
      ready,
      state,
      today,
      completedCount,
      isCompleted,
      addTask,
      editTask,
      deleteTask,
      toggleTask,
      setNotificationEnabled,
      setNotificationTime,
      resetAll,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useDailyTasks(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useDailyTasks must be used within DailyTasksProvider");
  }
  return ctx;
}

export { DEFAULT_NOTIFICATIONS, DEFAULT_TASKS, MAX_TASKS };
