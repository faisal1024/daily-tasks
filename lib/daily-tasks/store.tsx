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

import { storeDayFor, todayKey } from "./date";
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
  registerShowedUp,
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
import {
  buildInitialState,
  clearState,
  loadState,
  makeId,
  refreshBackup,
  saveState,
} from "./storage";
import { computeDayStreak } from "./streaks";
import type { EveningClose } from "./evening";
import { draftForNotification, draftForTomorrow } from "./evening";
import { readTodayAgenda } from "./agenda";
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
  | { type: "notToday"; id: TaskId; today: string; at: string }
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
  | { type: "markReviewDue"; at: string }
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
  | { type: "setEveningClose"; close: EveningClose; day: string; result: ReflectionResult }
  | { type: "applyTomorrowDraft"; tasks: string[]; shown: string[]; today: string; at: string }
  | { type: "dismissTomorrowDraft" }
  | { type: "setAgendaEnabled"; enabled: boolean }
  | { type: "completeMilestone"; id: string }
  | { type: "uncompleteMilestone"; id: string }
  | { type: "setAnalyticsEnabled"; enabled: boolean }
  | { type: "reset"; state: AppState };

/** Days with at least one task planned, counting today as a day ("Day N"). */
export function countDaysShowedUp(history: AppState["history"], today: string): number {
  let count = 0;
  for (const record of Object.values(history)) {
    if (record.date < today && record.total > 0) count += 1;
  }
  return count + 1;
}

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
      return { ...state, lastReviewPromptAt: action.at, reviewDueAt: null };
    case "markReviewDue":
      return state.reviewDueAt ? state : { ...state, reviewDueAt: action.at };
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
    case "setEveningClose":
      // `day` is the day the user closed (captured at the tap), so a reply
      // that lands after midnight still drafts for the right morning.
      return {
        ...state,
        tomorrowDraft: draftForTomorrow(action.close, action.day),
        // The on-device close has no memory to add; keep what the coach knows.
        coachMemory: action.close.memory ?? state.coachMemory,
        eveningClose: { date: action.day, result: action.result, note: action.close.note },
      };
    case "applyTomorrowDraft": {
      // Only what the card offered: tasks already on the list, finished or
      // dropped were filtered out of it and must not come back as saved.
      const leftovers = action.shown.filter((text) => !action.tasks.includes(text));
      const next = reducer(state, { type: "addTasks", texts: action.tasks, today: action.today });
      // What didn't fit is saved for later rather than lost.
      const withLeftovers = leftovers.length > 0 ? parkTasks(next, leftovers, action.at) : next;
      return { ...withLeftovers, tomorrowDraft: null };
    }
    case "setAgendaEnabled":
      return state.agendaEnabled === action.enabled ? state : { ...state, agendaEnabled: action.enabled };
    case "dismissTomorrowDraft":
      return state.tomorrowDraft ? { ...state, tomorrowDraft: null } : state;
    case "completeMilestone": {
      // Milestones are the user's to tick when they've really got there.
      const advanced = completeMilestoneState({
        milestones: state.momentumPlan?.milestones ?? [],
        completedMilestoneIds: state.completedMilestoneIds,
        journey: state.journey,
        id: action.id,
      });
      if (!advanced) return state;
      return {
        ...state,
        completedMilestoneIds: advanced.completedMilestoneIds,
        journey: advanced.journey,
        pendingMilestoneCelebration: advanced.pendingMilestoneCelebration,
      };
    }
    case "uncompleteMilestone": {
      // A mistaken tap should be reversible.
      if (!state.completedMilestoneIds.includes(action.id)) return state;
      return {
        ...state,
        completedMilestoneIds: state.completedMilestoneIds.filter((id) => id !== action.id),
      };
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
      if (!state.tasks.some((task) => task.id === action.taskId)) return state;
      const next = setTaskSteps(state, action.taskId, action.texts, action.at, action.forText);
      return next === state ? state : syncTodayHistory(next, action.today);
    }
    case "toggleTaskStep": {
      if (!state.tasks.some((task) => task.id === action.taskId)) return state;
      const next = toggleTaskStep(state, action.taskId, action.stepId);
      return next === state ? state : syncTodayHistory(next, action.today);
    }
    case "clearTaskSteps": {
      if (!state.tasks.some((task) => task.id === action.taskId)) return state;
      const next = clearTaskSteps(state, action.taskId);
      return next === state ? state : syncTodayHistory(next, action.today);
    }
    case "hydrate":
      return action.state;
    case "rollover": {
      const rolled = applyRollover(state, action.today);
      // A draft for a day that has already passed is no longer useful.
      const next =
        rolled !== state && rolled.tomorrowDraft && rolled.tomorrowDraft.forDate < action.today
          ? { ...rolled, tomorrowDraft: null }
          : rolled;
      // Held on the current day (clock a day behind): nothing changes, and
      // the plan mustn't be rebuilt for the earlier date.
      if (next === state && action.today !== state.lastOpenedDate) return state;
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
          // Planning counts as showing up (no need to finish anything first).
          journey: registerShowedUp(state.journey, action.today),
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
          journey: registerShowedUp(state.journey, action.today),
        },
        action.today,
      );
    }
    case "editTask": {
      if (state.todayLocked || !state.tasks.some((task) => task.id === action.id)) return state;
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
      if (state.todayLocked || !state.tasks.some((task) => task.id === action.id)) return state;
      return syncTodayHistory(
        {
          ...state,
          tasks: state.tasks.filter((task) => task.id !== action.id),
          todayCompletions: state.todayCompletions.filter((id) => id !== action.id),
        },
        action.today,
      );
    }
    case "notToday": {
      // Save an open task for later. Allowed on a set day too: letting go of
      // one task is part of keeping the day honest, not changing the plan.
      const task = state.tasks.find((item) => item.id === action.id);
      if (!task || state.todayCompletions.includes(action.id)) return state;
      // Off the list first: parkTasks skips anything still on today's list.
      const removed = { ...state, tasks: state.tasks.filter((item) => item.id !== action.id) };
      return syncTodayHistory(parkTasks(removed, [task.text], action.at), action.today);
    }
    case "toggleTask": {
      // Not one of today's tasks (e.g. it rolled over a moment ago): ignore,
      // or it would add a phantom completion and XP to the new day.
      if (!state.tasks.some((task) => task.id === action.id)) return state;
      const isCompleted = state.todayCompletions.includes(action.id);
      const todayCompletions = isCompleted
        ? state.todayCompletions.filter((id) => id !== action.id)
        : [...state.todayCompletions, action.id];

      const nextTasks = state.tasks.map((task) =>
        task.id === action.id && !isCompleted ? { ...task, carriedOver: false } : task,
      );

      let journey = state.journey;
      if (!isCompleted) {
        journey = awardTaskCompletion(journey, action.id, action.today);
        if (isPerfectDay({ ...state, tasks: nextTasks, todayCompletions })) {
          journey = awardPerfectDay(journey, action.today);
        }
      }
      // Milestones no longer advance on their own (a perfect day isn't the
      // same as reaching one): the user ticks them on the Progress tab.

      return syncTodayHistory(
        {
          ...state,
          todayCompletions,
          journey,
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
    case "resolveRollover": {
      const next = resolvePendingRollover(state, action.carriedTaskIds, action.now);
      // Carrying tasks into today is planning the day: it counts as showing up
      // (the "stuck" user carrying the same three is exactly who this is for).
      return next.tasks.length > state.tasks.length
        ? { ...next, journey: registerShowedUp(next.journey, action.today) }
        : next;
    }
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
          // Whole, in-range values only, whatever the picker sends.
          hour: Number.isFinite(action.hour)
            ? Math.min(23, Math.max(0, Math.round(action.hour)))
            : state.autoLock.hour,
          minute: Number.isFinite(action.minute)
            ? Math.min(59, Math.max(0, Math.round(action.minute)))
            : state.autoLock.minute,
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
  /** Take an open task off today and save it for later (works on a set day). */
  notToday: (id: TaskId) => void;
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
  markReviewDue: () => void;
  setEveningClose: (close: EveningClose, day: string, result: ReflectionResult) => void;
  /** `shown` is what the card offered; the unused rest is saved for later. */
  applyTomorrowDraft: (tasks: string[], shown: string[]) => void;
  dismissTomorrowDraft: () => void;
  setAgendaEnabled: (enabled: boolean) => void;
  completeMilestone: (id: string) => void;
  uncompleteMilestone: (id: string) => void;
  /** Days with a plan (today included): the "Day N" chip. */
  daysShowedUp: number;
  parkTasks: (texts: string[]) => void;
  removeParkedTask: (id: string) => void;
  addParkedTask: (id: string) => void;
  setTaskSteps: (taskId: TaskId, texts: string[], forText?: string) => void;
  toggleTaskStep: (taskId: TaskId, stepId: string) => void;
  clearTaskSteps: (taskId: TaskId) => void;
  /** Plus features (AI helpers) are available: see hasPlusAccess. */
  hasPlus: boolean;
  /** Plus confirmed (excludes "RevenueCat still answering"). */
  plusConfirmed: boolean;
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
  // Until saved state has loaded there is nothing to apply taps to, and marking
  // them processed would lose them (iOS often reports "active" during launch,
  // before loadState() resolves). The launch path syncs right after hydrate.
  const hydratedRef = useRef(false);
  const syncWidgetTaps = useCallback(() => {
    if (!hydratedRef.current) return;
    const { raw, processedSeq } = readWidgetToggles();
    const toggles = parseWidgetToggles(raw, processedSeq);
    if (toggles.length === 0) return;
    dispatch({ type: "applyWidgetToggles", toggles });
    // Everything read is marked handled, including taps the reducer ignores
    // (another day, a deleted task): those can never apply.
    markWidgetTogglesProcessed(lastSeq(toggles, processedSeq));
    invalidateWidgetSnapshot();
    setWidgetNonce((n) => n + 1);
  }, []);

  // The day the store's tasks belong to, readable from stable callbacks.
  const todayRef = useRef(today);
  todayRef.current = today;
  /**
   * Run the day change now if the clock has passed midnight since the last
   * check, and return the store's day. Actions stamp this, never the raw
   * clock: a tap at 00:00:10 (before the minute tick) must not write
   * yesterday's tasks into today's history. A clock that moved BACK (travel
   * west, a manual fix) keeps the current day instead of rolling "over" to
   * an earlier one.
   */
  const ensureDay = useCallback((): string => {
    if (!hydratedRef.current) return todayKey();
    const target = storeDayFor(todayRef.current, todayKey());
    if (target === todayRef.current) return target;
    // Widget taps first, so they land on the day they were made.
    syncWidgetTaps();
    todayRef.current = target;
    setToday(target);
    dispatch({ type: "rollover", today: target });
    return target;
  }, [syncWidgetTaps]);
  /** The clock has moved to a new day that the store hasn't switched to yet. */
  const dayChangePending = useCallback(
    () => hydratedRef.current && storeDayFor(todayRef.current, todayKey()) !== todayRef.current,
    [],
  );
  // Latest state for stable callbacks (e.g. is a task still on screen?).
  const stateRef = useRef(state);
  stateRef.current = state;
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
      const hydrated = stored ?? buildInitialState();
      dispatch({ type: "hydrate", state: hydrated });
      hydratedRef.current = true;
      syncWidgetTaps();
      // A clock a day behind the saved day keeps the saved day (see storeDayFor):
      // stamping the earlier date would overwrite that day's real history.
      const launchDay = storeDayFor(hydrated.lastOpenedDate, baseToday);
      dispatch({ type: "rollover", today: launchDay });
      setNotificationPermission(permission);
      todayRef.current = launchDay;
      setToday(launchDay);
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

  // Refresh the backup once this session has run fine for a while, and each
  // time the app goes to the background (state that crashes on launch never
  // gets that far, so it can't replace the good copy).
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void refreshBackup(), 30_000);
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "background") void refreshBackup();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [ready]);

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

  // Tomorrow's notification leaves out anything finished since the close.
  const notificationDraft = useMemo(
    () =>
      draftForNotification(state.tomorrowDraft, {
        today,
        tasks: state.tasks,
        completedIds: state.todayCompletions,
      }),
    [state.tomorrowDraft, state.tasks, state.todayCompletions, today],
  );

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
      draft: notificationDraft,
    });
    if (lastReminderSync.current === signature) return;
    lastReminderSync.current = signature;
    void syncNotifications({
      now: new Date(),
      settings: state.notifications,
      permissionState: notificationPermission,
      taskCount: state.tasks.length,
      completedCount,
      draft: notificationDraft,
    });
  }, [
    notificationDraft,
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
      const before = todayRef.current;
      const fresh = ensureDay();
      if (fresh !== before) return;
      const eligible = autoLockEligibleTaskCount(state.tasks, fresh, state.autoLock);
      if (shouldAutoLockToday(new Date(), eligible, state.todayLocked, state.autoLock)) {
        dispatch({ type: "autoLockToday", today: fresh, at: scheduledAutoLockAt(fresh, state.autoLock) });
      }
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refreshNotificationPermission, syncWidgetTaps, ensureDay, state.autoLock, state.tasks, state.todayLocked]);

  useEffect(() => {
    const id = setInterval(() => {
      const before = todayRef.current;
      const fresh = ensureDay();
      if (fresh !== before) return;
      const eligible = autoLockEligibleTaskCount(state.tasks, fresh, state.autoLock);
      if (shouldAutoLockToday(new Date(), eligible, state.todayLocked, state.autoLock)) {
        dispatch({ type: "autoLockToday", today: fresh, at: scheduledAutoLockAt(fresh, state.autoLock) });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [ensureDay, state.autoLock, state.tasks, state.todayLocked]);

  const isCompleted = useCallback(
    (id: TaskId) => state.todayCompletions.includes(id),
    [state.todayCompletions],
  );

  const addTask = useCallback((text: string) => {
    dispatch({ type: "addTask", text, today: ensureDay() });
  }, [ensureDay]);
  const addTasks = useCallback((texts: string[]) => {
    dispatch({ type: "addTasks", texts, today: ensureDay() });
  }, [ensureDay]);
  const editTask = useCallback((id: TaskId, text: string) => {
    dispatch({ type: "editTask", id, text, today: ensureDay() });
  }, [ensureDay]);
  const deleteTask = useCallback((id: TaskId) => {
    dispatch({ type: "deleteTask", id, today: ensureDay() });
  }, [ensureDay]);
  const notToday = useCallback((id: TaskId) => {
    dispatch({ type: "notToday", id, today: ensureDay(), at: new Date().toISOString() });
  }, [ensureDay]);
  const toggleTask = useCallback((id: TaskId) => {
    // Ticked just after midnight while yesterday is still on screen: it counts
    // for yesterday (the day the user was looking at), then the day changes.
    if (dayChangePending() && stateRef.current.tasks.some((task) => task.id === id)) {
      dispatch({ type: "toggleTask", id, today: todayRef.current });
      ensureDay();
      return;
    }
    dispatch({ type: "toggleTask", id, today: ensureDay() });
  }, [ensureDay, dayChangePending]);
  const lockToday = useCallback(() => {
    dispatch({ type: "lockToday", today: ensureDay(), at: new Date().toISOString() });
  }, [ensureDay]);
  const unlockToday = useCallback(() => {
    dispatch({ type: "unlockToday", today: ensureDay() });
  }, [ensureDay]);
  const resolveRollover = useCallback((carriedTaskIds: TaskId[]) => {
    dispatch({
      type: "resolveRollover",
      carriedTaskIds,
      today: ensureDay(),
      now: new Date(),
    });
  }, [ensureDay]);
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
      // Read fresh each time (events change); never blocks the plan on failure.
      const agenda = state.agendaEnabled ? await readTodayAgenda(now) : [];
      const plan = await requestMomentumAiPlan({
        profile: state.momentumProfile,
        history: state.history,
        settings: state.momentumSettings,
        coachMemory: state.coachMemory,
        agenda,
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
  }, [
    hasPlus,
    state.history,
    state.momentumProfile,
    state.momentumSettings,
    state.coachMemory,
    state.agendaEnabled,
  ]);

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
      if (storeDayFor(today, todayKey()) !== today) return;
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
  // The evening check-in belongs to the day it's about: saved just after
  // midnight with yesterday still on screen, it lands on yesterday.
  const setTodayReflection = useCallback((text: string) => {
    if (dayChangePending()) {
      dispatch({ type: "setTodayReflection", text, today: todayRef.current });
      ensureDay();
      return;
    }
    dispatch({ type: "setTodayReflection", text, today: ensureDay() });
  }, [ensureDay, dayChangePending]);
  const setTodayReflectionResult = useCallback((result: ReflectionResult) => {
    if (dayChangePending()) {
      dispatch({ type: "setTodayReflectionResult", result, today: todayRef.current, now: new Date() });
      ensureDay();
      return;
    }
    dispatch({ type: "setTodayReflectionResult", result, today: ensureDay(), now: new Date() });
  }, [ensureDay, dayChangePending]);
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
  const markReviewDue = useCallback(() => {
    dispatch({ type: "markReviewDue", at: new Date().toISOString() });
  }, []);
  const setEveningClose = useCallback(
    (close: EveningClose, day: string, result: ReflectionResult) => {
      dispatch({ type: "setEveningClose", close, day, result });
    },
    [],
  );
  const applyTomorrowDraft = useCallback((tasks: string[], shown: string[]) => {
    dispatch({
      type: "applyTomorrowDraft",
      tasks,
      shown,
      today: ensureDay(),
      at: new Date().toISOString(),
    });
  }, [ensureDay]);
  const setAgendaEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "setAgendaEnabled", enabled });
  }, []);
  const dismissTomorrowDraft = useCallback(() => {
    dispatch({ type: "dismissTomorrowDraft" });
  }, []);
  const completeMilestone = useCallback((id: string) => {
    dispatch({ type: "completeMilestone", id });
  }, []);
  const uncompleteMilestone = useCallback((id: string) => {
    dispatch({ type: "uncompleteMilestone", id });
  }, []);
  const daysShowedUp = useMemo(
    () => countDaysShowedUp(state.history, today),
    [state.history, today],
  );
  const parkTasksCb = useCallback((texts: string[]) => {
    dispatch({ type: "parkTasks", texts, at: new Date().toISOString() });
  }, []);
  const removeParkedTaskCb = useCallback((id: string) => {
    dispatch({ type: "removeParkedTask", id });
  }, []);
  const addParkedTask = useCallback((id: string) => {
    dispatch({ type: "addParkedTask", id, today: ensureDay() });
  }, [ensureDay]);
  const setTaskStepsCb = useCallback((taskId: TaskId, texts: string[], forText?: string) => {
    dispatch({
      type: "setTaskSteps",
      taskId,
      texts,
      at: new Date().toISOString(),
      forText,
      today: ensureDay(),
    });
  }, [ensureDay]);
  const toggleTaskStepCb = useCallback((taskId: TaskId, stepId: string) => {
    dispatch({ type: "toggleTaskStep", taskId, stepId, today: ensureDay() });
  }, [ensureDay]);
  const clearTaskStepsCb = useCallback((taskId: TaskId) => {
    dispatch({ type: "clearTaskSteps", taskId, today: ensureDay() });
  }, [ensureDay]);
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
      notToday,
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
      markReviewDue,
      setEveningClose,
      applyTomorrowDraft,
      dismissTomorrowDraft,
      setAgendaEnabled,
      completeMilestone,
      uncompleteMilestone,
      daysShowedUp,
      parkTasks: parkTasksCb,
      removeParkedTask: removeParkedTaskCb,
      addParkedTask,
      setTaskSteps: setTaskStepsCb,
      toggleTaskStep: toggleTaskStepCb,
      clearTaskSteps: clearTaskStepsCb,
      hasPlus,
      plusConfirmed,
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
      notToday,
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
      markReviewDue,
      setEveningClose,
      applyTomorrowDraft,
      dismissTomorrowDraft,
      setAgendaEnabled,
      completeMilestone,
      uncompleteMilestone,
      daysShowedUp,
      parkTasksCb,
      removeParkedTaskCb,
      addParkedTask,
      setTaskStepsCb,
      toggleTaskStepCb,
      clearTaskStepsCb,
      hasPlus,
      plusConfirmed,
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
