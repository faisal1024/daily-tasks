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
  cancelFocusTimerNotification,
  dismissFocusTimerNotification,
  getNotificationPermissionStatus,
  registerFocusCategory,
  requestNotificationPermission,
  scheduleFocusSessionNotification,
  subscribeFocusResponses,
  syncNotifications,
  type FocusNotificationResponse,
} from "./notifications";
import {
  clampSessionMinutes,
  extend as extendSession,
  keepGoing as keepGoingSession,
  notificationBody,
  notificationTitle,
  pause as pauseSession,
  restoreSession,
  resume as resumeSession,
  sessionForState,
  sessionMinutes,
  sessionPhase,
  settle as settleSession,
  startSession,
  STARTER_MINUTES,
  type FocusSession,
  type FocusSessionKind,
  type FocusSessionOutcome,
  type FocusSessionSource,
} from "./focus-session";
import {
  applyFocusCommands,
  lastCommandSeq,
  parseFocusCommands,
  type FocusCommand,
  type FocusCommandAction,
} from "./focus-commands";
import {
  DEFAULT_LINK_MINUTES,
  parseFocusStartRequest,
  planFocusStart,
  subscribeFocusStarts,
  takeFocusOpen,
  takeFocusStarts,
  type FocusStartRequest,
} from "./focus-link";
import { loadLastTimer } from "./focus-timer-storage";
import { isAppActive, useAppActive } from "@/hooks/use-app-active";
import { syncLiveActivity } from "./live-activity";
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
  unparkTexts,
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
  buildMilestones,
  buildMomentumPlan,
  isMomentumProfileComplete,
} from "./momentum";
import {
  applyRollover,
  resolvePendingRollover,
  settlePendingRollover,
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
  cleanMilestones,
  completeMilestone as completeMilestoneState,
  keepPath,
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
import { computeDayStreak, showedUp } from "./streaks";
import type { EveningClose } from "./evening";
import { claimCoachRequest, markCoachNoteLogged, mergeCoachNotes } from "./coach-note";
import { draftForNotification, draftForTomorrow } from "./evening";
import { readTodayAgenda } from "./agenda";
import { readSupporterGrant, writeSupporterGrant } from "./supporter-grant";
import { navigateToToday } from "./navigation";
import { requestSupporterGrant, setProxyGrandfathered } from "./ai-client";
import {
  invalidateFocusSession,
  invalidateWidgetSnapshot,
  markFocusCommandsProcessed,
  markFocusStartRequestHandled,
  markWidgetTogglesProcessed,
  readFocusCommands,
  readFocusStartRequest,
  readWidgetToggles,
  writeFocusSession,
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
  CoachNoteLines,
  MomentumProfile,
  NotificationPermissionState,
  NotificationKey,
  ReflectionResult,
  ReviewTrigger,
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
  | { type: "markReviewDue"; at: string; source: ReviewTrigger }
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
  | { type: "claimCoachRequest"; day: string; taskTexts: string[] }
  | { type: "setCoachNotes"; day: string; notes: Record<string, CoachNoteLines>; today: string }
  | { type: "markCoachNoteLogged"; day: string; today: string }
  | { type: "completeMilestone"; id: string }
  | { type: "setMilestones"; items: { id?: string; title: string; description?: string }[] }
  | { type: "requestNewPath" }
  | { type: "resetPathToTemplate" }
  | { type: "uncompleteMilestone"; id: string }
  | { type: "setAnalyticsEnabled"; enabled: boolean }
  | {
      type: "startFocusSession";
      id: string;
      taskId: TaskId;
      kind: FocusSessionKind;
      minutes: number;
      stepText: string | null;
      today: string;
      now: number;
    }
  | { type: "pauseFocusSession"; now: number }
  | { type: "resumeFocusSession"; now: number }
  | { type: "extendFocusSession"; now: number }
  | { type: "keepGoingFocusSession"; now: number }
  | { type: "settleFocusSession"; now: number }
  | { type: "clearFocusSession" }
  | { type: "applyFocusCommands"; commands: FocusCommand[]; now: number }
  | { type: "reset"; state: AppState };

/** Days shown up (the shared `showedUp` rule), counting today as a day ("Day N"). */
export function countDaysShowedUp(history: AppState["history"], today: string): number {
  let count = 0;
  for (const record of Object.values(history)) {
    if (record.date < today && showedUp(record)) count += 1;
  }
  return count + 1;
}

/** Canonical count of today's completions that still map to a current task. */
function countCompleted(state: AppState): number {
  return state.todayCompletions.filter((id) =>
    state.tasks.some((task) => task.id === id),
  ).length;
}

/**
 * Ticks from outside the app, once they're applied (1.3): task_completed with
 * where it came from, and live_activity_action for a Done on the Live
 * Activity. Only taps that change something count (the last one per task).
 */
function trackAppliedTaps(before: AppState, toggles: WidgetToggle[]): void {
  const day = before.lastOpenedDate;
  const flipped = new Set(tasksToFlip(before, toggles, day));
  const last = new Map<TaskId, WidgetToggle>();
  for (const toggle of toggles) if (toggle.date === day) last.set(toggle.id, toggle);
  let count = countCompleted(before);
  for (const [id, toggle] of last) {
    if (!flipped.has(id) || !toggle.done) continue;
    count += 1;
    const source = toggle.source === "live_activity" ? "live_activity" : "widget";
    track("task_completed", { count, source });
    if (source === "live_activity") track("live_activity_action", { action: "done" });
  }
  // A Done on the lock screen answers the "Time's up" that went off: it
  // mustn't linger (the activity's intent clears it too, when it can).
  if (toggles.some((toggle) => toggle.source === "live_activity" && toggle.done)) void dismissFocusTimerNotification();
}

/**
 * The Live Activity's Pause / Resume / 5 more minutes / Take a break, once
 * applied. A break's focus_session_ended is sent here only at launch
 * (`breakEndedHere`); while the app runs, the session-ended effect sends it.
 */
function trackCommands(
  before: FocusSession | null,
  applied: FocusCommandAction[],
  breakEndedHere = false,
): void {
  for (const action of applied) {
    track("live_activity_action", { action });
    // Like the app's own "5 more minutes" / "Keep going": that countdown ended.
    if (action === "extend" && before) track("focus_session_ended", { outcome: "extended", minutes: sessionMinutes(before) });
    if (action === "break" && before && breakEndedHere) {
      track("focus_session_ended", { outcome: "break", minutes: sessionMinutes(before) });
    }
  }
  // No dismiss here: the intent already removed the answered "Time's up",
  // and by the time the app applies the tap the extended countdown may have
  // ended too, with a fresh, unanswered one that must stay.
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
  const next = keepGoalPath(state, action, reduce(state, action));
  // Today changed under yesterday's card (a draft, a brain dump, setting the
  // day): drop what's now covered or has no room. See settlePendingRollover.
  const settled =
    next.pendingRollover && (next.tasks !== state.tasks || next.todayLocked !== state.todayLocked)
      ? settlePendingRollover(next)
      : next;
  return keepFocusSession(settled);
}

/**
 * The focus session goes when its task is ticked (from anywhere, the widget
 * included), deleted or saved for later, and when the day changes; an edit
 * updates its words. See sessionForState.
 */
function keepFocusSession(state: AppState): AppState {
  if (!state.focusSession) return state;
  const focusSession = sessionForState(state.focusSession, state);
  return focusSession === state.focusSession ? state : { ...state, focusSession };
}

/** The focus session's actions (1.3): each one only changes the session. */
function reduceFocusSession(state: AppState, action: Action): FocusSession | null {
  const session = state.focusSession;
  switch (action.type) {
    case "startFocusSession": {
      // One of today's open tasks only; it replaces any other session.
      const task = state.tasks.find((item) => item.id === action.taskId);
      if (!task || state.todayCompletions.includes(task.id) || action.today !== state.lastOpenedDate) return session;
      return startSession({
        id: action.id,
        taskId: task.id,
        taskText: task.text,
        stepText: action.stepText,
        date: action.today,
        kind: action.kind,
        minutes: action.minutes,
        now: action.now,
      });
    }
    case "pauseFocusSession":
      return session && pauseSession(session, action.now);
    case "resumeFocusSession":
      return session && resumeSession(session, action.now);
    case "extendFocusSession":
      return session && extendSession(session, action.now);
    case "keepGoingFocusSession":
      return session && keepGoingSession(session, action.now);
    case "settleFocusSession":
      return session && settleSession(session, action.now);
    case "clearFocusSession":
      return null;
    case "applyFocusCommands":
      return applyFocusCommands(session, action.commands, action.now).session;
    default:
      return session;
  }
}

/**
 * Daily idea refreshes rebuild the plan; the path toward the goal must not
 * change with them. Keep the milestones unless the user edited them, asked for
 * a new path (then the next AI plan brings one, and old ticks reset), or the
 * goal itself changed (keepPath compares goals).
 */
function keepGoalPath(state: AppState, action: Action, next: AppState): AppState {
  // A new-path request ends with any answer, and with a goal change or an edit.
  let out = next;
  const settlesRequest =
    action.type === "requestMomentumPlanSucceeded" ||
    action.type === "requestMomentumPlanFailed" ||
    action.type === "setMilestones" ||
    action.type === "resetPathToTemplate" ||
    next.momentumProfile.goalTitle !== state.momentumProfile.goalTitle;
  if (settlesRequest && out.pathRefreshPending) out = { ...out, pathRefreshPending: false };
  if (action.type === "setMilestones" || action.type === "resetPathToTemplate") return out;
  if (out.momentumPlan === state.momentumPlan) return out;
  if (
    action.type === "requestMomentumPlanSucceeded" &&
    state.pathRefreshPending &&
    state.momentumPlan &&
    out.momentumPlan?.goalTitle === state.momentumPlan.goalTitle
  ) {
    // The fresh path the user asked for: it replaces theirs, and old ticks go.
    return {
      ...out,
      momentumPlan: { ...out.momentumPlan, pathSource: "ai" },
      completedMilestoneIds: [],
      pendingMilestoneCelebration: null,
    };
  }
  const plan = keepPath(state.momentumPlan, out.momentumPlan);
  return plan === out.momentumPlan ? out : { ...out, momentumPlan: plan };
}

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "startFocusSession":
    case "pauseFocusSession":
    case "resumeFocusSession":
    case "extendFocusSession":
    case "keepGoingFocusSession":
    case "settleFocusSession":
    case "clearFocusSession":
    case "applyFocusCommands": {
      const focusSession = reduceFocusSession(state, action);
      return focusSession === state.focusSession ? state : { ...state, focusSession };
    }
    case "markReviewPrompted":
      return { ...state, lastReviewPromptAt: action.at, reviewDueAt: null, reviewDueSource: null };
    case "markReviewDue":
      // The first happy moment keeps the ask (and its source); later ones
      // don't push it further out.
      return state.reviewDueAt
        ? state
        : { ...state, reviewDueAt: action.at, reviewDueSource: action.source };
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
      // Ticked ones now on Today leave Saved for later (no copy in both).
      const added = next.tasks.slice(state.tasks.length).map((task) => task.text);
      const unparked = unparkTexts(next, added);
      // Ticked ones addTasks couldn't take (day set, room changed) are kept too.
      const addedKeys = new Set(added.map((text) => text.trim().toLowerCase()));
      const notAdded = action.tasks.filter((text) => !addedKeys.has(text.trim().toLowerCase()));
      // What didn't fit is saved for later rather than lost.
      const toPark = [...notAdded, ...leftovers];
      const withLeftovers = toPark.length > 0 ? parkTasks(unparked, toPark, action.at) : unparked;
      return { ...withLeftovers, tomorrowDraft: null };
    }
    case "setAgendaEnabled":
      return state.agendaEnabled === action.enabled ? state : { ...state, agendaEnabled: action.enabled };
    // The Coach's note cache (see coach-note.ts): `day` is the day the call
    // was made for; a reply (or mark) for any day but today is dropped, so one
    // that lands after midnight can't recreate yesterday's cache.
    case "claimCoachRequest": {
      const coachNotes = claimCoachRequest(state.coachNotes, action.day, action.taskTexts);
      return coachNotes === state.coachNotes ? state : { ...state, coachNotes };
    }
    case "setCoachNotes": {
      const coachNotes = mergeCoachNotes(state.coachNotes, action.day, action.notes, action.today);
      return coachNotes === state.coachNotes ? state : { ...state, coachNotes };
    }
    case "markCoachNoteLogged": {
      const coachNotes = markCoachNoteLogged(state.coachNotes, action.day, action.today);
      return coachNotes === state.coachNotes ? state : { ...state, coachNotes };
    }
    case "setMilestones": {
      if (!state.momentumPlan) return state;
      const before = new Map(state.momentumPlan.milestones.map((m) => [m.id, m]));
      const milestones = cleanMilestones(
        action.items.map((item) => ({ ...item, completedAt: item.id ? before.get(item.id)?.completedAt : null })),
      );
      if (milestones.length === 0) return state;
      const ids = new Set(milestones.map((m) => m.id));
      const celebrated = state.pendingMilestoneCelebration;
      return {
        ...state,
        momentumPlan: { ...state.momentumPlan, milestones, pathSource: "user" },
        // A removed step's tick (and pending celebration) goes with it.
        completedMilestoneIds: state.completedMilestoneIds.filter((id) => ids.has(id)),
        pendingMilestoneCelebration:
          celebrated && !milestones.some((m) => m.title === celebrated) ? null : celebrated,
      };
    }
    case "requestNewPath":
      return state.pathRefreshPending ? state : { ...state, pathRefreshPending: true };
    case "resetPathToTemplate":
      if (!state.momentumPlan) return state;
      return {
        ...state,
        momentumPlan: { ...state.momentumPlan, pathSource: "template", milestones: buildMilestones(state.momentumProfile.goalTitle ?? state.momentumPlan.goalTitle ?? "your goal") },
        completedMilestoneIds: [],
        pendingMilestoneCelebration: null,
      };
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
      // The live list is the saved day's list: if its history record ever
      // drifted (an old build, a bad save), repair it now, before a rollover
      // archives the stale copy as that day's history.
      return syncTodayHistory(action.state, action.state.lastOpenedDate);
    case "rollover": {
      const rolled = applyRollover(state, action.today);
      // A draft for a day that has already passed is no longer useful.
      const undrafted =
        rolled !== state && rolled.tomorrowDraft && rolled.tomorrowDraft.forDate < action.today
          ? { ...rolled, tomorrowDraft: null }
          : rolled;
      // Yesterday's coach lines (and their call count) don't carry over.
      const next =
        undrafted !== state && undrafted.coachNotes && undrafted.coachNotes.date < action.today
          ? { ...undrafted, coachNotes: null }
          : undrafted;
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
  requestMomentumPlan: (options?: { newPath?: boolean }) => Promise<void>;
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
  /** A happy moment (`source`) earned a rating ask, shown on a later app open. */
  markReviewDue: (source: ReviewTrigger) => void;
  /**
   * Bumped each time a focus session ends with its task done (the same
   * moment as focus_session_ended {outcome: "done"}) while the app runs.
   */
  focusDoneCount: number;
  setEveningClose: (close: EveningClose, day: string, result: ReflectionResult) => void;
  /** `shown` is what the card offered; the unused rest is saved for later. */
  applyTomorrowDraft: (tasks: string[], shown: string[]) => void;
  dismissTomorrowDraft: () => void;
  setAgendaEnabled: (enabled: boolean) => void;
  /** Count a Coach's note AI call (made now, on the store's day) and the task texts it asks about. */
  claimCoachRequest: (taskTexts: string[]) => void;
  /** Keep the Coach's note AI lines for `day`, keyed by task text. */
  setCoachNotes: (day: string, notes: Record<string, CoachNoteLines>) => void;
  /** coach_note_loaded went out for `day`. */
  markCoachNoteLogged: (day: string) => void;
  completeMilestone: (id: string) => void;
  uncompleteMilestone: (id: string) => void;
  /** Save an edited path (rename, reword, add, remove). */
  editMilestones: (items: { id?: string; title: string; description?: string }[]) => void;
  /** Replace the path: a fresh AI path with Plus, else the starter template. Resets its ticks. */
  suggestNewPath: () => void;
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
  /** RevenueCat hasn't answered yet (Plus status unknown). */
  plusPending: boolean;
  setAnalyticsEnabled: (enabled: boolean) => void;
  /**
   * Start a focus session on one of today's open tasks (1.3), replacing any
   * other. A starter is 5 minutes; `stepText` names the step it's on.
   */
  startFocusSession: (
    taskId: TaskId,
    options: { kind: FocusSessionKind; minutes: number; source: FocusSessionSource; stepText?: string | null },
  ) => void;
  /**
   * Pause / Resume: true when it changed anything. Only a running session
   * pauses and only a paused one resumes (a menu opened before time's up
   * can't pause an ended session); one that just ran out ends instead.
   */
  pauseFocusSession: () => boolean;
  resumeFocusSession: () => boolean;
  /** "5 more minutes". */
  extendFocusSession: () => void;
  /** A starter's "Keep going": a 20-minute timer on the same task. */
  keepGoingFocusSession: () => void;
  /** Stop and clear it (Stop timer, Take a break, or on to a break-down); the task stays open. */
  stopFocusSession: (outcome: Extract<FocusSessionOutcome, "stopped" | "break" | "broken_down">) => void;
  /**
   * A task's focus screen to open from outside: start my next task (widget,
   * Siri) with another task's timer on, a tap on the Live Activity, or a tap
   * on the end notification with its check-in due. Cleared with
   * clearFocusPrompt once shown.
   */
  focusPrompt: { taskId: TaskId; source: "widget" | "siri" | "live_activity" | "notification"; nonce: number } | null;
  clearFocusPrompt: () => void;
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
  // `base` is the state the taps apply to when it isn't rendered yet (launch).
  const syncWidgetTaps = useCallback((base?: AppState) => {
    if (!hydratedRef.current) return;
    const { raw, processedSeq } = readWidgetToggles();
    const toggles = parseWidgetToggles(raw, processedSeq);
    if (toggles.length === 0) return;
    const before = base ?? stateRef.current;
    dispatch({ type: "applyWidgetToggles", toggles });
    // Everything read is marked handled, including taps the reducer ignores
    // (another day, a deleted task): those can never apply.
    markWidgetTogglesProcessed(lastSeq(toggles, processedSeq));
    trackAppliedTaps(before, toggles);
    invalidateWidgetSnapshot();
    setWidgetNonce((n) => n + 1);
  }, []);
  // The Live Activity's Pause/Resume taps (1.3), applied before anything
  // settles the session: a pause on the lock screen before the end must not
  // come back as "time's up". Not before saved state has loaded (the launch
  // path applies them to the saved session itself).
  const syncFocusCommands = useCallback(() => {
    if (!hydratedRef.current) return;
    const { raw, processedSeq } = readFocusCommands();
    const commands = parseFocusCommands(raw, processedSeq);
    if (commands.length === 0) return;
    const now = Date.now();
    const before = stateRef.current.focusSession;
    const { applied } = applyFocusCommands(before, commands, now);
    // A lock-screen Take a break: the session-ended effect reports it as one.
    if (applied.includes("break")) focusOutcome.current = "break";
    dispatch({ type: "applyFocusCommands", commands, now });
    markFocusCommandsProcessed(lastCommandSeq(commands, processedSeq));
    // The activity wrote the mirror itself: rewrite it from the app's state,
    // even when nothing here changed (a stale tap must be undone there).
    invalidateFocusSession();
    setFocusMirrorNonce((n) => n + 1);
    trackCommands(before, applied);
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
  // The focus session as of the last start, before React has rendered it: two
  // starts in a row (a link and Siri's request) must see the first.
  const focusSessionRef = useRef(state.focusSession);
  focusSessionRef.current = state.focusSession;
  const [focusMirrorNonce, setFocusMirrorNonce] = useState(0);
  const appActive = useAppActive();
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
  // Early supporters have Plus here but not in RevenueCat: the AI proxy
  // allows requests without an id, so theirs don't send one.
  useEffect(() => {
    setProxyGrandfathered(state.plusGrandfathered);
  }, [state.plusGrandfathered]);
  // ...and once, on a paywall build, they claim lifetime Plus in RevenueCat;
  // after that they send their id like everyone else.
  useEffect(() => {
    if (!ready || !state.plusGrandfathered || !plus.paywallEnabled) return;
    let live = true;
    void (async () => {
      const previous = await readSupporterGrant();
      if (previous === "granted") {
        setProxyGrandfathered(false);
        return;
      }
      if (previous === "closed") return;
      const result = await requestSupporterGrant();
      if (!live) return;
      if (result !== "retry") await writeSupporterGrant(result);
      if (result === "granted") setProxyGrandfathered(false);
    })();
    return () => {
      live = false;
    };
  }, [ready, state.plusGrandfathered, plus.paywallEnabled]);
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
      const saved = stored ?? buildInitialState();
      // The Live Activity's Pause/Resume taps first (see syncFocusCommands),
      // then a timer that ran out while the app was closed is already ended
      // (see restoreSession).
      const now = Date.now();
      const { raw: commandsRaw, processedSeq: commandsSeq } = readFocusCommands();
      const commands = parseFocusCommands(commandsRaw, commandsSeq);
      const commanded = applyFocusCommands(saved.focusSession ?? null, commands, now);
      if (commands.length > 0) {
        markFocusCommandsProcessed(lastCommandSeq(commands, commandsSeq));
        invalidateFocusSession();
        trackCommands(saved.focusSession ?? null, commanded.applied, true);
      }
      const hydrated = commanded.session
        ? { ...saved, focusSession: restoreSession(commanded.session, now) }
        : { ...saved, focusSession: null };
      dispatch({ type: "hydrate", state: hydrated });
      hydratedRef.current = true;
      syncWidgetTaps(hydrated);
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
  const daysShowedUp = useMemo(
    () => countDaysShowedUp(state.history, today),
    [state.history, today],
  );
  useEffect(() => {
    if (!ready) return;
    writeWidgetSnapshot(
      // Confirmed Plus only: "still checking" must not make a free user's
      // widget interactive (it may stay that way until the next launch).
      buildWidgetSnapshot({ state, today, streak: widgetStreak, plus: plusConfirmed, day: daysShowedUp }),
    );
    // Only these fields feed the snapshot (widgetNonce forces a rewrite).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.tasks, state.todayCompletions, today, widgetStreak, daysShowedUp, plusConfirmed, widgetNonce]);

  // The focus session (1.3). Mirrored to the App Group for the widget and
  // Live Activity whenever it changes.
  const focusSession = state.focusSession;
  useEffect(() => {
    if (!ready) return;
    writeFocusSession(focusSession);
    // focusMirrorNonce: rewrite after the Live Activity's taps (see syncFocusCommands).
  }, [ready, focusSession, focusMirrorNonce]);

  // Its end notification: scheduled while it runs (again on resume or
  // extend, replacing the last), cancelled on pause and once it's gone. An
  // ended one is left as it is: it's gone off, and its buttons still work.
  // Never for the past (it's about to end: the app says it), nor past the
  // next midnight (the session clears then).
  const focusEndKey =
    focusSession && focusSession.status === "running" && focusSession.endAt !== null
      ? `${focusSession.id}|${focusSession.endAt}|${focusSession.kind}|${notificationTitle(focusSession)}|${notificationBody(focusSession)}`
      : null;
  const focusStatus = focusSession?.status ?? null;
  // True at launch: the first pass reconciles, so a notification left from a
  // session that's gone (e.g. its task was ticked in the widget) is cancelled.
  const focusNotified = useRef(true);
  useEffect(() => {
    if (!ready) return;
    const session = stateRef.current.focusSession;
    const endAt = focusEndKey ? (session?.endAt ?? null) : null;
    const now = Date.now();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    if (session && endAt !== null && endAt <= midnight.getTime()) {
      // Whatever is scheduled already goes off when it's this close.
      focusNotified.current = true;
      if (endAt <= now + 1000) return;
      void scheduleFocusSessionNotification({
        sessionId: session.id,
        taskId: session.taskId,
        kind: session.kind,
        at: new Date(endAt),
        title: notificationTitle(session),
        body: notificationBody(session),
      });
      return;
    }
    if (focusStatus === "ended") {
      // Gone off: cleared once it's answered.
      focusNotified.current = true;
      return;
    }
    // Paused, gone, or ending after midnight. Nothing to cancel if nothing was
    // scheduled since the launch's first pass.
    if (!focusNotified.current) return;
    focusNotified.current = false;
    void cancelFocusTimerNotification();
  }, [ready, focusEndKey, focusStatus]);

  // It's marked ended when it runs out (right on time while the app is open,
  // or on coming back), so what's saved and mirrored says so too.
  const focusEndAt = focusSession?.status === "running" ? focusSession.endAt : null;
  useEffect(() => {
    if (!ready || focusEndAt === null) return;
    const settleNow = () => {
      // A pause from the Live Activity comes first (it may have beaten the end).
      syncFocusCommands();
      dispatch({ type: "settleFocusSession", now: Date.now() });
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A timer can fire a little early: then it waits again.
    const arm = () => {
      const wait = focusEndAt - Date.now();
      if (wait <= 0) settleNow();
      // setTimeout can't wait longer than about 24.8 days.
      else timer = setTimeout(arm, Math.min(wait + 20, 2 ** 31 - 1));
    };
    arm();
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "active") settleNow();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [ready, focusEndAt, syncFocusCommands]);

  // focus_session_ended when a session goes (or is replaced). The outcome is
  // the one its action gave, or else: its task was ticked ("done", from
  // anywhere), or it was cleared (deleted, Not today, a new day, another start).
  const focusOutcome = useRef<FocusSessionOutcome | null>(null);
  // A happy moment for the rating ask (see focusDoneCount).
  const [focusDoneCount, setFocusDoneCount] = useState(0);
  // The last session's outcome, for the Live Activity's final words below.
  const endedOutcome = useRef<FocusSessionOutcome | null>(null);
  const lastFocusSession = useRef<FocusSession | null>(null);
  useEffect(() => {
    const previous = lastFocusSession.current;
    lastFocusSession.current = focusSession;
    if (!ready || !previous || focusSession?.id === previous.id) return;
    const outcome =
      focusOutcome.current ?? (state.todayCompletions.includes(previous.taskId) ? "done" : "cleared");
    focusOutcome.current = null;
    endedOutcome.current = outcome;
    track("focus_session_ended", { outcome, minutes: sessionMinutes(previous) });
    if (outcome === "done") setFocusDoneCount((n) => n + 1);
    // Only when the session changes; completions are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusSession]);

  // The Live Activity and Dynamic Island (1.3): started with a session,
  // updated as it changes, and ended with a short "Done" (its task was
  // ticked), "Timer ended" (Take a break) or "Timer stopped" when it goes. Reconciled whenever the app
  // becomes active: an activity whose session is gone ends, and a session
  // without one (e.g. activities were off, or it was dismissed) gets one again.
  // The reconcile is a render away, so it sees the session after this
  // foreground's Live Activity commands and widget taps (same batch).
  const [liveNonce, setLiveNonce] = useState(0);
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "active") setLiveNonce((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  const liveSession = useRef<FocusSession | null>(null);
  const liveNonceSeen = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const previous = liveSession.current;
    liveSession.current = focusSession;
    const force = liveNonce !== liveNonceSeen.current;
    liveNonceSeen.current = liveNonce;
    const ending =
      previous && !focusSession
        ? stateRef.current.todayCompletions.includes(previous.taskId)
          ? "done"
          : endedOutcome.current === "break"
            ? "break"
            : "stopped"
        : undefined;
    void syncLiveActivity(focusSession, { ending, force });
  }, [ready, focusSession, liveNonce]);

  // One "app_opened" per day this app is used (drives D1/D7/D30 retention).
  const openedTracked = useRef<string | null>(null);
  // Only once it's on screen: a Live Activity button or Siri can launch the
  // app in the background, and that isn't the user opening it.
  useEffect(() => {
    if (!ready || !appActive || plusPending || openedTracked.current === today) return;
    openedTracked.current = today;
    track("app_opened", { plus: plusConfirmed });
  }, [ready, appActive, today, plusPending, plusConfirmed]);

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
      syncFocusCommands();
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
  }, [
    refreshNotificationPermission,
    syncWidgetTaps,
    syncFocusCommands,
    ensureDay,
    state.autoLock,
    state.tasks,
    state.todayLocked,
  ]);

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

  // Also roll over right at local midnight, so Today (which re-renders on the
  // hour) never pairs 00:00 with yesterday's tasks until the next minute tick.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      // A little past midnight, so a timer that fires early still sees the new day.
      timer = setTimeout(() => {
        ensureDay();
        schedule();
      }, midnight.getTime() - now.getTime() + 50);
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [ensureDay]);

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
  const requestMomentumPlan = useCallback(async (options: { newPath?: boolean } = {}) => {
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
        // The kept path, so the day's ideas aim at its next step.
        currentPath: milestonesWithCompletion(state.momentumPlan?.milestones ?? [], state.completedMilestoneIds).map(
          (m) => ({ title: m.title, done: m.done }),
        ),
        newPath: options.newPath === true,
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
    state.momentumPlan,
    state.completedMilestoneIds,
  ]);

  const suggestNewPath = useCallback(() => {
    if (hasPlus) {
      dispatch({ type: "requestNewPath" });
      void requestMomentumPlan({ newPath: true });
    } else {
      dispatch({ type: "resetPathToTemplate" });
    }
  }, [hasPlus, requestMomentumPlan]);

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
  const markReviewDue = useCallback((source: ReviewTrigger) => {
    dispatch({ type: "markReviewDue", at: new Date().toISOString(), source });
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
  // Stamped with the store's day (like setCoachNotes), so a claim in the first
  // moments after midnight counts on the new day.
  const claimCoachRequestCb = useCallback(
    (taskTexts: string[]) => {
      dispatch({ type: "claimCoachRequest", day: ensureDay(), taskTexts });
    },
    [ensureDay],
  );
  const setCoachNotes = useCallback(
    (day: string, notes: Record<string, CoachNoteLines>) => {
      dispatch({ type: "setCoachNotes", day, notes, today: ensureDay() });
    },
    [ensureDay],
  );
  const markCoachNoteLoggedCb = useCallback(
    (day: string) => {
      dispatch({ type: "markCoachNoteLogged", day, today: ensureDay() });
    },
    [ensureDay],
  );
  const dismissTomorrowDraft = useCallback(() => {
    dispatch({ type: "dismissTomorrowDraft" });
  }, []);
  const completeMilestone = useCallback((id: string) => {
    dispatch({ type: "completeMilestone", id });
  }, []);
  const uncompleteMilestone = useCallback((id: string) => {
    dispatch({ type: "uncompleteMilestone", id });
  }, []);
  const editMilestones = useCallback((items: { id?: string; title: string; description?: string }[]) => {
    dispatch({ type: "setMilestones", items });
  }, []);
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

  const startFocusSession = useCallback(
    (
      taskId: TaskId,
      options: { kind: FocusSessionKind; minutes: number; source: FocusSessionSource; stepText?: string | null },
    ) => {
      const today = ensureDay();
      const current = stateRef.current;
      const task = current.tasks.find((item) => item.id === taskId);
      if (!task || current.todayCompletions.includes(taskId)) return;
      // Its timer is already on (running or paused): never restarted.
      const on = focusSessionRef.current;
      if (on && on.taskId === taskId && on.status !== "ended") return;
      const action = {
        type: "startFocusSession" as const,
        id: makeId(),
        taskId,
        kind: options.kind,
        minutes: options.minutes,
        stepText: options.stepText ?? null,
        today,
        now: Date.now(),
      };
      dispatch(action);
      focusSessionRef.current = startSession({ ...action, taskText: task.text, date: today });
      track("focus_session_started", {
        kind: options.kind,
        minutes: clampSessionMinutes(options.minutes),
        source: options.source,
      });
    },
    [ensureDay],
  );
  const pauseFocusSession = useCallback(() => {
    const session = stateRef.current.focusSession;
    const now = Date.now();
    // Only a running timer pauses (a stale menu on a paused one changes nothing).
    if (!session || session.status !== "running" || pauseSession(session, now).status !== "paused") {
      // Not running: nothing to pause (an ended one is settled as usual).
      if (session?.status === "running") dispatch({ type: "pauseFocusSession", now });
      return false;
    }
    dispatch({ type: "pauseFocusSession", now });
    return true;
  }, []);
  const resumeFocusSession = useCallback(() => {
    const session = stateRef.current.focusSession;
    if (!session || session.status !== "paused") return false;
    dispatch({ type: "resumeFocusSession", now: Date.now() });
    return true;
  }, []);
  // Each "5 more minutes" or "Keep going" ends one countdown: it's reported as
  // extended, and the session goes on.
  const extendFocusSession = useCallback(() => {
    const session = stateRef.current.focusSession;
    // Only when it changes anything (not at the day-long cap).
    if (!session || extendSession(session, Date.now()) === session) return;
    track("focus_session_ended", { outcome: "extended", minutes: sessionMinutes(session) });
    dispatch({ type: "extendFocusSession", now: Date.now() });
  }, []);
  const keepGoingFocusSession = useCallback(() => {
    const session = stateRef.current.focusSession;
    if (!session) return;
    track("focus_session_ended", { outcome: "extended", minutes: sessionMinutes(session) });
    dispatch({ type: "keepGoingFocusSession", now: Date.now() });
  }, []);
  const stopFocusSession = useCallback((outcome: Extract<FocusSessionOutcome, "stopped" | "break" | "broken_down">) => {
    if (!stateRef.current.focusSession) return;
    focusOutcome.current = outcome;
    dispatch({ type: "clearFocusSession" });
  }, []);

  // The end notification's buttons (and a tap on it), including the one that
  // launched the app. Held until saved state has loaded. Mark done ticks the task
  // the normal way (Today celebrates if it's on screen); a tap for another
  // session (an old notification) is ignored.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const pendingFocusResponses = useRef<FocusNotificationResponse[]>([]);
  const handleFocusResponse = useRef<(response: FocusNotificationResponse) => void>(() => {});
  handleFocusResponse.current = (response) => {
    // Any tap on it shows Today, where the task row's timer and check-in are.
    navigateToToday();
    const current = stateRef.current;
    const session = current.focusSession;
    if (!session || session.id !== response.sessionId) return;
    if (response.action === "open") {
      // A tap on the notification itself, with its check-in due: that
      // session's focus screen (its check-in is there). Otherwise just Today.
      if (sessionPhase(session, Date.now()) === "ended" && !current.todayCompletions.includes(session.taskId)) {
        setFocusPrompt({ taskId: session.taskId, source: "notification", nonce: Date.now() });
      }
      return;
    }
    if (response.action === "extend" || response.action === "keepGoing") {
      // A starter's Keep going: a 20-minute timer, as its check-in. An old
      // notification's "5 more minutes" on a starter (before 1.3's starter
      // buttons) means the same, like the Live Activity's time's-up button.
      if (session.kind === "starter") keepGoingFocusSession();
      else if (response.action === "extend") extendFocusSession();
      return;
    }
    if (current.todayCompletions.includes(session.taskId)) return;
    toggleTask(session.taskId);
    track("task_completed", { count: countCompleted(current) + 1, source: "notification" });
  };
  useEffect(() => {
    void registerFocusCategory();
  }, []);
  useEffect(
    () =>
      subscribeFocusResponses((response) => {
        if (readyRef.current) handleFocusResponse.current(response);
        else pendingFocusResponses.current.push(response);
      }),
    [],
  );
  useEffect(() => {
    if (!ready) return;
    const pending = pendingFocusResponses.current;
    pendingFocusResponses.current = [];
    pending.forEach((response) => handleFocusResponse.current(response));
  }, [ready]);

  // "Start my next task" from the widget or Siri (1.3; see focus-link.ts):
  // links queued by the router, and the request Siri leaves in the App Group
  // (a cold start can miss the link); and a tap on the Live Activity, which
  // opens its session's focus screen. Once ready and on screen (never in a
  // background launch), on each link, and whenever the app becomes active.
  // Runs one at a time, each planning on the latest session. Idempotent: one
  // request id counts once, it never restarts that task's timer, and never
  // silently replaces another task's (Today asks instead).
  const [focusPrompt, setFocusPrompt] = useState<StoreContextValue["focusPrompt"]>(null);
  const clearFocusPrompt = useCallback(() => setFocusPrompt(null), []);
  const handledStartIds = useRef(new Set<string>());
  const focusStartsChain = useRef<Promise<void>>(Promise.resolve());
  const runFocusStarts = useRef<() => Promise<void>>(async () => {});
  runFocusStarts.current = async () => {
    if (!readyRef.current || !isAppActive()) return;
    const open = takeFocusOpen();
    const requests: FocusStartRequest[] = takeFocusStarts();
    const { raw, handledId } = readFocusStartRequest();
    const stored = parseFocusStartRequest(raw, handledId, Date.now());
    if (stored) {
      markFocusStartRequestHandled(stored.id);
      requests.push(stored);
    }
    const fresh = requests.filter((request) => !request.id || !handledStartIds.current.has(request.id));
    fresh.forEach((request) => request.id && handledStartIds.current.add(request.id));
    // One run of Siri can arrive both ways: only the latest request counts.
    const request = fresh[fresh.length - 1];
    if (!request && !open) return;
    navigateToToday();
    if (!request) {
      const session = focusSessionRef.current;
      // Its focus screen, or just Today if that session has gone.
      if (open && session && session.id === open.sessionId) {
        setFocusPrompt({ taskId: session.taskId, source: "live_activity", nonce: Date.now() });
      }
      return;
    }
    const minutes =
      request.kind === "starter" ? STARTER_MINUTES : ((await loadLastTimer()) ?? DEFAULT_LINK_MINUTES);
    // After the wait: plan on the session as it is now (another start may have run).
    const plan = planFocusStart({ ...stateRef.current, focusSession: focusSessionRef.current });
    if (plan.type === "start") {
      startFocusSession(plan.taskId, { kind: request.kind, minutes, source: request.source });
    } else if (plan.type === "confirm") {
      setFocusPrompt({ taskId: plan.taskId, source: request.source, nonce: Date.now() });
    }
  };
  const handleFocusStarts = useCallback(() => {
    const run = focusStartsChain.current.then(() => runFocusStarts.current()).catch(() => {});
    focusStartsChain.current = run;
    return run;
  }, []);
  useEffect(() => subscribeFocusStarts(() => void handleFocusStarts()), [handleFocusStarts]);
  useEffect(() => {
    if (!ready || !appActive) return;
    void handleFocusStarts();
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "active") void handleFocusStarts();
    });
    return () => sub.remove();
  }, [ready, appActive, handleFocusStarts]);

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
      focusDoneCount,
      setEveningClose,
      applyTomorrowDraft,
      dismissTomorrowDraft,
      setAgendaEnabled,
      claimCoachRequest: claimCoachRequestCb,
      setCoachNotes,
      markCoachNoteLogged: markCoachNoteLoggedCb,
      completeMilestone,
      uncompleteMilestone,
      editMilestones,
      suggestNewPath,
      daysShowedUp,
      parkTasks: parkTasksCb,
      removeParkedTask: removeParkedTaskCb,
      addParkedTask,
      setTaskSteps: setTaskStepsCb,
      toggleTaskStep: toggleTaskStepCb,
      clearTaskSteps: clearTaskStepsCb,
      hasPlus,
      plusConfirmed,
      plusPending,
      setAnalyticsEnabled: setAnalyticsEnabledCb,
      startFocusSession,
      pauseFocusSession,
      resumeFocusSession,
      extendFocusSession,
      keepGoingFocusSession,
      stopFocusSession,
      focusPrompt,
      clearFocusPrompt,
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
      focusDoneCount,
      setEveningClose,
      applyTomorrowDraft,
      dismissTomorrowDraft,
      setAgendaEnabled,
      claimCoachRequestCb,
      setCoachNotes,
      markCoachNoteLoggedCb,
      completeMilestone,
      uncompleteMilestone,
      editMilestones,
      suggestNewPath,
      daysShowedUp,
      parkTasksCb,
      removeParkedTaskCb,
      addParkedTask,
      setTaskStepsCb,
      toggleTaskStepCb,
      clearTaskStepsCb,
      hasPlus,
      plusConfirmed,
      plusPending,
      setAnalyticsEnabledCb,
      startFocusSession,
      pauseFocusSession,
      resumeFocusSession,
      extendFocusSession,
      keepGoingFocusSession,
      stopFocusSession,
      focusPrompt,
      clearFocusPrompt,
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
