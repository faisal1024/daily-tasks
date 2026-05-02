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
  buildFallbackMomentumPlan,
  requestOpenAiMomentumPlan,
} from "./momentum-ai";
import {
  buildAdaptationSnapshot,
  buildMomentumPlan,
  isMomentumProfileComplete,
} from "./momentum";
import {
  applyRollover,
  resolvePendingRollover,
  syncTodayHistory,
} from "./rollover";
import { buildInitialState, clearState, loadState, makeId, saveState } from "./storage";
import type {
  AppState,
  MomentumProfile,
  NotificationPermissionState,
  NotificationKey,
  ReflectionResult,
  TaskId,
} from "./types";
import { DEFAULT_NOTIFICATIONS, MAX_TASKS } from "./types";

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "rollover"; today: string }
  | { type: "addTask"; text: string; today: string }
  | { type: "addTasks"; texts: string[]; today: string }
  | { type: "editTask"; id: TaskId; text: string; today: string }
  | { type: "deleteTask"; id: TaskId; today: string }
  | { type: "toggleTask"; id: TaskId; today: string }
  | { type: "lockToday"; today: string }
  | { type: "autoLockToday"; today: string }
  | { type: "dismissAutoLockNotice"; today: string }
  | { type: "resolveRollover"; carriedTaskIds: TaskId[]; today: string; now: Date }
  | { type: "setNotificationsEnabled"; enabled: boolean }
  | { type: "setNotificationEnabled"; key: NotificationKey; enabled: boolean }
  | { type: "setAutoLockEnabled"; enabled: boolean }
  | { type: "setAutoLockTime"; hour: number; minute: number }
  | { type: "markOnboardingSeen" }
  | { type: "completeMomentumOnboarding"; profile: MomentumProfile }
  | { type: "updateMomentumProfile"; profile: MomentumProfile }
  | { type: "regenerateMomentumPlan"; now: Date }
  | { type: "requestMomentumPlanStarted" }
  | { type: "requestMomentumPlanSucceeded"; plan: NonNullable<AppState["momentumPlan"]> }
  | { type: "requestMomentumPlanFailed"; message: string; now: Date }
  | {
      type: "setMomentumSetting";
      key: keyof AppState["momentumSettings"];
      value: AppState["momentumSettings"][keyof AppState["momentumSettings"]];
    }
  | { type: "setTodayReflection"; text: string; today: string }
  | { type: "setTodayReflectionResult"; result: ReflectionResult; today: string; now: Date }
  | { type: "reset"; state: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "rollover": {
      const next = applyRollover(state, action.today);
      if (!isMomentumProfileComplete(next.momentumProfile)) return next;
      return {
        ...next,
        momentumPlan: buildMomentumPlan({
          profile: next.momentumProfile,
          history: next.history,
          settings: next.momentumSettings,
          now: new Date(`${action.today}T12:00:00`),
        }),
        momentumPlanStatus: "ready",
        momentumPlanError: null,
        adaptationSnapshot: buildAdaptationSnapshot(
          next.momentumProfile,
          next.momentumSettings,
          next.history,
          new Date(`${action.today}T12:00:00`),
        ),
      };
    }
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
    case "addTasks": {
      if (state.todayLocked || state.tasks.length >= MAX_TASKS) return state;
      const openSlots = MAX_TASKS - state.tasks.length;
      const texts = action.texts
        .map((text) => text.trim())
        .filter(Boolean)
        .slice(0, openSlots);
      if (texts.length === 0) return state;
      return syncTodayHistory(
        {
          ...state,
          tasks: [
            ...state.tasks,
            ...texts.map((text) => ({
              id: makeId(),
              text,
              createdAt: new Date().toISOString(),
              carriedOver: false,
            })),
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
    case "setAutoLockEnabled":
      return {
        ...state,
        autoLock: {
          ...state.autoLock,
          enabled: action.enabled,
        },
      };
    case "setAutoLockTime":
      return {
        ...state,
        autoLock: {
          ...state.autoLock,
          hour: action.hour,
          minute: action.minute,
        },
      };
    case "markOnboardingSeen":
      if (state.hasSeenOnboarding) return state;
      return { ...state, hasSeenOnboarding: true };
    case "completeMomentumOnboarding":
      {
        const momentumProfile = {
          ...action.profile,
          onboardingCompletedAt:
            action.profile.onboardingCompletedAt ?? new Date().toISOString(),
        };
        return {
          ...state,
          hasSeenOnboarding: true,
          momentumProfile,
          momentumPlan: buildMomentumPlan({
            profile: momentumProfile,
            history: state.history,
            settings: state.momentumSettings,
          }),
          momentumPlanStatus: "ready",
          momentumPlanError: null,
          adaptationSnapshot: buildAdaptationSnapshot(
            momentumProfile,
            state.momentumSettings,
            state.history,
          ),
        };
      }
    case "updateMomentumProfile":
      return {
        ...state,
        momentumProfile: action.profile,
        momentumPlan: buildMomentumPlan({
          profile: action.profile,
          history: state.history,
          settings: state.momentumSettings,
        }),
        momentumPlanStatus: "ready",
        momentumPlanError: null,
        adaptationSnapshot: buildAdaptationSnapshot(
          action.profile,
          state.momentumSettings,
          state.history,
        ),
      };
    case "regenerateMomentumPlan":
      return {
        ...state,
        momentumPlan: buildMomentumPlan({
          profile: state.momentumProfile,
          history: state.history,
          settings: state.momentumSettings,
          now: action.now,
        }),
        momentumPlanStatus: "ready",
        momentumPlanError: null,
        adaptationSnapshot: buildAdaptationSnapshot(
          state.momentumProfile,
          state.momentumSettings,
          state.history,
          action.now,
        ),
      };
    case "requestMomentumPlanStarted":
      return {
        ...state,
        momentumPlanStatus: "loading",
        momentumPlanError: null,
      };
    case "requestMomentumPlanSucceeded":
      return {
        ...state,
        momentumPlan: action.plan,
        momentumPlanStatus: "ready",
        momentumPlanError: null,
      };
    case "requestMomentumPlanFailed":
      return {
        ...state,
        momentumPlan:
          buildFallbackMomentumPlan({
            profile: state.momentumProfile,
            history: state.history,
            settings: state.momentumSettings,
            now: action.now,
          }) ?? state.momentumPlan,
        momentumPlanStatus: "error",
        momentumPlanError: action.message,
      };
    case "setMomentumSetting": {
      const momentumSettings = {
        ...state.momentumSettings,
        [action.key]: action.value,
      };
      return {
        ...state,
        momentumSettings,
        momentumPlan: buildMomentumPlan({
          profile: state.momentumProfile,
          history: state.history,
          settings: momentumSettings,
        }),
        momentumPlanStatus: "ready",
        momentumPlanError: null,
        adaptationSnapshot: buildAdaptationSnapshot(
          state.momentumProfile,
          momentumSettings,
          state.history,
        ),
      };
    }
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
    case "setTodayReflectionResult": {
      return syncTodayHistory(
        {
          ...state,
          todayReflectionResult: action.result,
          adaptationSnapshot: buildAdaptationSnapshot(
            state.momentumProfile,
            state.momentumSettings,
            state.history,
            action.now,
          ),
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
  addTasks: (texts: string[]) => void;
  editTask: (id: TaskId, text: string) => void;
  deleteTask: (id: TaskId) => void;
  toggleTask: (id: TaskId) => void;
  lockToday: () => void;
  dismissAutoLockNotice: () => void;
  resolveRollover: (carriedTaskIds: TaskId[]) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setNotificationEnabled: (key: NotificationKey, enabled: boolean) => void;
  setAutoLockEnabled: (enabled: boolean) => void;
  setAutoLockTime: (hour: number, minute: number) => void;
  markOnboardingSeen: () => void;
  completeMomentumOnboarding: (profile: MomentumProfile) => void;
  updateMomentumProfile: (profile: MomentumProfile) => void;
  regenerateMomentumPlan: () => void;
  requestMomentumPlan: () => Promise<void>;
  setMomentumSetting: <K extends keyof AppState["momentumSettings"]>(
    key: K,
    value: AppState["momentumSettings"][K],
  ) => void;
  setTodayReflection: (text: string) => void;
  setTodayReflectionResult: (result: ReflectionResult) => void;
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
    if (!shouldAutoLockToday(now, state.tasks.length, state.todayLocked, state.autoLock)) return;
    dispatch({ type: "autoLockToday", today });
  }, [ready, state.autoLock, state.tasks.length, state.todayLocked, today]);

  useEffect(() => {
    if (!ready || state.momentumPlan || !isMomentumProfileComplete(state.momentumProfile)) {
      return;
    }
    dispatch({ type: "regenerateMomentumPlan", now: new Date() });
  }, [ready, state.momentumPlan, state.momentumProfile]);

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
        return;
      }
      if (shouldAutoLockToday(new Date(), state.tasks.length, state.todayLocked, state.autoLock)) {
        dispatch({ type: "autoLockToday", today: fresh });
      }
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refreshNotificationPermission, state.autoLock, state.tasks.length, state.todayLocked, today]);

  useEffect(() => {
    const id = setInterval(() => {
      const fresh = todayKey();
      if (fresh !== today) {
        setToday(fresh);
        dispatch({ type: "rollover", today: fresh });
        return;
      }
      if (shouldAutoLockToday(new Date(), state.tasks.length, state.todayLocked, state.autoLock)) {
        dispatch({ type: "autoLockToday", today: fresh });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [state.autoLock, state.tasks.length, state.todayLocked, today]);

  const isCompleted = useCallback(
    (id: TaskId) => state.todayCompletions.includes(id),
    [state.todayCompletions],
  );

  const addTask = useCallback((text: string) => {
    dispatch({ type: "addTask", text, today: todayKey() });
  }, []);
  const addTasks = useCallback((texts: string[]) => {
    dispatch({ type: "addTasks", texts, today: todayKey() });
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
  const setAutoLockEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "setAutoLockEnabled", enabled });
  }, []);
  const setAutoLockTime = useCallback((hour: number, minute: number) => {
    dispatch({ type: "setAutoLockTime", hour, minute });
  }, []);
  const markOnboardingSeen = useCallback(() => {
    dispatch({ type: "markOnboardingSeen" });
  }, []);
  const completeMomentumOnboarding = useCallback((profile: MomentumProfile) => {
    dispatch({ type: "completeMomentumOnboarding", profile });
  }, []);
  const updateMomentumProfile = useCallback((profile: MomentumProfile) => {
    dispatch({ type: "updateMomentumProfile", profile });
  }, []);
  const regenerateMomentumPlan = useCallback(() => {
    dispatch({ type: "regenerateMomentumPlan", now: new Date() });
  }, []);
  const requestMomentumPlan = useCallback(async () => {
    dispatch({ type: "requestMomentumPlanStarted" });
    const now = new Date();
    try {
      const plan = await requestOpenAiMomentumPlan({
        profile: state.momentumProfile,
        history: state.history,
        settings: state.momentumSettings,
        now,
      });
      dispatch({ type: "requestMomentumPlanSucceeded", plan });
    } catch (error) {
      dispatch({
        type: "requestMomentumPlanFailed",
        message: error instanceof Error ? error.message : "Momentum AI is unavailable.",
        now,
      });
    }
  }, [state.history, state.momentumProfile, state.momentumSettings]);
  const setMomentumSetting = useCallback(
    <K extends keyof AppState["momentumSettings"]>(
      key: K,
      value: AppState["momentumSettings"][K],
    ) => {
      dispatch({ type: "setMomentumSetting", key, value });
    },
    [],
  );
  const setTodayReflection = useCallback((text: string) => {
    dispatch({ type: "setTodayReflection", text, today: todayKey() });
  }, []);
  const setTodayReflectionResult = useCallback((result: ReflectionResult) => {
    dispatch({ type: "setTodayReflectionResult", result, today: todayKey(), now: new Date() });
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
      addTasks,
      editTask,
      deleteTask,
      toggleTask,
      lockToday,
      dismissAutoLockNotice,
      resolveRollover,
      setNotificationsEnabled,
      setNotificationEnabled,
      setAutoLockEnabled,
      setAutoLockTime,
      markOnboardingSeen,
      completeMomentumOnboarding,
      updateMomentumProfile,
      regenerateMomentumPlan,
      requestMomentumPlan,
      setMomentumSetting,
      setTodayReflection,
      setTodayReflectionResult,
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
      addTasks,
      editTask,
      deleteTask,
      toggleTask,
      lockToday,
      dismissAutoLockNotice,
      resolveRollover,
      setNotificationsEnabled,
      setNotificationEnabled,
      setAutoLockEnabled,
      setAutoLockTime,
      markOnboardingSeen,
      completeMomentumOnboarding,
      updateMomentumProfile,
      regenerateMomentumPlan,
      requestMomentumPlan,
      setMomentumSetting,
      setTodayReflection,
      setTodayReflectionResult,
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
