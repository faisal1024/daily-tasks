import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  AppState as RNAppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
import { AddTaskRow } from "@/components/daily-tasks/add-task-row";
import { BrainDumpSheet } from "@/components/daily-tasks/brain-dump-sheet";
import { CoachNote } from "@/components/daily-tasks/coach-note";
import { CompletionReflection } from "@/components/daily-tasks/completion-reflection";
import {
  EveningResult,
  MorningHero,
  TomorrowDraftCard,
} from "@/components/daily-tasks/ritual-cards";
import { CelebrationOverlay } from "@/components/daily-tasks/celebration-overlay";
import { IdeasSheet, type IdeaItem } from "@/components/daily-tasks/ideas-sheet";
import { NextPathLink } from "@/components/daily-tasks/next-path-link";
import { FirstRun } from "@/components/daily-tasks/first-run";
import type { FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { FocusMode } from "@/components/daily-tasks/focus-mode";
import { NowBar, useFocusSessionCues } from "@/components/daily-tasks/now-bar";
import { DoneCard } from "@/components/daily-tasks/done-card";
import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import { StatusLine } from "@/components/daily-tasks/status-line";
import { TaskRow } from "@/components/daily-tasks/task-row";
import { TodayHeader } from "@/components/daily-tasks/today-header";
import { UpdateBanner } from "@/components/daily-tasks/update-banner";
import { WeekRow } from "@/components/daily-tasks/week-row";
import { useAppUpdate } from "@/hooks/use-app-update";
import { useHour } from "@/hooks/use-hour";
import {
  aiFailureMessage,
  breakDownFailureMessage,
  classifyAiFailure,
} from "@/lib/daily-tasks/ai-status";
import { proxyRouteUrl } from "@/lib/daily-tasks/ai-client";
import { readTodayAgenda } from "@/lib/daily-tasks/agenda";
import { claimFirstAiSort } from "@/lib/daily-tasks/storage";
import {
  claimFreeAiDump,
  freeAiDumpNotice,
  freeAiDumpsLeft,
  refundFreeAiDump,
} from "@/lib/daily-tasks/free-uses";
import {
  FREE_LIMIT_NOTICE,
  localBrainDump,
  requestBreakDown,
  sortBrainDump,
  type SortedBrainDump,
} from "@/lib/daily-tasks/ai-helpers";
import { track } from "@/lib/daily-tasks/analytics";
import type { PaywallSource, PlusFeature } from "@/lib/daily-tasks/plus";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import {
  coachNote,
  coachNoteKind,
  coachNoteLogged,
  coachTaskKey,
  coachTasksSet,
  needsCoachRequest,
  nextOpenTask,
  requestCoachNotes,
  showsCoachNote,
} from "@/lib/daily-tasks/coach-note";
import { addDays, fromDateKey, greetingFor, greetingText } from "@/lib/daily-tasks/date";
import { STARTER_MINUTES, type FocusSessionSource } from "@/lib/daily-tasks/focus-session";
import { durationShort, timerMenuLengths } from "@/lib/daily-tasks/focus-timer";
import { loadLastTimer, saveLastTimer } from "@/lib/daily-tasks/focus-timer-storage";
import { nextIncompleteMilestone } from "@/lib/daily-tasks/milestones";
import { generateMomentumSuggestions } from "@/lib/daily-tasks/momentum";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { shouldRequestReview } from "@/lib/daily-tasks/review-prompt";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import {
  brainDumpToast,
  clockTimeOf,
  formatClockTime,
  ideasEntry,
  ideasSource,
  isPerfectDayTransition,
  lockConfirmation,
  showIdeasEntry,
  todayProgress,
  todayStatus,
} from "@/lib/daily-tasks/today-view";
import { buildWeekSummary, todayPhase } from "@/lib/daily-tasks/today-phase";
import { MAX_TASKS } from "@/lib/daily-tasks/types";
import {
  buildEveningInput,
  closeDay,
  draftToShow,
  isDayClosed,
  showEveningCheckIn,
} from "@/lib/daily-tasks/evening";
import type { ReflectionResult } from "@/lib/daily-tasks/types";

/** A rating ask waits at least this long after the perfect day that earned it. */
const REVIEW_DELAY_MS = 60 * 60 * 1000;
/** ...and is dropped after a week (too far from the moment that earned it). */
const REVIEW_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
/** Wait this long after the app becomes active before asking. */
const REVIEW_SETTLE_MS = 2000;

type Unlock =
  // `starter`: from the timer's check-in, so a 5-minute starter is offered after.
  | { kind: "break_down"; taskId: string; text: string; starter?: boolean }
  | { kind: "brain_dump" }
  | { kind: "new_ideas" };

function haptic(fn: () => Promise<void>) {
  if (Platform.OS === "web") return;
  fn().catch(() => {});
}

const FIRST_SORT_TIMEOUT_MS = 12_000;
/** Lets focus mode's sheet close before "Done: <task>" is read out. */
const FOCUS_DONE_ANNOUNCE_DELAY_MS = 500;

export default function HomeScreen() {
  const colors = useColors();
  const {
    ready,
    state,
    today,
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
    markOnboardingSeen,
    requestNotificationPermission,
    setTodayReflection,
    setTodayReflectionResult,
    requestMomentumPlan,
    markReviewPrompted,
    markReviewDue,
    parkTasks,
    removeParkedTask,
    addParkedTask,
    setTaskSteps,
    toggleTaskStep,
    clearTaskSteps,
    hasPlus,
    plusConfirmed,
    plusPending,
    daysShowedUp,
    setEveningClose,
    applyTomorrowDraft,
    dismissTomorrowDraft,
    claimCoachRequest,
    setCoachNotes,
    markCoachNoteLogged,
    startFocusSession,
    pauseFocusSession,
    resumeFocusSession,
    extendFocusSession,
    keepGoingFocusSession,
    stopFocusSession,
  } = useDailyTasks();
  const { paywallEnabled, paywallSource, purchaseCount, openPaywall, winBackDue } = usePlus();
  const winBackDueRef = useRef(winBackDue);
  winBackDueRef.current = winBackDue;

  // First run stays up until its last step; onboarding is marked seen only
  // then, so a relaunch mid-way resumes (at the nudge once tasks are set).
  const [firstRunActive, setFirstRunActive] = useState(false);
  const firstRunAiUsed = useRef(false);
  useEffect(() => {
    if (ready && !state.hasSeenOnboarding && !state.pendingRollover && !firstRunActive) {
      setFirstRunActive(true);
    }
    // Only on opening: tasks added during first run mustn't change where it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.hasSeenOnboarding, state.pendingRollover]);

  // What to pick back up once the paywall closes (bought or not).
  const pendingUnlock = useRef<Unlock | null>(null);
  // iOS shows one modal at a time: when a sheet is closing first, wait for it
  // to animate away before bringing up the paywall.
  const paywallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPaywall = (
    source: PaywallSource,
    options: { feature?: PlusFeature; afterSheet?: boolean; resume?: Unlock } = {},
  ) => {
    if (options.feature) track("plus_gate_hit", { feature: options.feature });
    const unlock = options.resume ?? null;
    if (paywallTimer.current) clearTimeout(paywallTimer.current);
    const open = () => {
      pendingUnlock.current = unlock;
      // Didn't open (e.g. a paywall is already up elsewhere): nothing to resume.
      if (!openPaywall(source)) pendingUnlock.current = null;
    };
    if (!options.afterSheet) {
      open();
      return;
    }
    paywallTimer.current = setTimeout(() => {
      paywallTimer.current = null;
      open();
    }, 650);
  };
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (paywallTimer.current) clearTimeout(paywallTimer.current);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );
  const { update, dismiss: dismissUpdate } = useAppUpdate();
  // iPad (and large landscape phones): tasks on the left, ideas and the
  // evening check-in on the right, centred with a comfortable max width.
  const { width } = useWindowDimensions();
  const wide = width >= 768;

  const [showCelebration, setShowCelebration] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  // Evening close in flight.
  const [closingDay, setClosingDay] = useState(false);
  const closingRef = useRef(false);
  // Opened from "Saved for later" (full day): show just the saved items.
  const [ideasSavedOnly, setIdeasSavedOnly] = useState(false);
  // However the sheet closes (its button, a lock, rollover, the paywall), the
  // next open starts in the normal view.
  useEffect(() => {
    if (!ideasOpen) setIdeasSavedOnly(false);
  }, [ideasOpen]);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  // Free users: how many AI sorts are left, read each time the sheet opens.
  const [freeAiLeft, setFreeAiLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!brainDumpOpen || hasPlus) {
      setFreeAiLeft(null);
      return;
    }
    let live = true;
    void freeAiDumpsLeft().then((left) => {
      if (live) setFreeAiLeft(left);
    });
    return () => {
      live = false;
    };
  }, [brainDumpOpen, hasPlus]);
  // Short confirmation after a brain dump, so saved items aren't a mystery.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const [breakingTaskId, setBreakingTaskId] = useState<string | null>(null);
  // A ref, not just state: two quick taps in one render must not both start.
  const breakingRef = useRef<string | null>(null);
  const breakDownAvailable = proxyRouteUrl(getMomentumAiProxyUrl(), "break-down") != null;

  const total = state.tasks.length;
  const progress = todayProgress(completedCount, total, { locked: state.todayLocked });
  const status = todayStatus({
    locked: state.todayLocked,
    lockSource: state.todayLockSource,
    taskCount: total,
    completedCount,
    // The actual lock time when known; the configured time for older saves.
    autoLockTime:
      clockTimeOf(state.todayLockedAt) ??
      formatClockTime(state.autoLock.hour, state.autoLock.minute),
  });
  const entry = ideasEntry(total, state.momentumProfile.goalTitle);
  const ideasVisible = showIdeasEntry({ locked: state.todayLocked, remainingSlots });
  // Last night's draft of today's three (if it's for today and there's room).
  const draft = draftToShow(state.tomorrowDraft, {
    today,
    locked: state.todayLocked,
    taskTexts: state.tasks.map((task) => task.text),
    // Yesterday: anything finished after the close, or dropped at rollover.
    sourceDay: state.tomorrowDraft ? state.history[addDays(state.tomorrowDraft.forDate, -1)] : null,
  });
  // An empty day opens on the morning ritual: last night's draft, or the prompt.
  const emptyMorning = total === 0 && !state.todayLocked;
  // Kept fresh while the app is open (top of each hour, and on coming back).
  const hour = useHour();
  const eveningCheckIn = showEveningCheckIn({
    taskCount: total,
    locked: state.todayLocked,
    perfect: progress.isPerfect,
    hour,
    enabled: state.momentumSettings.eveningReflection,
  });
  // What the lower section shows at this time of day (1.2).
  const phase = todayPhase({
    taskCount: total,
    completedCount: progress.completed,
    hour,
    eveningEnabled: state.momentumSettings.eveningReflection,
  });
  const week = useMemo(
    () => buildWeekSummary(state.history, today, { total, completed: progress.completed }),
    [state.history, today, total, progress.completed],
  );
  // Midday's "Next on your path": only when there's a goal path with a step left.
  const nextMilestone = state.momentumPlan
    ? nextIncompleteMilestone(state.momentumPlan.milestones, state.completedMilestoneIds)
    : null;
  const openProgress = () => router.navigate("/journey");
  // The Coach's note (morning and midday, once the three are set, something
  // is ticked, or it's midday): one line about the next open task.
  const coachTask = showsCoachNote({
    phase,
    taskCount: total,
    completedCount: progress.completed,
    locked: state.todayLocked,
  })
    ? nextOpenTask(state.tasks, state.todayCompletions)
    : null;
  const note = coachTask
    ? coachNote({
        cache: state.coachNotes,
        today,
        taskText: coachTask.text,
        kind: coachNoteKind(progress.completed),
      })
    : null;
  // AI lines for confirmed Plus ("still checking" must not spend a call), once
  // the three are set; built-in lines otherwise, and on any failure.
  const coachAiUser = plusConfirmed && proxyRouteUrl(getMomentumAiProxyUrl(), "coach-note") != null;
  const coachTasksReady = coachTasksSet(total, state.todayLocked);
  const coachAi = coachAiUser && coachTasksReady;
  const coachTexts = useMemo(() => state.tasks.map((task) => task.text), [state.tasks]);
  const coachDue = coachAi && needsCoachRequest(state.coachNotes, today, coachTexts);
  // A ref, not just state: re-renders mid-request must never start a second call.
  const coachInFlight = useRef(false);
  // The day and texts last asked about: the same ask is never sent twice in a
  // session, even if the stored claim didn't stick.
  const coachLastAsk = useRef<string | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const noteShown = note !== null;
  // Under the note, "Need ideas?" and "Brain dump" shrink to one quiet line.
  const quietEntries = noteShown;
  useEffect(() => {
    if (!ready || !noteShown || !coachDue || coachInFlight.current) return;
    const ask = `${today}|${coachTexts.map(coachTaskKey).join("\n")}`;
    if (coachLastAsk.current === ask) return;
    coachLastAsk.current = ask;
    coachInFlight.current = true;
    setCoachLoading(true);
    // Counted before the call, so a failure can't be retried into a third one.
    const day = today;
    claimCoachRequest(coachTexts);
    void requestCoachNotes({
      input: {
        tasks: coachTexts,
        goalTitle: state.momentumProfile.goalTitle,
        tone: state.momentumSettings.suggestionTone,
      },
    })
      .then((notes) => setCoachNotes(day, notes))
      // Quietly keep the built-in lines.
      .catch(() => {})
      .finally(() => {
        coachInFlight.current = false;
        setCoachLoading(false);
      });
    // Only when a call becomes due (or the last one settles with another due:
    // an edit or midnight mid-call); the goal and tone are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, noteShown, coachDue, coachLoading, today, coachTexts]);
  // coach_note_loaded once a day, with the source of what's shown once it
  // settles: never while Plus is still being checked, and for AI users only
  // once the three are set and their call is done (or, if they never set
  // three, local at midday). Free users: on first show.
  const noteSource = note?.source ?? null;
  useEffect(() => {
    if (!ready || !noteSource || plusPending || coachDue || coachLoading) return;
    if (coachAiUser && !coachTasksReady && phase !== "midday") return;
    if (coachNoteLogged(state.coachNotes, today)) return;
    track("coach_note_loaded", { source: noteSource });
    markCoachNoteLogged(today);
  }, [
    ready,
    noteSource,
    plusPending,
    coachDue,
    coachLoading,
    coachAiUser,
    coachTasksReady,
    phase,
    state.coachNotes,
    today,
    markCoachNoteLogged,
  ]);
  // Focus mode (1.2) on one open task. It closes if that task is ticked or
  // removed meanwhile (e.g. from the widget), and when the day rolls over.
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  // Opened from a task's timer menu (Custom…): the length wheel shows at once.
  const [focusCustom, setFocusCustom] = useState(false);
  const openFocus = (taskId: string, source: "coach" | "row" | "now_bar", custom = false) => {
    setFocusCustom(custom);
    setFocusTaskId(taskId);
    track("focus_opened", { source });
  };
  const focusTask = focusTaskId
    ? (state.tasks.find((task) => task.id === focusTaskId && !isCompleted(task.id)) ?? null)
    : null;
  useEffect(() => {
    if (focusTaskId && !focusTask) setFocusTaskId(null);
  }, [focusTaskId, focusTask]);
  useEffect(() => {
    setFocusTaskId(null);
  }, [today]);
  // "Done: <task>" after Done in focus mode (see onDone below).
  const focusDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (focusDoneTimer.current) clearTimeout(focusDoneTimer.current);
    },
    [],
  );
  // The focus session (1.3): one timer at a time, on the task's row, in the Now
  // bar under the header, and on the focus screen. Its start and end are said
  // (and the end felt) here, since Today is always mounted.
  const focusSession = state.focusSession;
  const sessionTask = focusSession ? (state.tasks.find((task) => task.id === focusSession.taskId) ?? null) : null;
  useFocusSessionCues(focusSession);
  // The last length used: first in a task's timer menu. Best-effort.
  const [lastTimer, setLastTimer] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void loadLastTimer().then((minutes) => {
      if (live && minutes !== null) setLastTimer((current) => current ?? minutes);
    });
    return () => {
      live = false;
    };
  }, []);
  const startTimer = (taskId: string, minutes: number, source: FocusSessionSource) => {
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    startFocusSession(taskId, { kind: "timer", minutes, source });
    setLastTimer(minutes);
    void saveLastTimer(minutes);
  };
  const startStarter = (taskId: string, source: FocusSessionSource, stepText?: string) => {
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    startFocusSession(taskId, { kind: "starter", minutes: STARTER_MINUTES, source, stepText });
  };
  // A task's ▶: 5 / 10 / 20 min (the last used first) or Custom…, which opens
  // the focus screen with its length wheel.
  const openTimerMenu = (taskId: string, text: string) => {
    const lengths = timerMenuLengths(lastTimer);
    const pick = (index: number) => {
      if (index < lengths.length) startTimer(taskId, lengths[index], "row");
      else if (index === lengths.length) openFocus(taskId, "row", true);
    };
    const labels = [...lengths.map(durationShort), "Custom…"];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: `Timer: ${text}`, options: [...labels, "Cancel"], cancelButtonIndex: labels.length },
        pick,
      );
      return;
    }
    // Android shows at most three buttons: page through with "More…".
    const page = (from: number) => {
      const rest = labels.length - from;
      const buttons =
        rest <= 2
          ? labels.slice(from).map((label, i) => ({ text: label, onPress: () => pick(from + i) }))
          : [
              { text: labels[from], onPress: () => pick(from) },
              { text: "More…", onPress: () => page(from + 1) },
            ];
      Alert.alert(`Timer: ${text}`, undefined, [...buttons, { text: "Cancel", style: "cancel" as const }]);
    };
    page(0);
  };
  // Its coach line: the same `start` line the note gives (AI or built-in).
  const focusStartLine = focusTask
    ? coachNote({ cache: state.coachNotes, today, taskText: focusTask.text, kind: "start" }).text
    : null;
  // Yesterday's unfinished ones: a card, so the draft and the rest of Today
  // stay usable (it used to be a blocking modal). On a phone with no draft it
  // leads, above the three slots; otherwise it follows the draft, quietly.
  const rolloverOnTop = !wide && !draft;
  const rolloverCard = (
    <RolloverModal
      pending={state.pendingRollover}
      // A set day takes nothing new.
      remainingSlots={state.todayLocked ? 0 : remainingSlots}
      quiet={Boolean(draft)}
      onApply={(ids) => {
        track("rollover_resolved", {
          count: ids.length,
          outcome: remainingSlots <= 0 || state.todayLocked ? "no_room" : ids.length === 0 ? "fresh" : "carried",
        });
        resolveRollover(ids);
      }}
    />
  );
  // The right column (iPad) / lower section (phone) only exists when it has
  // content. Every phase past "plan" has some: the week row (morning, midday),
  // the check-in (evening) or the done card.
  const rightHasContent =
    (Boolean(state.pendingRollover) && (wide || Boolean(draft))) ||
    ideasVisible ||
    Boolean(draft) ||
    phase !== "plan";
  const twoColumn = wide && rightHasContent;
  const dateLabel = fromDateKey(today).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  // Once the day is set or under way, the next thing to do is the card's hero.
  const heroTaskId =
    (state.todayLocked || completedCount > 0) && !progress.isPerfect
      ? (state.tasks.find((task) => !isCompleted(task.id))?.id ?? null)
      : null;
  const firstName = state.momentumProfile.name?.trim().split(/\s+/)[0] ?? "";
  const greetingLine = firstName ? `${greetingText(greetingFor())}, ${firstName}` : null;

  const addedTexts = useMemo(
    () => new Set(state.tasks.map((task) => task.text.trim().toLowerCase())),
    [state.tasks],
  );

  // AI (or template-plan) suggestions when a goal plan exists, otherwise the
  // generic starters for the user's goal.
  const planIdeas = state.momentumPlan?.todaySuggestions;
  const hasPlanIdeas = (planIdeas?.length ?? 0) > 0;
  const genericIdeas = useMemo(
    () => generateMomentumSuggestions(state.momentumProfile),
    [state.momentumProfile],
  );
  const ideas: IdeaItem[] = useMemo(
    () =>
      planIdeas && planIdeas.length > 0
        ? planIdeas.map((task) => ({
            id: task.id,
            text: task.text,
            estimatedMinutes: task.estimatedMinutes,
          }))
        : genericIdeas.map((text, index) => ({ id: `starter_${index}`, text })),
    [planIdeas, genericIdeas],
  );
  const source = ideasSource(state.momentumPlan, state.momentumProfile.goalTitle);
  const failureMessage =
    state.momentumPlanStatus === "error"
      ? aiFailureMessage(state.momentumPlanError, {
          showingAiIdeas: state.momentumPlan?.provider === "ai",
        })
      : null;

  // Celebrate (and maybe ask for a rating) only at the moment the third task is
  // checked off, never just because the app opened on a finished day.
  const previousCompleted = useRef<number | null>(null);
  const celebratedDay = useRef<string | null>(null);
  const reviewInFlight = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const transition = isPerfectDayTransition({
      previousCompleted: previousCompleted.current,
      completed: completedCount,
      total,
    });
    previousCompleted.current = completedCount;

    // Once per day: un-checking and re-checking the third task doesn't replay it.
    if (!transition || celebratedDay.current === today) return;
    celebratedDay.current = today;

    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    setShowCelebration(true);
    track("perfect_day", { count: total });
    // Earned a rating ask: remember it for a later app open instead of
    // stacking it on the celebration and the evening check-in.
    if (
      shouldRequestReview({
        history: state.history,
        lastReviewPromptAt: state.lastReviewPromptAt,
        now: new Date(),
        justCompletedPerfectDay: true,
      })
    ) {
      markReviewDue();
    }
  }, [ready, completedCount, total, today, state.history, state.lastReviewPromptAt, markReviewDue]);

  // Stable identity: the overlay restarts its auto-dismiss timer whenever
  // onDismiss changes.
  const dismissCelebration = useCallback(() => {
    setShowCelebration(false);
  }, []);

  // Ask for the rating on a LATER app open (at least an hour after the perfect
  // day), when nothing else is happening. The cooldown is only spent if the
  // prompt was actually requested while the app was active.
  const reviewDueAtRef = useRef(state.reviewDueAt);
  reviewDueAtRef.current = state.reviewDueAt;
  // Something else is on screen (rollover, onboarding, a sheet, the paywall,
  // a celebration): the rating ask waits for a quiet moment.
  const busyRef = useRef(false);
  busyRef.current =
    !state.hasSeenOnboarding ||
    firstRunActive ||
    paywallSource !== null ||
    ideasOpen ||
    brainDumpOpen ||
    focusTaskId !== null ||
    // A running timer or its check-in: no rating ask on top of either.
    focusSession !== null ||
    showCelebration;
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async () => {
      const due = reviewDueAtRef.current;
      if (!due || reviewInFlight.current || busyRef.current) return;
      const age = Date.now() - Date.parse(due);
      if (age < REVIEW_DELAY_MS || age > REVIEW_EXPIRY_MS) return;
      if (RNAppState.currentState !== "active") return;
      reviewInFlight.current = true;
      try {
        if (await requestAppReview()) markReviewPrompted();
      } finally {
        reviewInFlight.current = false;
      }
    };
    // Give the app a moment after opening before asking.
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void ask();
      }, REVIEW_SETTLE_MS);
    };
    schedule();
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "active") schedule();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [ready, markReviewPrompted]);

  // The sheet has nothing to add once the day is locked, and it must not block
  // the onboarding modals (iOS shows one modal at a time). Yesterday's
  // unfinished ones are a card now, so they don't close it.
  useEffect(() => {
    if (state.todayLocked || !state.hasSeenOnboarding || firstRunActive) {
      setIdeasOpen(false);
      setBrainDumpOpen(false);
    }
  }, [state.todayLocked, state.hasSeenOnboarding, firstRunActive]);

  // `starter`: asked from a timer's check-in ("Stuck?"), so once the steps are
  // in, a 5-minute starter on the first one is offered. `afterSheet`: the
  // focus screen is closing first (iOS shows one modal at a time).
  const handleBreakDown = (
    taskId: string,
    text: string,
    options: { starter?: boolean; afterSheet?: boolean } = {},
  ) => {
    if (breakingRef.current) return;
    if (!hasPlus) {
      showPaywall("break_down", {
        feature: "break_down",
        afterSheet: options.afterSheet,
        resume: { kind: "break_down", taskId, text, starter: options.starter },
      });
      return;
    }
    void runBreakDown(taskId, text, options.starter);
  };

  const offerStarter = (taskId: string, step: string) => {
    Alert.alert("Start with the first step?", `"${step}". Just 5 minutes.`, [
      { text: "Not now", style: "cancel" },
      { text: "Start 5 minutes", onPress: () => startStarter(taskId, "focus", step) },
    ]);
  };

  const runBreakDown = async (taskId: string, text: string, starter = false) => {
    if (breakingRef.current) return;
    breakingRef.current = taskId;
    setBreakingTaskId(taskId);
    try {
      const steps = await requestBreakDown({ task: text, goalTitle: state.momentumProfile.goalTitle });
      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      // Only if the task still reads the same (it may have been edited meanwhile).
      setTaskSteps(taskId, steps, text);
      track("break_down_used", { count: steps.length });
      // The store keeps steps trimmed: match it, so the starter names the step.
      const first = steps.map((step) => step.trim()).find(Boolean);
      if (starter && first) offerStarter(taskId, first);
    } catch (error) {
      Alert.alert("Couldn't break it down", breakDownFailureMessage(classifyAiFailure(error)));
    } finally {
      breakingRef.current = null;
      setBreakingTaskId(null);
    }
  };

  // When the paywall closes, pick up where the user was: run the break-down
  // they asked for (if they now have Plus), or reopen the sheet they were in.
  const resume = useRef<(unlock: Unlock) => void>(() => {});
  resume.current = (unlock) => {
    if (unlock.kind === "break_down") {
      const task = state.tasks.find((t) => t.id === unlock.taskId);
      if (hasPlus && task && task.text === unlock.text && !isCompleted(task.id)) {
        void runBreakDown(task.id, task.text, unlock.starter);
      }
      return;
    }
    if (state.todayLocked) return;
    if (unlock.kind === "brain_dump") {
      setBrainDumpOpen(true);
      return;
    }
    setIdeasOpen(true);
    if (hasPlus) void requestMomentumPlan();
  };
  const paywallWasOpen = useRef(false);
  useEffect(() => {
    if (paywallSource) {
      paywallWasOpen.current = true;
      return;
    }
    if (!paywallWasOpen.current) return;
    paywallWasOpen.current = false;
    const unlock = pendingUnlock.current;
    pendingUnlock.current = null;
    if (!unlock) return;
    // Let the paywall animate away before presenting another sheet.
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      // A paywall came back up meanwhile: keep the unlock for when it closes.
      if (paywallOpenRef.current) {
        pendingUnlock.current = unlock;
        paywallWasOpen.current = true;
        return;
      }
      resume.current(unlock);
    }, 650);
  }, [paywallSource]);
  const paywallOpenRef = useRef(false);
  paywallOpenRef.current = paywallSource !== null;

  // Thank-you note after an actual purchase (not when a subscriber's status
  // simply loads at launch, and not on restore, which has its own message).
  const seenPurchases = useRef(purchaseCount);
  useEffect(() => {
    if (purchaseCount > seenPurchases.current) showToast("You're on Plus. Thank you!");
    seenPurchases.current = purchaseCount;
  }, [purchaseCount]);

  // The evening check-in: record how the day felt, then (once a day) let the
  // coach close it: a note and tomorrow's draft. AI for Plus, on-device otherwise.
  const handleEveningResult = (result: ReflectionResult, typedNote?: string | null) => {
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    setTodayReflectionResult(result);
    // Closed once per answer: picking a different answer re-closes the day
    // (the note and draft should match it); the same answer doesn't.
    if (closingRef.current || isDayClosed(state.eveningClose, today, result)) return;
    closingRef.current = true;
    setClosingDay(true);
    // The day being closed is the one on screen now, whenever the reply lands.
    const day = today;
    const input = buildEveningInput(state, result, typedNote);
    // Confirmed Plus only: "still checking" must not spend an AI call on a free user.
    void closeDay(input, { useAi: plusConfirmed && getMomentumAiProxyUrl() != null })
      .then((close) => {
        setEveningClose(close, day, result);
        track("evening_closed", { source: close.source, count: close.tomorrow.length });
      })
      .finally(() => {
        closingRef.current = false;
        setClosingDay(false);
      });
  };

  const confirmLock = () => {
    const { title, message } = lockConfirmation(total);
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Set",
        onPress: () => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
          lockToday();
        },
      },
    ]);
  };

  const handleToggle = (id: string) => {
    const completing = !isCompleted(id);
    haptic(() =>
      completing
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );
    toggleTask(id);
    if (completing) track("task_completed", { count: completedCount + 1 });
    // Plus lapsed a while ago: offer it back once, after a small win (not on
    // launch). Skipped if anything else is on screen, e.g. the celebration.
    if (completing && winBackDue && paywallEnabled && !hasPlus) {
      setTimeout(() => {
        if (!busyRef.current && winBackDueRef.current) openPaywall("win_back");
      }, 1200);
    }
  };

  // "Done: <task>" after a Done outside the task's own row. The celebration
  // covers it when it's about to show (the same once-a-day check it uses).
  // Said a moment later, so a closing sheet doesn't cut it off.
  const announceDone = (text: string) => {
    const celebrates =
      celebratedDay.current !== today &&
      isPerfectDayTransition({ previousCompleted: completedCount, completed: completedCount + 1, total });
    if (celebrates) return;
    if (focusDoneTimer.current) clearTimeout(focusDoneTimer.current);
    focusDoneTimer.current = setTimeout(() => {
      focusDoneTimer.current = null;
      AccessibilityInfo.announceForAccessibility(`Done: ${text}`);
    }, FOCUS_DONE_ANNOUNCE_DELAY_MS);
  };

  // What the Now bar, the focus screen and the check-in can do to the session.
  // Done ticks through the normal path, so the haptic, celebration and
  // win-back all happen (and the store clears the session).
  const sessionControls: FocusSessionControls = {
    pause: pauseFocusSession,
    resume: resumeFocusSession,
    stop: () => stopFocusSession("stopped"),
    extend: extendFocusSession,
    keepGoing: keepGoingFocusSession,
    done: () => {
      if (!sessionTask) return;
      handleToggle(sessionTask.id);
      announceDone(sessionTask.text);
    },
    // "Stuck?": on to a break-down (the Plus gate as usual), then a starter on
    // its first step. Only while there's none yet and the AI can be reached.
    breakDown:
      sessionTask && breakDownAvailable && !(sessionTask.steps && sessionTask.steps.length > 0)
        ? () => {
            if (breakingRef.current) return;
            const fromFocus = focusTaskId !== null;
            stopFocusSession("broken_down");
            setFocusTaskId(null);
            handleBreakDown(sessionTask.id, sessionTask.text, { starter: true, afterSheet: fromFocus });
          }
        : undefined,
  };

  const handleDelete = (id: string, text: string) => {
    if (state.todayLocked) return;
    Alert.alert("Remove this task?", `Remove "${text}" from today?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
          deleteTask(id);
        },
      },
    ]);
  };

  // "Not today": off today's list, into Saved for later (one store action,
  // so the task is never lost between the two steps).
  const handleNotToday = (id: string) => {
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    notToday(id);
    track("task_not_today", { source: state.todayLocked ? "set" : "open" });
    showToast("Saved for later.");
    AccessibilityInfo.announceForAccessibility("Saved for later.");
  };

  const handleAdd = (text: string) => {
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    addTask(text);
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <TodayHeader
            dateLabel={dateLabel}
            greeting={greetingLine}
            progress={progress}
            daysShowedUp={daysShowedUp}
          />

          <View
            style={
              twoColumn
                ? {
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 28,
                    paddingHorizontal: 32,
                    paddingTop: 24,
                    width: "100%",
                    maxWidth: 1100,
                    alignSelf: "center",
                  }
                : wide
                  ? // Nothing for a right column: one centred column instead of
                    // tasks squeezed next to empty space.
                    {
                      paddingHorizontal: 32,
                      paddingTop: 24,
                      gap: 14,
                      width: "100%",
                      maxWidth: 640,
                      alignSelf: "center",
                    }
                  : { paddingHorizontal: 20, paddingTop: 20, gap: 14 }
            }
            testID={twoColumn ? "today-two-column" : undefined}
          >
            <View style={twoColumn ? { flex: 1.25, gap: 14 } : { gap: 14 }}>
              {/* The Now bar (1.3): the running timer, first under the header. */}
              {focusSession && sessionTask ? (
                <NowBar
                  session={focusSession}
                  controls={sessionControls}
                  onOpen={() => openFocus(sessionTask.id, "now_bar")}
                />
              ) : null}
              {update ? <UpdateBanner update={update} onDismiss={dismissUpdate} /> : null}
              {toast && (
                <View
                  className="flex-row items-center gap-2 rounded-2xl p-3"
                  style={{ backgroundColor: `${colors.success}18` }}
                  accessibilityLiveRegion="polite"
                  testID="today-toast"
                >
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <Text className="flex-1 text-sm text-foreground">{toast}</Text>
                </View>
              )}

              {/* No draft to weigh it against: yesterday's leftovers come first. */}
              {rolloverOnTop && rolloverCard}

              {/* One calm card: three rows, hairlines between them. */}
              <View
                className="rounded-3xl overflow-hidden border"
                style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                testID="today-tasks"
              >
                {Array.from({ length: MAX_TASKS }).map((_, index) => {
                  const task = state.tasks[index];
                  const divider =
                    index > 0 ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 58 }} /> : null;
                  if (task) {
                    return (
                      <View key={task.id}>
                        {divider}
                        <TaskRow
                          task={task}
                          index={index}
                          hero={task.id === heroTaskId}
                          completed={isCompleted(task.id)}
                          editable={!state.todayLocked}
                          onToggle={() => handleToggle(task.id)}
                          onEdit={(text) => editTask(task.id, text)}
                          onDelete={() => handleDelete(task.id, task.text)}
                          onNotToday={() => handleNotToday(task.id)}
                          onBreakDown={
                            breakDownAvailable ? () => handleBreakDown(task.id, task.text) : undefined
                          }
                          breakingDown={breakingTaskId === task.id}
                          breakDownNeedsPlus={!hasPlus}
                          breakDownDisabled={breakingTaskId !== null && breakingTaskId !== task.id}
                          onToggleStep={(stepId) => toggleTaskStep(task.id, stepId)}
                          // Steps are a finishing aid, so clearing them is fine on a set day.
                          onClearSteps={() => clearTaskSteps(task.id)}
                          // A timer is fine on a set day too: it's for doing the day.
                          onTimer={() => openTimerMenu(task.id, task.text)}
                          session={focusSession?.taskId === task.id ? focusSession : null}
                          onOpenTimer={() => openFocus(task.id, "row")}
                        />
                      </View>
                    );
                  }
                  if (remainingSlots <= 0) return null;
                  return (
                    <View key={`empty-${index}`}>
                      {divider}
                      <AddTaskRow
                        remainingSlots={remainingSlots}
                        slotNumber={index + 1}
                        disabled={state.todayLocked}
                        onAdd={handleAdd}
                      />
                    </View>
                  );
                })}
              </View>

              {/* A full three-for-three day: the card and gradient say it all.
                  With room left, keep the line (and its Change on a set day). */}
              {!(progress.isPerfect && total >= MAX_TASKS) && (
              <StatusLine
                status={status}
                onLock={confirmLock}
                onUnlock={() => {
                  haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
                  unlockToday();
                  // The Change button disappears: tell VoiceOver what happened.
                  AccessibilityInfo.announceForAccessibility("You can change today's tasks again.");
                }}
              />
              )}
              {/* A full or set day hides the ideas entry, but saved items
                  must stay reachable (to view, remove, or swap in later). */}
              {(state.todayLocked || remainingSlots === 0) && state.parkedTasks.length > 0 && (
                <Pressable
                  onPress={() => {
                    setIdeasSavedOnly(true);
                    setIdeasOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Saved for later, ${state.parkedTasks.length} ${
                    state.parkedTasks.length === 1 ? "item" : "items"
                  }`}
                  hitSlop={8}
                  className="self-start flex-row items-center gap-1.5"
                  testID="saved-ideas-link"
                >
                  <Ionicons name="bookmark-outline" size={15} color={colors.primary} />
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    Saved for later ({state.parkedTasks.length})
                  </Text>
                </Pressable>
              )}
            </View>

            {rightHasContent && (
              <View style={twoColumn ? { flex: 1, gap: 14 } : { gap: 14 }}>

                {draft && (
                  <TomorrowDraftCard
                    // A new night's draft starts fresh; the same one keeps the user's ticks.
                    key={draft.forDate}
                    draft={draft}
                    remainingSlots={remainingSlots}
                    onUse={(picked) => {
                      // The card only offers what fits; trim again in case room just changed.
                      const accepted = picked.slice(0, remainingSlots);
                      if (accepted.length === 0) return;
                      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
                      // Everything else the card offered is saved for later, not lost.
                      applyTomorrowDraft(accepted, draft.tasks);
                      const skipped = draft.tasks.length - accepted.length;
                      track("tomorrow_draft_used", { count: accepted.length, skipped, source: draft.source });
                      const added = `Added ${accepted.length} ${accepted.length === 1 ? "task" : "tasks"}.`;
                      const message = skipped > 0 ? `${added} ${skipped} saved for later.` : added;
                      AccessibilityInfo.announceForAccessibility(message);
                      if (skipped > 0) showToast(message);
                    }}
                    onChange={() => setBrainDumpOpen(true)}
                    onDismiss={dismissTomorrowDraft}
                  />
                )}
                {/* With a draft (or on iPad): after it, as the quieter choice. */}
                {!rolloverOnTop && rolloverCard}
                {emptyMorning && !draft && (
                  <MorningHero
                    onDump={() => setBrainDumpOpen(true)}
                    onBrowseIdeas={() => setIdeasOpen(true)}
                  />
                )}
                {/* Morning and midday lead with the Coach's note; Start opens
                    focus mode on the task it's about. */}
                {note && coachTask && (
                  <CoachNote
                    text={note.text}
                    kind={note.kind}
                    source={note.source}
                    taskText={coachTask.text}
                    // One tap: a 5-minute starter (no length to choose), and
                    // focus mode on the task, with its first step.
                    onStart={() => {
                      startStarter(coachTask.id, "coach");
                      openFocus(coachTask.id, "coach");
                    }}
                  />
                )}
                {/* A finished day swaps these for the done card's quiet "Pull one more".
                    Under the coach's note they shrink to one quiet line of links. */}
                {ideasVisible && !emptyMorning && !draft && phase !== "done" && quietEntries && (
                  <View
                    className="flex-row items-center gap-2 px-1"
                    style={{ flexWrap: "wrap" }}
                    testID="quiet-entries"
                  >
                    <Pressable
                      onPress={() => setIdeasOpen(true)}
                      accessibilityRole="button"
                      // "Need ideas?" already ends the sentence.
                      accessibilityLabel={`${entry.label} Opens suggestions`}
                      style={{ minHeight: 44, justifyContent: "center" }}
                      testID="need-ideas"
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                        {entry.label}
                      </Text>
                    </Pressable>
                    <Text
                      className="text-sm"
                      style={{ color: colors.muted }}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      ·
                    </Text>
                    <Pressable
                      onPress={() => setBrainDumpOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Brain dump. Write everything down and pick today's tasks"
                      style={{ minHeight: 44, justifyContent: "center" }}
                      testID="brain-dump-entry"
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                        Brain dump
                      </Text>
                    </Pressable>
                  </View>
                )}
                {ideasVisible && !emptyMorning && !draft && phase !== "done" && !quietEntries && (
                  <View className={entry.prominent ? "gap-2" : "flex-row gap-2"}>
                    <Pressable
                      onPress={() => setIdeasOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`${entry.label}. Opens suggestions`}
                      className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3.5 border"
                      style={
                        entry.prominent
                          ? { borderColor: colors.primary, backgroundColor: colors.primary }
                          : { borderColor: colors.border, backgroundColor: colors.surface }
                      }
                      testID="need-ideas"
                    >
                      <Ionicons
                        name={source.personalized || entry.prominent ? "sparkles" : "bulb-outline"}
                        size={18}
                        color={entry.prominent ? colors.onPrimary : colors.primary}
                      />
                      <Text
                        className="text-base font-semibold"
                        style={{ color: entry.prominent ? colors.onPrimary : colors.primary }}
                      >
                        {entry.label}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setBrainDumpOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Brain dump. Write everything down and pick today's tasks"
                      className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3.5 border"
                      style={{ borderColor: colors.border }}
                      testID="brain-dump-entry"
                    >
                      <Ionicons name="create-outline" size={18} color={colors.primary} />
                      <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                        {total === 0 ? "Brain dump everything" : "Brain dump"}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* Morning: after the note's small first step, the week so far. */}
                {phase === "morning" && (
                  <WeekRow summary={week} daysShowedUp={daysShowedUp} onPress={openProgress} />
                )}
                {/* Midday: after the note's momentum, where it leads, and what tonight brings. */}
                {phase === "midday" && (
                  <>
                    {nextMilestone && <NextPathLink title={nextMilestone.title} onPress={openProgress} />}
                    {state.momentumSettings.eveningReflection && (
                      <View className="flex-row items-center gap-2 px-1" testID="tonight-teaser">
                        <Ionicons
                          name="moon-outline"
                          size={16}
                          color={colors.muted}
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                        />
                        <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
                          Tonight, one tap closes the day and drafts tomorrow.
                        </Text>
                      </View>
                    )}
                    <WeekRow summary={week} daysShowedUp={daysShowedUp} onPress={openProgress} />
                  </>
                )}

                {/* The one gradient in the app: the finished day. */}
                {phase === "done" && (
                  <DoneCard
                    total={total}
                    week={week}
                    eveningCheckIn={eveningCheckIn}
                    onPullOneMore={ideasVisible ? () => setIdeasOpen(true) : undefined}
                  />
                )}
                {eveningCheckIn && (
                  <>
                    <CompletionReflection
                      value={state.todayReflection}
                      result={state.todayReflectionResult}
                      allowMissed={!progress.isPerfect}
                      onSelectResult={handleEveningResult}
                      onSave={setTodayReflection}
                    />
                    <EveningResult
                      closing={closingDay}
                      note={isDayClosed(state.eveningClose, today) ? state.eveningClose?.note ?? null : null}
                      draft={
                        isDayClosed(state.eveningClose, today) &&
                        state.tomorrowDraft?.forDate === addDays(today, 1)
                          ? state.tomorrowDraft
                          : null
                      }
                    />
                  </>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <IdeasSheet
        visible={ideasOpen}
        savedOnly={ideasSavedOnly}
        onClose={() => {
          setIdeasOpen(false);
          setIdeasSavedOnly(false);
        }}
        goalTitle={state.momentumProfile.goalTitle}
        source={source}
        ideas={ideas}
        addedTexts={addedTexts}
        remainingSlots={remainingSlots}
        adaptationReason={state.adaptationSnapshot?.reason ?? null}
        canRegenerate={getMomentumAiProxyUrl() != null && hasPlanIdeas}
        regenerating={state.momentumPlanStatus === "loading"}
        failureMessage={failureMessage}
        onAdd={handleAdd}
        onAddAll={(texts) => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
          addTasks(texts);
        }}
        onRegenerate={() => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
          if (!hasPlus) {
            setIdeasOpen(false);
            showPaywall("new_ideas", {
              feature: "ai_ideas",
              afterSheet: true,
              resume: { kind: "new_ideas" },
            });
            return;
          }
          void requestMomentumPlan();
        }}
        parked={state.parkedTasks}
        onAddParked={(id) => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
          addParkedTask(id);
        }}
        onRemoveParked={removeParkedTask}
        onLock={total > 0 ? confirmLock : undefined}
      />

      <BrainDumpSheet
        visible={brainDumpOpen}
        onClose={() => setBrainDumpOpen(false)}
        openSlots={Math.max(1, remainingSlots)}
        freeAiLeft={freeAiLeft}
        onSort={async (text) => {
          const params = {
            text,
            openSlots: Math.max(1, remainingSlots),
            goalTitle: state.momentumProfile.goalTitle,
          };
          if (hasPlus) {
            const sorted = await sortBrainDump({
              ...params,
              ...(state.agendaEnabled ? { agenda: await readTodayAgenda() } : {}),
            });
            track("brain_dump_sorted", { source: sorted.result.source, count: sorted.result.picks.length });
            return sorted;
          }
          // Free plan: a few AI sorts to try it, then the simple on-device split.
          const left = await claimFreeAiDump();
          if (left === null) {
            // Not a tap on "Get Plus": the free sorts ran out (own source).
            track("plus_gate_hit", { feature: "brain_dump", source: "free_exhausted" });
            // Say so: a silent simple split looks like the AI got it wrong.
            return {
              result: localBrainDump(params.text, params.openSlots),
              notice: FREE_LIMIT_NOTICE,
              freeLimit: true,
            };
          }
          const tried = await sortBrainDump(params);
          // The AI couldn't be reached: that one doesn't count.
          if (tried.result.source !== "ai") void refundFreeAiDump();
          const sorted =
            tried.result.source === "ai" ? { ...tried, notice: freeAiDumpNotice(left) } : tried;
          setFreeAiLeft(tried.result.source === "ai" ? left : left + 1);
          track("brain_dump_sorted", {
            source: sorted.result.source,
            count: sorted.result.picks.length,
            plus: false,
          });
          return sorted;
        }}
        onUpgrade={
          hasPlus
            ? undefined
            : () => {
                setBrainDumpOpen(false);
                showPaywall("brain_dump", {
                  feature: "brain_dump",
                  afterSheet: true,
                  resume: { kind: "brain_dump" },
                });
              }
        }
        onConfirm={(picks, parked) => {
          // A slot may have filled while the sheet was open: park what won't fit.
          const accepted = picks.slice(0, remainingSlots);
          const saved = [...picks.slice(remainingSlots), ...parked];
          if (accepted.length > 0) {
            haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
            addTasks(accepted);
          }
          parkTasks(saved);
          setBrainDumpOpen(false);
          const message = brainDumpToast(accepted.length, saved.length);
          if (message) showToast(message);
        }}
      />

      {focusTask && (
        <FocusMode
          task={focusTask}
          startLine={focusStartLine}
          session={focusSession?.taskId === focusTask.id ? focusSession : null}
          initialCustom={focusCustom}
          onToggleStep={(stepId) => toggleTaskStep(focusTask.id, stepId)}
          // Starting here replaces a session on another task.
          onStartTimer={(minutes) => startTimer(focusTask.id, minutes, "focus")}
          controls={sessionControls}
          onDone={(timer) => {
            // The normal path, so the haptic, celebration and win-back all happen.
            handleToggle(focusTask.id);
            track("focus_completed", { timer });
            setFocusTaskId(null);
            announceDone(focusTask.text);
          }}
          onClose={() => setFocusTaskId(null)}
        />
      )}

      <CelebrationOverlay visible={showCelebration} onDismiss={dismissCelebration} />

      <FirstRun
        // iOS shows one modal at a time: a day change mid-flow shows the rollover.
        visible={firstRunActive && !state.pendingRollover}
        onStep={(step) => track("onboarding_step", { step })}
        onSort={async (text) => {
          // The first dump is sorted by the AI for everyone (it's the moment
          // that shows what the app does); it falls back to the local split.
          // Don't keep a new user waiting: after 12 s use the simple split.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const fallback = new Promise<Awaited<ReturnType<typeof sortBrainDump>>>((resolve) => {
            timer = setTimeout(
              () => resolve({ result: localBrainDump(text, 3), notice: "timeout" }),
              FIRST_SORT_TIMEOUT_MS,
            );
          });
          // AI when the user has Plus, or for the one free first-run sort (once
          // per install, persisted: "Reset all data" doesn't grant another), or
          // else as one of the free Today sorts. Otherwise the simple split,
          // and it says so (a silent split looks like the AI got it wrong).
          // The first-run claim is always made on the first sort (even with
          // Plus), so a Plus check that later turns out free can't mint a
          // second one after "Reset all data".
          const firstClaim = !firstRunAiUsed.current && (await claimFirstAiSort());
          firstRunAiUsed.current = true;
          let freeLeft: number | null = null;
          if (!hasPlus && !firstClaim) freeLeft = await claimFreeAiDump();
          const useAi = hasPlus || firstClaim || freeLeft !== null;
          if (!useAi) track("plus_gate_hit", { feature: "brain_dump", source: "free_exhausted" });
          let sorted: SortedBrainDump = useAi
            ? await Promise.race([sortBrainDump({ text, openSlots: 3, goalTitle: null }), fallback])
            : { result: localBrainDump(text, 3), notice: null, freeLimit: true };
          clearTimeout(timer);
          if (freeLeft !== null) {
            // A free sort that didn't reach the AI doesn't count; one that did
            // says how many are left (never spent silently).
            if (sorted.result.source !== "ai") void refundFreeAiDump();
            else sorted = { ...sorted, notice: freeAiDumpNotice(freeLeft), freeSortUsed: true };
          }
          track("brain_dump_sorted", { source: sorted.result.source, count: sorted.result.picks.length });
          return sorted;
        }}
        onSet={(picks, parked) => {
          if (picks.length > 0) addTasks(picks.slice(0, remainingSlots));
          parkTasks([...picks.slice(remainingSlots), ...parked]);
        }}
        onAskNudge={async () => (await requestNotificationPermission()) === "granted"}
        showWidgetStep={Platform.OS === "ios"}
        // Relaunched after setting the three: pick up at the nudge, not the dump.
        // Read only when it (re)appears, e.g. after a rollover mid-flow.
        resumeCount={state.tasks.length}
        onFinish={() => {
          markOnboardingSeen();
          setFirstRunActive(false);
          track("onboarding_completed", { source: state.tasks.length > 0 ? "dump" : "own" });
          // Offer the trial once, at the end of first run (closable).
          if (paywallEnabled && !hasPlus) showPaywall("onboarding", { afterSheet: true });
        }}
      />

    </ScreenContainer>
  );
}
