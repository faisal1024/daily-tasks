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
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  syncNotifications,
} from "./notifications";
import { shouldAutoLockToday } from "./locking";
import {
  applyRollover,
  resolvePendingRollover,
  syncTodayHistory,
} from "./rollover";
import { buildInitialState, clearState, loadState, makeId, saveState } from "./storage";
import type {
  AppState,
  NotificationPermissionState,
  NotificationKey,
  TaskId,
} from "./types";
import { DEFAULT_NOTIFICATIONS, MAX_TASKS } from "./types";

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "rollover"; today: string }
  | { type: "addTask"; text: string; today: string }
  | { type: "editTask"; id: TaskId; text: string; today: string }
  | { type: "deleteTask"; id: TaskId; today: string }
  | { type: "toggleTask"; id: TaskId; today: string }
  | { type: "lockToday"; today: string }
  | { type: "autoLockToday"; today: string }
  | { type: "dismissAutoLockNotice"; today: string }
  | { type: "resolveRollover"; carriedTaskIds: TaskId[]; today: string; now: Date }
  | { type: "setNotificationsEnabled"; enabled: boolean }
  | { type: "setNotificationEnabled"; key: NotificationKey; enabled: boolean }
  | { type: "markOnboardingSeen" }
  | { type: "setTodayReflection"; text: string; today: string }
  | { type: "reset"; state: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "rollover":
      return applyRollover(state, action.today);
    case "addTask": {
      if (state.todayLocked || state.tasks.length >= MAX_TASKS) return state;
      const text = action.text.trim();
      if (!text) return state;
      return syncTodayHistory(
        {
          ...state,
          tasks: [
            ...state.tasks,
            { id: makeId(), text, createdAt: new Date().toISOString(), carriedOver: false },
          ],
        },
        action.today,
      );
    }
    case "editTask": {
      if (state.todayLocked) return state;
      const text = action.text.trim();
      if (!text) return state;
      return syncTodayHistory(
        {
          ...state,
          tasks: state.tasks.map((task) =>
            task.id === action.id ? { ...task, text } : task,
          ),
        },
        action.today,
      );
    }
    case "deleteTask": {
      if (state.todayLocked) return state;
      return syncTodayHistory(
        {
          ...state,
          tasks: state.tasks.filter((task) => task.id !== action.id),
          todayCompletions: state.todayCompletions.filter((id) => id !== action.id),
        },
        action.today,
      );
    }
    case "toggleTask": {
      const isCompleted = state.todayCompletions.includes(action.id);
      const todayCompletions = isCompleted
        ? state.todayCompletions.filter((id) => id !== action.id)
        : [...state.todayCompletions, action.id];
      return syncTodayHistory(
        {
          ...state,
          todayCompletions,
          tasks: state.tasks.map((task) =>
            task.id === action.id && !isCompleted ? { ...task, carriedOver: false } : task,
          ),
        },
        action.today,
      );
    }
    case "lockToday":
      if (state.todayLocked) return state;
      return syncTodayHistory(
        {
          ...state,
          todayLocked: true,
          todayLockSource: "manual",
          autoLockNoticeDate: null,
        },
        action.today,
      );
    case "autoLockToday":
      if (state.todayLocked || state.tasks.length === 0) return state;
      return syncTodayHistory(
        {
          ...state,
          todayLocked: true,
          todayLockSource: "auto",
          autoLockNoticeDate: action.today,
        },
        action.today,
      );
    case "dismissAutoLockNotice":
      if (state.autoLockNoticeDate !== action.today) return state;
      return {
        ...state,
        autoLockNoticeDate: null,
      };
    case "resolveRollover":
      return resolvePendingRollover(state, action.carriedTaskIds, action.now);
    case "setNotificationsEnabled":
      return {
        ...state,
        notifications: {
          ...state.notifications,
          enabled: action.enabled,
        },
      };
    case "setNotificationEnabled":
      return {
        ...state,
        notifications: {
          ...state.notifications,
          [action.key]: action.enabled,
        },
      };
    case "markOnboardingSeen":
      if (state.hasSeenOnboarding) return state;
      return { ...state, hasSeenOnboarding: true };
    case "setTodayReflection": {
      const text = action.text.trim();
      return syncTodayHistory(
        {
          ...state,
          todayReflection: text.length > 0 ? text : null,
        },
        action.today,
      );
    }
    case "reset":
      return action.state;
  }
}

