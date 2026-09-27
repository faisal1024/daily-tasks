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
import { Platform, AppState as RNAppState, type AppStateStatus } from "react-native";

import { todayKey } from "./date";
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  syncNotifications,
} from "./notifications";
import {
  classifyAiFailure,
  isFreshAiPlan,
  isLatestRequest,
  planAfterAiFailure,
  shouldRetryAiOnForeground,
  type AiFailureKind,
} from "./ai-status";
import { autoLockEligibleTaskCount, scheduledAutoLockAt, shouldAutoLockToday } from "./locking";
import {
  canTakeParkedTask,
  clearTaskSteps,
  parkTasks,
  removeParkedTask,
  setTaskSteps,
  toggleTaskStep,
} from "./task-extras";
import {
  buildFallbackMomentumPlan,
  getMomentumAiProxyUrl,
  nextAiPlanFetchKey,
  requestMomentumAiPlan,
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
import {
  acknowledgeLevel,
  awardPerfectDay,
  awardTaskCompletion,
  levelForXp,
  levelProgress,
  pendingLevelUp,
  unlockedCosmetics,
  type LevelProgress,
} from "./journey";
import {
  completeMilestone as completeMilestoneState,
  milestonesWithCompletion,
  nextIncompleteMilestone,
  type MilestoneView,
} from "./milestones";
import {
  resetAnalyticsIdentity,
  setAnalyticsEnabled as applyAnalyticsEnabled,
  track,
} from "./analytics";
import { getCurrentVersion } from "./app-update";
import { GRANDFATHER_BEFORE_VERSION, hasPlusAccess } from "./plus";
import { compareVersions } from "./version";
import { usePlus } from "./plus-context";
import { buildInitialState, clearState, loadState, makeId, saveState } from "./storage";
import { computeDayStreak } from "./streaks";
import {
  invalidateWidgetSnapshot,
  markWidgetTogglesProcessed,
  readWidgetToggles,
  writeWidgetSnapshot,
} from "./widget-bridge";
import {
  buildWidgetSnapshot,
  lastSeq,
  parseWidgetToggles,
  tasksToFlip,
  type WidgetToggle,
} from "./widget-snapshot";
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
  | { type: "lockToday"; today: string; at: string }
  | { type: "unlockToday"; today: string }
  | { type: "autoLockToday"; today: string; at: string }
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
  | { type: "requestMomentumPlanFailed"; kind: AiFailureKind; goalTitle: string | null; now: Date }
  | {
      type: "setMomentumSetting";
      key: keyof AppState["momentumSettings"];
      value: AppState["momentumSettings"][keyof AppState["momentumSettings"]];
    }
  | { type: "setTodayReflection"; text: string; today: string }
  | { type: "setTodayReflectionResult"; result: ReflectionResult; today: string; now: Date }
  | { type: "acknowledgeLevelUp" }
  | { type: "selectJourneyCosmetic"; id: string }
  | { type: "acknowledgeMilestoneCelebration" }
  | { type: "markReviewPrompted"; at: string }
  | { type: "parkTasks"; texts: string[]; at: string }
  | { type: "removeParkedTask"; id: string }
  | { type: "addParkedTask"; id: string; today: string }
  | {
      type: "setTaskSteps";
      taskId: TaskId;
      texts: string[];
      at: string;
      forText?: string;
      today: string;
    }
  | { type: "toggleTaskStep"; taskId: TaskId; stepId: string; today: string }
  | { type: "clearTaskSteps"; taskId: TaskId; today: string }
  | { type: "applyWidgetToggles"; toggles: WidgetToggle[] }
  | { type: "grandfatherPlus" }
  | { type: "setAnalyticsEnabled"; enabled: boolean }
  | { type: "reset"; state: AppState };

/** Canonical count of today's completions that still map to a current task. */
function countCompleted(state: AppState): number {
  return state.todayCompletions.filter((id) =>
    state.tasks.some((task) => task.id === id),
  ).length;
}

/** A "perfect day" is having at least one task and completing all of them. */
function isPerfectDay(state: AppState): boolean {
  return state.tasks.length > 0 && countCompleted(state) === state.tasks.length;
}

/**
 * When the goal changes, milestone completion (tracked by goal-independent ids)
 * must reset so the new goal's path doesn't render as already done.
 */
function resetMilestonesIfGoalChanged(
  state: AppState,
  nextGoalTitle: string | null,
): Partial<AppState> {
  if (nextGoalTitle === state.momentumProfile.goalTitle) return {};
  return { completedMilestoneIds: [], pendingMilestoneCelebration: null };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "markReviewPrompted":
      return { ...state, lastReviewPromptAt: action.at };
    case "applyWidgetToggles": {
      // Taps belong to the day the widget showed, which is the day these tasks
      // belong to (lastOpenedDate), even if the app is only opened tomorrow:
      // this runs before any rollover. Only tasks whose state differs from the
      // tap are toggled, against the live state, so replaying is harmless.
      const day = state.lastOpenedDate;
      return tasksToFlip(state, action.toggles, day).reduce(
        (next, id) => reducer(next, { type: "toggleTask", id, today: day }),
        state,
      );
    }
    case "grandfatherPlus":
      return state.plusGrandfathered ? state : { ...state, plusGrandfathered: true };
    case "setAnalyticsEnabled":
      return state.analyticsEnabled === action.enabled
        ? state
        : { ...state, analyticsEnabled: action.enabled };
    case "parkTasks":
      return parkTasks(state, action.texts, action.at);
    case "removeParkedTask":
      return removeParkedTask(state, action.id);
    case "addParkedTask": {
      const parked = state.parkedTasks.find((p) => p.id === action.id);
      if (!parked || !canTakeParkedTask(state)) return state;
      const withTask = reducer(state, { type: "addTask", text: parked.text, today: action.today });
      return withTask === state ? state : removeParkedTask(withTask, action.id);
    }
    // Step changes also sync today's history record: tomorrow's carry-over is
    // built from it, so it must hold the current steps and their progress.
    case "setTaskSteps": {
      const next = setTaskSteps(state, action.taskId, action.texts, action.at, action.forText);
      return next === state ? state : syncTodayHistory(next, action.today);
    }
    case "toggleTaskStep": {
      const next = toggleTaskStep(state, action.taskId, action.stepId);
      return next === state ? state : syncTodayHistory(next, action.today);
    }
    case "clearTaskSteps": {
      const next = clearTaskSteps(state, action.taskId);
      return next === state ? state : syncTodayHistory(next, action.today);
    }
    case "hydrate":
      return action.state;
    case "rollover": {
      const next = applyRollover(state, action.today);
      if (!isMomentumProfileComplete(next.momentumProfile)) return next;
      // Launching again on the same day keeps today's AI plan instead of
      // flashing a template and paying for a fresh AI call.
      if (isFreshAiPlan(next.momentumPlan, next.momentumProfile.goalTitle, action.today)) {
        return { ...next, momentumPlanStatus: "ready", momentumPlanError: null };
      }
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
          tasks: state.tasks.map((task) => {
            if (task.id !== action.id || task.text === text) return task;
            // Steps were written for the old wording; drop them when it changes.
            const { steps: _staleSteps, ...rest } = task;
            return { ...rest, text };
          }),
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

      const nextTasks = state.tasks.map((task) =>
        task.id === action.id && !isCompleted ? { ...task, carriedOver: false } : task,
      );

      let journey = state.journey;
      let completedMilestoneIds = state.completedMilestoneIds;
      let pendingMilestoneCelebration = state.pendingMilestoneCelebration;
      if (!isCompleted) {
        journey = awardTaskCompletion(journey, action.id, action.today);
        const perfectAlreadyAwarded =
          state.journey.awardDate === action.today && state.journey.perfectAwarded;
        if (isPerfectDay({ ...state, tasks: nextTasks, todayCompletions })) {
          journey = awardPerfectDay(journey, action.today);
          // A newly-reached perfect day auto-advances the next milestone on the
          // goal path (no manual marking needed).
          if (!perfectAlreadyAwarded) {
            const nextMilestone = nextIncompleteMilestone(
              state.momentumPlan?.milestones ?? [],
              completedMilestoneIds,
            );
            if (nextMilestone) {
              const advanced = completeMilestoneState({
                milestones: state.momentumPlan?.milestones ?? [],
                completedMilestoneIds,
                journey,
                id: nextMilestone.id,
              });
              if (advanced) {
                completedMilestoneIds = advanced.completedMilestoneIds;
                journey = advanced.journey;
                pendingMilestoneCelebration = advanced.pendingMilestoneCelebration;
              }
            }
          }
        }
      }

      return syncTodayHistory(
        {
          ...state,
          todayCompletions,
          journey,
          completedMilestoneIds,
          pendingMilestoneCelebration,
          tasks: nextTasks,
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
          todayLockedAt: action.at,
        },
        action.today,
      );
    case "unlockToday":
      if (!state.todayLocked) return state;
      return syncTodayHistory(
        {
          ...state,
          todayLocked: false,
          todayLockSource: null,
          todayLockedAt: null,
          // Don't let auto-lock immediately re-lock the rest of today.
          manualUnlockDate: action.today,
        },
        action.today,
      );
    case "autoLockToday":
      if (
        state.todayLocked ||
        state.tasks.length === 0 ||
        state.manualUnlockDate === action.today
      )
        return state;
      return syncTodayHistory(
        {
          ...state,
          todayLocked: true,
          todayLockSource: "auto",
          todayLockedAt: action.at,
        },
        action.today,
      );
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
          // A new/changed goal starts a fresh milestone path.
          ...resetMilestonesIfGoalChanged(state, action.profile.goalTitle),
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
        // Switching goals must not carry milestone completion across goals.
        ...resetMilestonesIfGoalChanged(state, action.profile.goalTitle),
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
      // The goal changed while this request was in flight: drop the stale plan.
      // Going back to "ready" lets the auto-fetch run for the new goal.
      if (action.plan.goalTitle !== state.momentumProfile.goalTitle) {
        return { ...state, momentumPlanStatus: "ready", momentumPlanError: null };
      }
      return {
        ...state,
        momentumPlan: action.plan,
        momentumPlanStatus: "ready",
        momentumPlanError: null,
      };
    case "requestMomentumPlanFailed":
      // Same stale-goal rule as success: a failure for the old goal says nothing
      // about the new one.
      if (action.goalTitle !== state.momentumProfile.goalTitle) {
        return { ...state, momentumPlanStatus: "ready", momentumPlanError: null };
      }
      return {
        ...state,
        // Keep whatever ideas are showing; only fall back when there are none.
        momentumPlan: planAfterAiFailure(state.momentumPlan, () =>
          buildFallbackMomentumPlan({
            profile: state.momentumProfile,
            history: state.history,
            settings: state.momentumSettings,
            now: action.now,
          }),
        ),
        momentumPlanStatus: "error",
        momentumPlanError: action.kind,
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
    case "acknowledgeLevelUp":
      return { ...state, journey: acknowledgeLevel(state.journey) };
    case "acknowledgeMilestoneCelebration":
      if (state.pendingMilestoneCelebration === null) return state;
      return { ...state, pendingMilestoneCelebration: null };
    case "selectJourneyCosmetic": {
      const isUnlocked = unlockedCosmetics(state.journey).some(
        (cosmetic) => cosmetic.id === action.id,
      );
      if (!isUnlocked || state.journey.selectedCosmeticId === action.id) return state;
      return { ...state, journey: { ...state.journey, selectedCosmeticId: action.id } };
    }
    case "reset":
      // Resetting data must not take away an early supporter's free Plus, or
      // quietly turn analytics back on after the user switched it off.
      return {
        ...action.state,
        plusGrandfathered: action.state.plusGrandfathered || state.plusGrandfathered,
        analyticsEnabled: state.analyticsEnabled && action.state.analyticsEnabled,
      };
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
  unlockToday: () => void;
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
  journeyLevel: number;
  journeyProgress: LevelProgress;
  pendingLevelUp: number | null;
  acknowledgeLevelUp: () => void;
  selectJourneyCosmetic: (id: string) => void;
  momentumMilestones: MilestoneView[];
  pendingMilestoneCelebration: string | null;
  acknowledgeMilestoneCelebration: () => void;
  markReviewPrompted: () => void;
  parkTasks: (texts: string[]) => void;
  removeParkedTask: (id: string) => void;
  addParkedTask: (id: string) => void;
  setTaskSteps: (taskId: TaskId, texts: string[], forText?: string) => void;
  toggleTaskStep: (taskId: TaskId, stepId: string) => void;
  clearTaskSteps: (taskId: TaskId) => void;
  /** Plus features (AI helpers) are available: see hasPlusAccess. */
  hasPlus: boolean;
  setAnalyticsEnabled: (enabled: boolean) => void;
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
  // Bumped after applying widget taps so the widget is always rewritten from
  // app state (it may be showing an optimistic tap the app didn't apply).
  const [widgetNonce, setWidgetNonce] = useState(0);
  // Read the widget's queued taps and apply them. Called before every
  // rollover (launch, foreground, day change) so a tap from yesterday lands
  // on yesterday.
  const syncWidgetTaps = useCallback(() => {
    const { raw, processedSeq } = readWidgetToggles();
    const toggles = parseWidgetToggles(raw, processedSeq);
    if (toggles.length === 0) return;
    dispatch({ type: "applyWidgetToggles", toggles });
    markWidgetTogglesProcessed(lastSeq(toggles, processedSeq));
    invalidateWidgetSnapshot();
    setWidgetNonce((n) => n + 1);
  }, []);
  const plus = usePlus();
  // Confirmed access: what the automatic AI fetch waits for.
  const plusConfirmed = hasPlusAccess({
    paywallEnabled: plus.paywallEnabled,
    grandfathered: state.plusGrandfathered,
    entitlementActive: plus.entitlementActive,
  });
  // Until RevenueCat answers, don't gate: a subscriber must never be shown the
  // paywall (or a downgraded feature) just because the check is still running.
  const plusPending = plus.paywallEnabled && !plus.entitlementKnown && !state.plusGrandfathered;
  const hasPlus = plusConfirmed || plusPending;

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
      syncWidgetTaps();
      dispatch({ type: "rollover", today: baseToday });
      setNotificationPermission(permission);
      setToday(baseToday);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [syncWidgetTaps]);

  useEffect(() => {
    if (!ready) return;
    void saveState(state);
  }, [ready, state]);

  // Anyone using a build without a paywall is an early user: once a paywall
  // build arrives they keep Plus. (Keyed on the build having a RevenueCat key,
  // not on the SDK starting, so a broken SDK never grants Plus for good.)
  // Only iOS releases before the paywall version count (Android has no
  // paywall yet, and a later build missing the key must not give Plus away).
  useEffect(() => {
    if (!ready || plus.paywallBuild || state.plusGrandfathered) return;
    if (Platform.OS !== "ios") return;
    if (compareVersions(getCurrentVersion(), GRANDFATHER_BEFORE_VERSION) >= 0) return;
    dispatch({ type: "grandfatherPlus" });
  }, [ready, plus.paywallBuild, state.plusGrandfathered]);

  useEffect(() => {
    if (!ready) return;
    applyAnalyticsEnabled(state.analyticsEnabled);
  }, [ready, state.analyticsEnabled]);

  // Keep the home/lock-screen widget in step with today's tasks.
  const widgetStreak = useMemo(() => computeDayStreak(state.history, today), [state.history, today]);
  useEffect(() => {
    if (!ready) return;
    writeWidgetSnapshot(
      // Confirmed Plus only: "still checking" must not make a free user's
      // widget interactive (it may stay that way until the next launch).
      buildWidgetSnapshot({ state, today, streak: widgetStreak, plus: plusConfirmed }),
    );
    // Only these fields feed the snapshot (widgetNonce forces a rewrite).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.tasks, state.todayCompletions, today, widgetStreak, plusConfirmed, widgetNonce]);

  // One "app_opened" per day this app is used (drives D1/D7/D30 retention).
  const openedTracked = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || plusPending || openedTracked.current === today) return;
    openedTracked.current = today;
    track("app_opened", { plus: plusConfirmed });
  }, [ready, today, plusPending, plusConfirmed]);

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

  const completedCount = countCompleted(state);
  const remainingSlots = Math.max(0, MAX_TASKS - state.tasks.length);

  useEffect(() => {
    if (!ready) return;
    const eligible = autoLockEligibleTaskCount(state.tasks, today, state.autoLock);
    if (!shouldAutoLockToday(new Date(), eligible, state.todayLocked, state.autoLock)) return;
    dispatch({ type: "autoLockToday", today, at: scheduledAutoLockAt(today, state.autoLock) });
  }, [ready, state.autoLock, state.tasks, state.todayLocked, today]);

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
      // Widget taps first, so they land on the day they were made.
      syncWidgetTaps();
      const fresh = todayKey();
      if (fresh !== today) {
        setToday(fresh);
        dispatch({ type: "rollover", today: fresh });
        return;
      }
      const eligible = autoLockEligibleTaskCount(state.tasks, fresh, state.autoLock);
      if (shouldAutoLockToday(new Date(), eligible, state.todayLocked, state.autoLock)) {
        dispatch({ type: "autoLockToday", today: fresh, at: scheduledAutoLockAt(fresh, state.autoLock) });
      }
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refreshNotificationPermission, syncWidgetTaps, state.autoLock, state.tasks, state.todayLocked, today]);

  useEffect(() => {
    const id = setInterval(() => {
      const fresh = todayKey();
      if (fresh !== today) {
        syncWidgetTaps();
        setToday(fresh);
        dispatch({ type: "rollover", today: fresh });
        return;
      }
      const eligible = autoLockEligibleTaskCount(state.tasks, fresh, state.autoLock);
      if (shouldAutoLockToday(new Date(), eligible, state.todayLocked, state.autoLock)) {
        dispatch({ type: "autoLockToday", today: fresh, at: scheduledAutoLockAt(fresh, state.autoLock) });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [syncWidgetTaps, state.autoLock, state.tasks, state.todayLocked, today]);

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
    dispatch({ type: "lockToday", today: todayKey(), at: new Date().toISOString() });
  }, []);
  const unlockToday = useCallback(() => {
    dispatch({ type: "unlockToday", today: todayKey() });
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
  // In memory only: after a restart a restored transient error retries on the
  // first foreground, which is intended (the network may have recovered).
  const lastAiFailureAt = useRef<number | null>(null);
  // Only the most recent request may update state: an older one that finishes
  // late (e.g. started before a goal edit) must not overwrite a newer result
  // or flip "loading" off while the newer request is still in flight.
  const latestAiRequest = useRef(0);
  const requestMomentumPlan = useCallback(async () => {
    // AI ideas are a Plus feature; free users keep the on-device template plan.
    if (!hasPlus) return;
    const requestId = ++latestAiRequest.current;
    dispatch({ type: "requestMomentumPlanStarted" });
    const now = new Date();
    try {
      const plan = await requestMomentumAiPlan({
        profile: state.momentumProfile,
        history: state.history,
        settings: state.momentumSettings,
        now,
      });
      if (!isLatestRequest(requestId, latestAiRequest.current)) return;
      dispatch({ type: "requestMomentumPlanSucceeded", plan });
    } catch (error) {
      if (!isLatestRequest(requestId, latestAiRequest.current)) return;
      lastAiFailureAt.current = Date.now();
      dispatch({
        type: "requestMomentumPlanFailed",
        kind: classifyAiFailure(error),
        goalTitle: state.momentumProfile.goalTitle,
        now,
      });
    }
  }, [hasPlus, state.history, state.momentumProfile, state.momentumSettings]);

  // Auto-generate the AI plan once per (day + goal) when a proxy URL is
  // configured. No URL → this is a no-op and the app stays on the local
  // template plan. Failures fall back to the template via requestMomentumPlan.
  const lastAiPlanFetch = useRef<string | null>(null);
  useEffect(() => {
    const key = nextAiPlanFetchKey({
      ready,
      // Wait for Plus (the entitlement may still be loading at launch).
      proxyUrl: plusConfirmed ? getMomentumAiProxyUrl() : null,
      profileComplete: isMomentumProfileComplete(state.momentumProfile),
      status: state.momentumPlanStatus,
      today,
      goalTitle: state.momentumProfile.goalTitle,
      lastFetchedKey: lastAiPlanFetch.current,
      hasFreshAiPlan: isFreshAiPlan(state.momentumPlan, state.momentumProfile.goalTitle, today),
    });
    if (!key) return;
    lastAiPlanFetch.current = key;
    void requestMomentumPlan();
  }, [
    ready,
    plusConfirmed,
    today,
    state.momentumProfile,
    state.momentumPlan,
    state.momentumPlanStatus,
    requestMomentumPlan,
  ]);

  // After a transient failure (timeout, network, cold server), retry when the
  // user comes back to the app, at most once per cooldown.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status !== "active") return;
      // A new day is handled by the rollover (which fetches a fresh plan); a
      // retry for yesterday's failure would just be a wasted call.
      if (todayKey() !== today) return;
      if (
        shouldRetryAiOnForeground({
          status: state.momentumPlanStatus,
          failureKind: state.momentumPlanError,
          lastFailureAt: lastAiFailureAt.current,
          now: Date.now(),
        })
      ) {
        void requestMomentumPlan();
      }
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [state.momentumPlanStatus, state.momentumPlanError, requestMomentumPlan, today]);

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
    await Promise.all([clearState(), resetAnalyticsIdentity()]);
    dispatch({ type: "reset", state: buildInitialState() });
  }, []);
  const acknowledgeLevelUp = useCallback(() => {
    dispatch({ type: "acknowledgeLevelUp" });
  }, []);
  const selectJourneyCosmetic = useCallback((id: string) => {
    dispatch({ type: "selectJourneyCosmetic", id });
  }, []);
  const acknowledgeMilestoneCelebration = useCallback(() => {
    dispatch({ type: "acknowledgeMilestoneCelebration" });
  }, []);
  const markReviewPrompted = useCallback(() => {
    dispatch({ type: "markReviewPrompted", at: new Date().toISOString() });
  }, []);
  const parkTasksCb = useCallback((texts: string[]) => {
    dispatch({ type: "parkTasks", texts, at: new Date().toISOString() });
  }, []);
  const removeParkedTaskCb = useCallback((id: string) => {
    dispatch({ type: "removeParkedTask", id });
  }, []);
  const addParkedTask = useCallback((id: string) => {
    dispatch({ type: "addParkedTask", id, today: todayKey() });
  }, []);
  const setTaskStepsCb = useCallback((taskId: TaskId, texts: string[], forText?: string) => {
    dispatch({
      type: "setTaskSteps",
      taskId,
      texts,
      at: new Date().toISOString(),
      forText,
      today: todayKey(),
    });
  }, []);
  const toggleTaskStepCb = useCallback((taskId: TaskId, stepId: string) => {
    dispatch({ type: "toggleTaskStep", taskId, stepId, today: todayKey() });
  }, []);
  const clearTaskStepsCb = useCallback((taskId: TaskId) => {
    dispatch({ type: "clearTaskSteps", taskId, today: todayKey() });
  }, []);
  const setAnalyticsEnabledCb = useCallback((enabled: boolean) => {
    // Apply immediately so nothing queued is sent after opting out.
    applyAnalyticsEnabled(enabled);
    dispatch({ type: "setAnalyticsEnabled", enabled });
  }, []);

  const journeyLevel = levelForXp(state.journey.xp);
  const journeyProgress = levelProgress(state.journey.xp);
  const pendingLevelUpValue = pendingLevelUp(state.journey);
  const momentumMilestones = useMemo<MilestoneView[]>(
    () =>
      milestonesWithCompletion(
        state.momentumPlan?.milestones ?? [],
        state.completedMilestoneIds,
      ),
    [state.momentumPlan, state.completedMilestoneIds],
  );

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
      unlockToday,
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
      journeyLevel,
      journeyProgress,
      pendingLevelUp: pendingLevelUpValue,
      acknowledgeLevelUp,
      selectJourneyCosmetic,
      momentumMilestones,
      pendingMilestoneCelebration: state.pendingMilestoneCelebration,
      acknowledgeMilestoneCelebration,
      markReviewPrompted,
      parkTasks: parkTasksCb,
      removeParkedTask: removeParkedTaskCb,
      addParkedTask,
      setTaskSteps: setTaskStepsCb,
      toggleTaskStep: toggleTaskStepCb,
      clearTaskSteps: clearTaskStepsCb,
      hasPlus,
      setAnalyticsEnabled: setAnalyticsEnabledCb,
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
      unlockToday,
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
      journeyLevel,
      journeyProgress,
      pendingLevelUpValue,
      acknowledgeLevelUp,
      selectJourneyCosmetic,
      momentumMilestones,
      acknowledgeMilestoneCelebration,
      markReviewPrompted,
      parkTasksCb,
      removeParkedTaskCb,
      addParkedTask,
      setTaskStepsCb,
      toggleTaskStepCb,
      clearTaskStepsCb,
      hasPlus,
      setAnalyticsEnabledCb,
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