interface StoreContextValue {
  ready: boolean;
  state: AppState;
  today: string;
  notificationPermission: NotificationPermissionState;
  completedCount: number;
  remainingSlots: number;
  isCompleted: (id: TaskId) => boolean;
  addTask: (text: string) => void;
  editTask: (id: TaskId, text: string) => void;
  deleteTask: (id: TaskId) => void;
  toggleTask: (id: TaskId) => void;
  lockToday: () => void;
  dismissAutoLockNotice: () => void;
  resolveRollover: (carriedTaskIds: TaskId[]) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setNotificationEnabled: (key: NotificationKey, enabled: boolean) => void;
  markOnboardingSeen: () => void;
  setTodayReflection: (text: string) => void;
  refreshNotificationPermission: () => Promise<NotificationPermissionState>;
  requestNotificationPermission: () => Promise<NotificationPermissionState>;
  resetAll: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function DailyTasksProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, () => buildInitialState());
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState(() => todayKey());
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>("undetermined");
  const lastReminderSync = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, permission] = await Promise.all([
        loadState(),
        getNotificationPermissionStatus(),
      ]);
      const baseToday = todayKey();
      if (cancelled) return;
      dispatch({ type: "hydrate", state: stored ?? buildInitialState() });
      dispatch({ type: "rollover", today: baseToday });
      setNotificationPermission(permission);
      setToday(baseToday);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void saveState(state);
  }, [ready, state]);

  const refreshNotificationPermission = useCallback(async () => {
    const status = await getNotificationPermissionStatus();
    setNotificationPermission(status);
    return status;
  }, []);

  const requestPermission = useCallback(async () => {
    const status = await requestNotificationPermission();
    setNotificationPermission(status);
    return status;
  }, []);

  const completedCount = state.todayCompletions.filter((id) =>
    state.tasks.some((task) => task.id === id),
  ).length;
  const remainingSlots = Math.max(0, MAX_TASKS - state.tasks.length);

  useEffect(() => {
    if (!ready) return;
    const now = new Date();
    if (!shouldAutoLockToday(now, state.tasks.length, state.todayLocked)) return;
    dispatch({ type: "autoLockToday", today });
  }, [ready, state.tasks.length, state.todayLocked, today]);

  useEffect(() => {
    if (!ready) return;
    const signature = JSON.stringify({
      today,
      tasks: state.tasks.map((task) => ({
        id: task.id,
        text: task.text,
        carriedOver: task.carriedOver,
      })),
      todayCompletions: [...state.todayCompletions].sort(),
      notifications: state.notifications,
      notificationPermission,
    });
    if (lastReminderSync.current === signature) return;
    lastReminderSync.current = signature;
    void syncNotifications({
      now: new Date(),
      settings: state.notifications,
      permissionState: notificationPermission,
      taskCount: state.tasks.length,
      completedCount,
    });
  }, [
    completedCount,
    notificationPermission,
    ready,
    state.notifications,
    state.tasks,
    state.todayCompletions,
    today,
  ]);

  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status !== "active") return;
      void refreshNotificationPermission();
      const fresh = todayKey();
      if (fresh !== today) {
        setToday(fresh);
        dispatch({ type: "rollover", today: fresh });
      }
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refreshNotificationPermission, today]);

  useEffect(() => {
    const id = setInterval(() => {
      const fresh = todayKey();
      if (fresh !== today) {
        setToday(fresh);
        dispatch({ type: "rollover", today: fresh });
        return;
      }
      if (shouldAutoLockToday(new Date(), state.tasks.length, state.todayLocked)) {
        dispatch({ type: "autoLockToday", today: fresh });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [state.tasks.length, state.todayLocked, today]);

  const isCompleted = useCallback(
    (id: TaskId) => state.todayCompletions.includes(id),
    [state.todayCompletions],
  );

  const addTask = useCallback((text: string) => {
    dispatch({ type: "addTask", text, today: todayKey() });
  }, []);
  const editTask = useCallback((id: TaskId, text: string) => {
    dispatch({ type: "editTask", id, text, today: todayKey() });
  }, []);
  const deleteTask = useCallback((id: TaskId) => {
    dispatch({ type: "deleteTask", id, today: todayKey() });
  }, []);
  const toggleTask = useCallback((id: TaskId) => {
    dispatch({ type: "toggleTask", id, today: todayKey() });
  }, []);
  const lockToday = useCallback(() => {
    dispatch({ type: "lockToday", today: todayKey() });
  }, []);
  const dismissAutoLockNotice = useCallback(() => {
    dispatch({ type: "dismissAutoLockNotice", today: todayKey() });
  }, []);
  const resolveRollover = useCallback((carriedTaskIds: TaskId[]) => {
    dispatch({
      type: "resolveRollover",
      carriedTaskIds,
      today: todayKey(),
      now: new Date(),
    });
  }, []);
  const setNotificationsEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "setNotificationsEnabled", enabled });
  }, []);
  const setNotificationEnabled = useCallback((key: NotificationKey, enabled: boolean) => {
    dispatch({ type: "setNotificationEnabled", key, enabled });
  }, []);
  const markOnboardingSeen = useCallback(() => {
    dispatch({ type: "markOnboardingSeen" });
  }, []);
  const setTodayReflection = useCallback((text: string) => {
    dispatch({ type: "setTodayReflection", text, today: todayKey() });
  }, []);
  const resetAll = useCallback(async () => {
    await clearState();
    dispatch({ type: "reset", state: buildInitialState() });
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      ready,
      state,
      today,
      notificationPermission,
      completedCount,
      remainingSlots,
      isCompleted,
      addTask,
      editTask,
      deleteTask,
      toggleTask,
      lockToday,
      dismissAutoLockNotice,
      resolveRollover,
      setNotificationsEnabled,
      setNotificationEnabled,
      markOnboardingSeen,
      setTodayReflection,
      refreshNotificationPermission,
      requestNotificationPermission: requestPermission,
      resetAll,
    }),
    [
      ready,
      state,
      today,
      notificationPermission,
      completedCount,
      remainingSlots,
      isCompleted,
      addTask,
      editTask,
      deleteTask,
      toggleTask,
      lockToday,
      dismissAutoLockNotice,
      resolveRollover,
      setNotificationsEnabled,
      setNotificationEnabled,
      markOnboardingSeen,
      setTodayReflection,
      refreshNotificationPermission,
      requestPermission,
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

export { DEFAULT_NOTIFICATIONS, MAX_TASKS };
