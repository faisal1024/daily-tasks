import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  AppState as RNAppState,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
// gesture-handler's scroll view, so a row's drag handle can be told to win
// over scrolling (see useTaskReorder's scrollRef).
import { ScrollView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";

import { useColors } from "@/hooks/use-colors";
import { useRoutinesCardShownEvent, useTodaysRoutines } from "@/hooks/use-todays-routines";
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
import { NagIntro } from "@/components/daily-tasks/nag-intro";
import { RoutinesManager } from "@/components/daily-tasks/routines-manager";
import { NextPathLink } from "@/components/daily-tasks/next-path-link";
import { FirstRun } from "@/components/daily-tasks/first-run";
import { FirstDaysCardsView, useFirstDays } from "@/components/daily-tasks/first-days-cards";
import { pickedNote, saveFirstDays, startFirstDays } from "@/lib/daily-tasks/first-days";
import type { FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { FocusMode } from "@/components/daily-tasks/focus-mode";
import { DoneCard } from "@/components/daily-tasks/done-card";
import { ShareDaySheet } from "@/components/daily-tasks/share-day-sheet";
import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import { StatusLine } from "@/components/daily-tasks/status-line";
import { ReorderGhost, ReorderRow, reorderRowKey, useTaskReorder } from "@/components/daily-tasks/task-reorder";
import { TaskRow } from "@/components/daily-tasks/task-row";
import { TodayHeader } from "@/components/daily-tasks/today-header";
import { TodaysRoutinesCard } from "@/components/daily-tasks/todays-routines-card";
import { TrialNote } from "@/components/daily-tasks/trial-note";
import { UpdateBanner } from "@/components/daily-tasks/update-banner";
import { WeekRow } from "@/components/daily-tasks/week-row";
import { useAppUpdate } from "@/hooks/use-app-update";
import { SHEET_SWAP_DELAY_MS, usePaywallGate } from "@/hooks/use-paywall-gate";
import { captureToast } from "@/lib/daily-tasks/capture";
import { useHour } from "@/hooks/use-hour";
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible";
import { useScreenFocused } from "@/hooks/use-screen-focused";
import { useWhatsNew } from "@/hooks/use-whats-new";
import { useAppActive } from "@/hooks/use-app-active";
import { useFocusSessionCues } from "@/hooks/use-focus-session-cues";
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
  claimFreeBreakDown,
  freeAiDumpNotice,
  freeAiDumpsLeft,
  freeBreakDownBadge,
  freeBreakDownsLeft,
  refundFreeAiDump,
  refundFreeBreakDown,
  spendFreeBreakDowns,
} from "@/lib/daily-tasks/free-uses";
import {
  FREE_LIMIT_NOTICE,
  localBrainDump,
  requestBreakDown,
  sortBrainDump,
  type SortedBrainDump,
} from "@/lib/daily-tasks/ai-helpers";
import { track } from "@/lib/daily-tasks/analytics";
import { buildBasicMemory, memoryStatsPayload, withMovedReasons } from "@/lib/daily-tasks/coach-memory";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { actionSheetOpen, showActionSheet } from "@/lib/daily-tasks/action-sheet";
import { AHA_PAYWALL_DELAY_MS, fillsDay, shouldOfferAhaPaywall } from "@/lib/daily-tasks/aha-paywall";
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
import { addDays, fromDateKey, greetingFor, greetingText, storeDayFor, todayKey } from "@/lib/daily-tasks/date";
import { recordPlusUse } from "@/lib/daily-tasks/trial-note";
import { draftDueReasons, savedItemsView, whenChoices, withDueTomorrow } from "@/lib/daily-tasks/resurface";
import { sessionEndedAnnouncement, STARTER_MINUTES, type FocusSessionSource } from "@/lib/daily-tasks/focus-session";
import { durationWords, timerMenuLengths } from "@/lib/daily-tasks/focus-timer";
import { loadLastTimer, saveLastTimer } from "@/lib/daily-tasks/focus-timer-storage";
import { nextIncompleteMilestone, pathSourceOf } from "@/lib/daily-tasks/milestones";
import { buildMilestoneIdeaGroup, hasMilestoneIdeaToAdd } from "@/lib/daily-tasks/milestone-ideas";
import { generateMomentumSuggestions } from "@/lib/daily-tasks/momentum";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import {
  achievementOnFirstTick,
  reviewDueStatus,
  shouldRequestReview,
  type ReviewTrigger,
} from "@/lib/daily-tasks/review-prompt";
import { countShowedUpDays } from "@/lib/daily-tasks/streaks";
import { nextDayPhrase, nextRoutineUp } from "@/lib/daily-tasks/routines";
import { useDailyTasks, type RoutineAddSource } from "@/lib/daily-tasks/store";
import {
  brainDumpToast,
  LOCKED_CHANGE_NOTE,
  clockTimeOf,
  formatClockTime,
  ideasEntry,
  ideasSource,
  isPerfectDayTransition,
  lockConfirmation,
  showIdeasEntry,
  todayProgress,
  todayStatus,
  unlockConfirmation,
  UNLOCKED_NOTE,
} from "@/lib/daily-tasks/today-view";
import {
  openTaskCount,
  openTaskIndex,
  reorderAnnouncement,
  reorderHandleFits,
  reorderOptions,
} from "@/lib/daily-tasks/reorder";
import { buildWeekSummary, todayPhase } from "@/lib/daily-tasks/today-phase";
import { MAX_TASKS } from "@/lib/daily-tasks/types";
import { claimFirstTick, FIRST_TICK_TOAST, isFirstTickEver, tickedBefore } from "@/lib/daily-tasks/first-tick";
import {
  claimWelcomeShown,
  showsWelcomeBack,
  welcomeBack,
  welcomeBackLine,
} from "@/lib/daily-tasks/welcome-back";
import {
  NAG_ANNOUNCEMENT_ID,
  NAG_FIRST_DAYS_ID,
  NAG_ON_TOAST,
  todayIdleForWhatsNew,
  whatsNewActivity,
  whatsNewMoment,
} from "@/lib/daily-tasks/whats-new";
import {
  buildEveningInput,
  closeDay,
  draftToShow,
  isDayClosed,
  showEveningCheckIn,
} from "@/lib/daily-tasks/evening";
import { eveningTeaserLine, showsEveningTeaser } from "@/lib/daily-tasks/evening-teaser";
import type { ReflectionResult, Task, TaskWhen } from "@/lib/daily-tasks/types";

/** Wait this long after the app becomes active before asking. */
const REVIEW_SETTLE_MS = 2000;
// After the system rating prompt is requested, no paywall for this long: the
// two must never stack (the rating alert may still be up).
const RATING_QUIET_MS = 10_000;

type Unlock =
  // `starter`: from the timer's check-in, so a 5-minute starter is offered after.
  | { kind: "break_down"; taskId: string; text: string; starter?: boolean }
  | { kind: "brain_dump" }
  | { kind: "new_ideas" }
  // The evening teaser (1.5): once Plus, the coach drafts that day's close again.
  | { kind: "evening_draft"; day: string };

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
    addSuggestions,
    editTask,
    deleteTask,
    notToday,
    moveTask,
    makeTaskNext,
    toggleTask,
    lockToday,
    unlockToday,
    noteOpenEdit,
    resolveRollover,
    markOnboardingSeen,
    markReorderHintSeen,
    requestNotificationPermission,
    notificationPermission,
    setNotificationsEnabled,
    setNotificationEnabled,
    setTodayReflection,
    setTodayReflectionResult,
    requestMomentumPlan,
    markReviewPrompted,
    markReviewDue,
    clearReviewDue,
    focusDoneCount,
    parkTasks,
    removeParkedTask,
    setParkedWhen,
    addParkedTask,
    swapParkedTask,
    updateMomentumProfile,
    addRoutineToToday,
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
    focusPrompt,
    clearFocusPrompt,
    nagNote,
    clearNagNote,
    dumpPrompt,
    clearDumpPrompt,
    captureNotice,
    clearCaptureNotice,
  } = useDailyTasks();
  const {
    paywallEnabled,
    paywallSource,
    purchaseCount,
    openPaywall,
    winBackDue,
    winBackOfferPending,
    checkWinBackOffer,
    ahaPaywallState,
  } = usePlus();
  const winBackDueRef = useRef(winBackDue);
  winBackDueRef.current = winBackDue;

  // First run stays up until its last step; onboarding is marked seen only
  // then, so a relaunch mid-way starts again at the dump (or, with tasks
  // already on today, just finishes).
  const [firstRunActive, setFirstRunActive] = useState(false);
  const firstRunAiUsed = useRef(false);
  // Bumped once first run has written the Today cards' record (1.5).
  const [firstDaysVersion, setFirstDaysVersion] = useState(0);
  useEffect(() => {
    if (ready && !state.hasSeenOnboarding && !state.pendingRollover && !firstRunActive) {
      setFirstRunActive(true);
    }
    // Only on opening: tasks added during first run mustn't change where it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.hasSeenOnboarding, state.pendingRollover]);

  // What to pick back up once the paywall closes (bought or not): see
  // resume.current below.
  const resume = useRef<(unlock: Unlock) => void>(() => {});
  const showPaywall = usePaywallGate<Unlock>((unlock) => resume.current(unlock));
  const { update, dismiss: dismissUpdate } = useAppUpdate();
  // iPad (and large landscape phones): tasks on the left, ideas and the
  // evening check-in on the right, centred with a comfortable max width.
  const { width, fontScale } = useWindowDimensions();
  const wide = width >= 768;
  // Room for a row's drag handle; without it the row's menu moves it instead.
  const handleFits = reorderHandleFits(width, fontScale);

  const [showCelebration, setShowCelebration] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  // Evening close in flight.
  const [closingDay, setClosingDay] = useState(false);
  const closingRef = useRef(false);
  // The last brain-dump sort's soft dates (1.6 F), saved with what's parked.
  const dumpDatesRef = useRef<Record<string, TaskWhen> | undefined>(undefined);
  // The day whose AI close fell back with nothing drafted (offers "Try again").
  const [eveningAiFailedFor, setEveningAiFailedFor] = useState<string | null>(null);
  // Opened from "Saved for later" (full day): show just the saved items.
  const [ideasSavedOnly, setIdeasSavedOnly] = useState(false);
  // However the sheet closes (its button, a lock, rollover, the paywall), the
  // next open starts in the normal view.
  // Opened from "Next on your path": the sheet brings the milestone group into view.
  const [ideasFocusMilestone, setIdeasFocusMilestone] = useState(false);
  useEffect(() => {
    if (!ideasOpen) {
      setIdeasSavedOnly(false);
      setIdeasFocusMilestone(false);
    }
  }, [ideasOpen]);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  // Routines (1.3), reached from the Ideas sheet's footer when there are none
  // yet: Ideas closes first (one modal at a time on iOS).
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const routinesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (routinesTimer.current) clearTimeout(routinesTimer.current);
    },
    [],
  );
  const openRoutinesFromIdeas = () => {
    setIdeasOpen(false);
    if (routinesTimer.current) clearTimeout(routinesTimer.current);
    routinesTimer.current = setTimeout(() => {
      routinesTimer.current = null;
      setRoutinesOpen(true);
    }, SHEET_SWAP_DELAY_MS);
  };
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
  // A "locked" note isn't a success: it shows a lock, not a tick.
  const [toastTone, setToastTone] = useState<"done" | "locked">("done");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, tone: "done" | "locked" = "done") => {
    setToast(message);
    setToastTone(tone);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  // 1.6 G: a nag's Snooze 1 hour says when the next nag comes.
  useEffect(() => {
    if (!nagNote) return;
    showToast(nagNote.message);
    clearNagNote();
  }, [nagNote, clearNagNote]);
  const [breakingTaskId, setBreakingTaskId] = useState<string | null>(null);
  // A ref, not just state: two quick taps in one render must not both start.
  const breakingRef = useRef<string | null>(null);
  const breakDownAvailable = proxyRouteUrl(getMomentumAiProxyUrl(), "break-down") != null;
  // Read when a free try returns: Plus may have been confirmed while it ran.
  const plusConfirmedRef = useRef(plusConfirmed);
  plusConfirmedRef.current = plusConfirmed;
  // 1.5: a free user's one Break it down try (free-uses.ts); null while it loads.
  const [freeBreakDowns, setFreeBreakDowns] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void freeBreakDownsLeft().then((left) => {
      if (!cancelled) setFreeBreakDowns(left);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Saved for later as Ideas shows it: what's for today first (1.6 F).
  const savedItems = useMemo(() => savedItemsView(state.parkedTasks, today), [state.parkedTasks, today]);
  const savedDueToday = savedItems.filter((item) => item.dueToday).length;
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
  // The AI coach closes the day (Plus with the proxy): the evening copy only
  // promises a draft when one will come (1.5).
  // Confirmed Plus only, so a free user never sees "drafts tomorrow" while Plus is checked.
  const eveningAiAvailable = proxyRouteUrl(getMomentumAiProxyUrl(), "evening") != null;
  const coachDrafts = plusConfirmed && eveningAiAvailable;
  const dayClosed = isDayClosed(state.eveningClose, today);
  const closedDraft =
    dayClosed && state.tomorrowDraft?.forDate === addDays(today, 1) ? state.tomorrowDraft : null;
  // A free user's good day: a teaser of tomorrow with one real line (1.5).
  const eveningTeaser = showsEveningTeaser({
    paywallEnabled,
    hasPlus,
    eveningAiAvailable,
    dayClosed,
    hasDraft: closedDraft !== null,
    taskCount: total,
    completedCount: progress.completed,
  })
    ? eveningTeaserLine({
        tasks: state.tasks,
        parkedTasks: state.parkedTasks,
        plan: state.momentumPlan,
        completedMilestoneIds: state.completedMilestoneIds,
        today,
      })
    : null;
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
  // Routines due today and not on the list yet (1.3): suggested on Today
  // (under the task card) and in Ideas. One selector for both (and for the
  // routines sheet's save note), so an added routine leaves both at once.
  const todaysRoutines = useTodaysRoutines();
  const dueRoutines = todaysRoutines.due;
  const routinesBlock = todaysRoutines.block;
  // Hidden once every task is done, the day is closed, or while last night's
  // draft leads (it comes back once the draft is used or dismissed).
  const showRoutinesCard = ready && todaysRoutines.show;
  useRoutinesCardShownEvent({ show: showRoutinesCard, today, count: dueRoutines.length, block: routinesBlock });
  // Ideas' footer, when nothing is due today: "Next: Stretch on Monday".
  const nextRoutine = useMemo(() => {
    const next = nextRoutineUp(state.routines, today);
    return next ? { text: next.routine.text, when: nextDayPhrase(next) } : null;
  }, [state.routines, today]);
  const reduceMotion = useReducedMotion();
  // Once the day is set or under way, the next thing to do is the card's hero.
  const heroTaskId =
    (state.todayLocked || completedCount > 0) && !progress.isPerfect
      ? (state.tasks.find((task) => !isCompleted(task.id))?.id ?? null)
      : null;
  // Reordering (1.4): pick which open task is next, by dragging a row's
  // handle or with "Do this next". Fine on a set day: the plan is the same.
  const scrollRef = useRef<ScrollView>(null);
  // The row VoiceOver's focus goes back to after a move (the rows change places).
  const [movedFocus, setMovedFocus] = useState<{ id: string; tick: number } | null>(null);
  // The one-time hint goes once a reorder has happened.
  const [reordered, setReordered] = useState(false);
  // A move to another place among the open tasks: a drop ("drag"), or one
  // place up or down from VoiceOver or the menu ("move").
  const reorderTo = (id: string, toIndex: number, fromIndex: number, source: "drag" | "move") => {
    if (toIndex === fromIndex) return;
    const text = state.tasks.find((task) => task.id === id)?.text;
    moveTask(id, toIndex);
    setReordered(true);
    track("task_reordered", { source });
    if (text) announcePolitely(reorderAnnouncement(text, toIndex, toIndex < fromIndex ? "up" : "down"));
  };
  const reorder = useTaskReorder({
    tasks: state.tasks,
    completedIds: state.todayCompletions,
    reduceMotion,
    heroId: heroTaskId,
    scrollRef,
    onPickUp: () => {
      // A task's words being edited (on any row) are saved first: the blur
      // commits them. The drop mounts every row anew, which would lose them,
      // and the drag takes the touch, so nothing else would blur the field.
      Keyboard.dismiss();
      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    },
    // A tick as the held row passes each place.
    onSlotChange: () => haptic(() => Haptics.selectionAsync()),
    onDrop: (id, toIndex, fromIndex) => {
      // Back where it started: nothing happened, so nothing is felt.
      if (toIndex === fromIndex) return;
      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      reorderTo(id, toIndex, fromIndex, "drag");
    },
  });
  // The list as it is now, for a choice made in a menu that was opened
  // earlier: the menu's handlers still hold the list as it was then, and a
  // widget tick or midnight may have changed it underneath.
  const listNow = useRef({ tasks: state.tasks, completions: state.todayCompletions, today });
  listNow.current = { tasks: state.tasks, completions: state.todayCompletions, today };
  const handleMove = (id: string, direction: "up" | "down") => {
    // The list as it is now, not as it was when the menu opened.
    const now = listNow.current;
    const from = openTaskIndex(now.tasks, now.completions, id);
    if (from < 0) return;
    const options = reorderOptions(now.tasks, now.completions, id);
    // "Up" from the second place is "Do this next": still a move if it's asked for.
    if (direction === "up" ? from < 1 : !options.canMoveDown) return;
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    // The rows ease into their new places (not with Reduce Motion).
    reorder.animateNext(() => reorderTo(id, from + (direction === "up" ? -1 : 1), from, "move"));
    setMovedFocus((current) => ({ id, tick: (current?.tick ?? 0) + 1 }));
  };
  const handleDoNext = (id: string, text: string) => {
    const now = listNow.current;
    // Already next, done or gone by now (the menu was opened before a widget
    // tick or another change): the store would do nothing, so nothing is
    // tracked or said.
    if (!reorderOptions(now.tasks, now.completions, id).canDoNext) return;
    // Past midnight with yesterday still on screen: the store turns the day
    // first and the move lands on the new day, where this task may not be.
    // Let it through, but don't count or announce a move that may not happen.
    if (storeDayFor(now.today, todayKey()) !== now.today) {
      makeTaskNext(id);
      return;
    }
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    reorder.animateNext(() => makeTaskNext(id));
    setReordered(true);
    setMovedFocus((current) => ({ id, tick: (current?.tick ?? 0) + 1 }));
    track("task_reordered", { source: "next" });
    // After the menu has closed, and without cutting its own words off.
    announcePolitely(`${text} is next`);
  };
  // The first time two or more tasks are open: one quiet line under the card
  // saying they can be reordered. Shown for this visit, then never again.
  const openCount = openTaskCount(state.tasks, state.todayCompletions);
  const reorderHintDue =
    ready && state.hasSeenOnboarding && !firstRunActive && !state.reorderHintSeen && openCount >= 2;
  const [reorderHintLatched, setReorderHintLatched] = useState(false);
  if (reorderHintDue && !reorderHintLatched) setReorderHintLatched(true);
  useEffect(() => {
    if (reorderHintDue) markReorderHintSeen();
  }, [reorderHintDue, markReorderHintSeen]);
  const showReorderHint = (reorderHintDue || reorderHintLatched) && openCount >= 2 && !reordered;
  const handleAddRoutine = (id: string, source: RoutineAddSource) => {
    const text = dueRoutines.find((routine) => routine.id === id)?.text;
    // The last row leaving takes the card with it: ease it out rather than jump.
    const lastOnCard = showRoutinesCard && dueRoutines.length === 1 && dueRoutines[0].id === id;
    if (lastOnCard && routinesBlock === null && !reduceMotion) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    if (!addRoutineToToday(id, source)) return;
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    // The row just disappears: say what happened.
    if (text) AccessibilityInfo.announceForAccessibility(`Added ${text} to today`);
  };
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
    // Counted for the day-5 trial note (an AI note is a Plus one).
    if (noteSource === "ai") void recordPlusUse("coach_note");
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
  const openFocus = (
    taskId: string,
    source: "coach" | "row" | "row_words" | "widget" | "siri" | "live_activity" | "notification",
    custom = false,
  ) => {
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
  // A task's focus screen from outside (1.3): "start my next task" (widget,
  // Siri) while another task's timer is on (the screen says a start there
  // stops the other; never replaced silently), a tap on the Live Activity,
  // or a tap on the end notification with its check-in due.
  // With the what's-new sheet up, that sheet goes first (one modal at a time
  // on iOS) and the focus screen follows once it has animated away.
  // Set further down, where the sheet is declared.
  const whatsNewStepAside = useRef<() => boolean>(() => false);
  const focusPromptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (focusPromptTimer.current) clearTimeout(focusPromptTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!focusPrompt) return;
    clearFocusPrompt();
    if (!state.tasks.some((task) => task.id === focusPrompt.taskId && !isCompleted(task.id))) return;
    if (focusPromptTimer.current) clearTimeout(focusPromptTimer.current);
    focusPromptTimer.current = null;
    if (!whatsNewStepAside.current()) {
      openFocus(focusPrompt.taskId, focusPrompt.source);
      return;
    }
    const { taskId, source } = focusPrompt;
    focusPromptTimer.current = setTimeout(() => {
      focusPromptTimer.current = null;
      // Ticked or removed meanwhile: the focus screen closes itself.
      openFocus(taskId, source);
    }, SHEET_SWAP_DELAY_MS);
    // Only when a new prompt arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPrompt]);
  // What's said after the focus screen or the check-in acts (announceLater):
  // "Done: <task>" after ✓ Mark task done, "Timer ended. <task> is still
  // open." after Take a break.
  const focusDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (focusDoneTimer.current) clearTimeout(focusDoneTimer.current);
    },
    [],
  );
  // The focus session (1.3): one timer at a time, on its task's row (the pill,
  // and the check-in under it at zero) and on the focus screen. Its start and end are said
  // (and the end felt) here, since Today is always mounted.
  const focusSession = state.focusSession;
  // For code that runs after the paywall (see runBreakDown).
  const focusSessionRef = useRef(focusSession);
  focusSessionRef.current = focusSession;
  const sessionTask = focusSession ? (state.tasks.find((task) => task.id === focusSession.taskId) ?? null) : null;
  // Not in a background launch (a Live Activity button): nothing to say to anyone.
  const appActive = useAppActive();
  useFocusSessionCues(focusSession, ready && appActive);
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
  // A task's timer button: 5 / 10 / 20 minutes (the last used first) or
  // Custom…, which opens the focus screen with its length wheel. It says so
  // when this would stop another task's timer.
  const openTimerMenu = (taskId: string, text: string, anchor: number | null) => {
    const lengths = timerMenuLengths(lastTimer);
    const title = `Focus on “${text}”`;
    const replaces =
      sessionTask && sessionTask.id !== taskId ? `This stops the timer on “${sessionTask.text}”.` : undefined;
    if (Platform.OS === "ios") {
      const labels = [...lengths.map((minutes) => capitalize(durationWords(minutes))), "Custom…"];
      showActionSheet(
        {
          title,
          message: replaces,
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
          tintColor: colors.primary,
          // iPad shows it as a popover from the button.
          ...(anchor !== null ? { anchor } : {}),
        },
        (index) => {
          if (index < lengths.length) startTimer(taskId, lengths[index], "row");
          else if (index === lengths.length) openFocus(taskId, "row", true);
        },
      );
      return;
    }
    // Android shows at most three buttons: the last used length, or the
    // focus screen's full choice.
    Alert.alert(title, replaces, [
      { text: capitalize(durationWords(lengths[0])), onPress: () => startTimer(taskId, lengths[0], "row") },
      { text: "Choose length…", onPress: () => openFocus(taskId, "row") },
      { text: "Cancel", style: "cancel" },
    ]);
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
      // "Unfinished from Tuesday": named for the day they're from (1.5 D).
      today={today}
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
  // First run's old last screens as Today cards (1.5): the morning nudge from
  // the first check-off (or the next day), the widget tip from a later launch
  // or day after the first finished day. Never with first run or the rollover
  // card up. The state lives here, so where the cards sit never reloads it.
  // Something was checked off on an earlier day (for "Meet Nag mode" on its own, 1.5 D).
  const tickedEarlier = useMemo(() => tickedBefore(state.history, today), [state.history, today]);
  // "Meet Nag mode" opened from a new install's Nag card (1.5 D).
  const [nagCardOpen, setNagCardOpen] = useState(false);
  // "Share your day" (1.5 D): the finished day's picture, from the done card.
  const [shareOpen, setShareOpen] = useState(false);
  const firstDays = useFirstDays({
    today,
    appActive,
    nagOn: state.notifications.style === "nag",
    // "Meet Nag mode" on its own only once the app has done something for them.
    tickedEver: completedCount > 0 || tickedEarlier,
    onOpenNag: () => setNagCardOpen(true),
    active: ready && state.hasSeenOnboarding && !firstRunActive && !state.pendingRollover && appActive,
    version: firstDaysVersion,
    checkedOff: completedCount > 0,
    dayFinished: progress.isPerfect,
    permission: notificationPermission,
    onAskNudge: async () => {
      const status = await requestNotificationPermission();
      if (status === "granted") {
        // "Yes" means the reminders it names: make sure they're on.
        setNotificationsEnabled(true);
        setNotificationEnabled("morning", true);
      }
      return status;
    },
  });
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
  // Back after two days or more (1.5 D): one calm line until the first tick.
  const welcome = useMemo(() => welcomeBack(state.history, today), [state.history, today]);
  const showWelcome =
    ready &&
    state.hasSeenOnboarding &&
    showsWelcomeBack({ welcome, completedCount, firstRun: firstRunActive });
  const welcomeDays = showWelcome && welcome ? welcome.days : 0;
  useEffect(() => {
    if (!welcomeDays || !appActive) return;
    let cancelled = false;
    void claimWelcomeShown(today).then((first) => {
      if (first && !cancelled) track("welcome_back_shown", { count: welcomeDays });
    });
    return () => {
      cancelled = true;
    };
  }, [welcomeDays, appActive, today]);
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
  const allIdeas: IdeaItem[] = useMemo(
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
  // Suggestions for the next open milestone (1.4): the AI ones the plan marked
  // for it (Plus), otherwise built-in ones. None without a path or once every
  // milestone is reached.
  const planMilestones = state.momentumPlan?.milestones;
  const starterGoalTitle =
    state.momentumPlan && pathSourceOf(state.momentumPlan) === "template" ? state.momentumPlan.goalTitle : null;
  const milestoneGroup = useMemo(
    () =>
      planMilestones
        ? buildMilestoneIdeaGroup({
            milestones: planMilestones,
            completedMilestoneIds: state.completedMilestoneIds,
            today,
            suggestions: planIdeas,
            // Listed elsewhere in the sheet: routines due today and, without plan ideas, the starters.
            otherTexts: [...dueRoutines.map((routine) => routine.text), ...(hasPlanIdeas ? [] : genericIdeas)],
            // A starter path's steps ("Start small") don't name the goal: the built-in lines do.
            starterGoalTitle,
          })
        : null,
    [planMilestones, state.completedMilestoneIds, today, planIdeas, dueRoutines, hasPlanIdeas, genericIdeas, starterGoalTitle],
  );
  // An idea shown in the milestone group isn't listed again below it.
  const ideas: IdeaItem[] = useMemo(() => {
    if (!milestoneGroup || milestoneGroup.source !== "ai") return allIdeas;
    const grouped = new Set(milestoneGroup.ideas.map((idea) => idea.id));
    return allIdeas.filter((idea) => !grouped.has(idea.id));
  }, [allIdeas, milestoneGroup]);
  const source = ideasSource(state.momentumPlan, state.momentumProfile.goalTitle);
  const failureMessage =
    state.momentumPlanStatus === "error"
      ? aiFailureMessage(state.momentumPlanError, {
          showingAiIdeas: state.momentumPlan?.provider === "ai",
        })
      : null;

  // Rating asks (1.3): a happy moment (perfect day, a focus session ended with
  // its task done, a showed-up milestone, a good week) may earn one, which is
  // then asked on a later app open (below). The policy reads the latest state.
  // Earning one only checks the first day, onboarding and the cooldown; the
  // paywall, a focus session and the rest are checked when it's asked.
  const reviewInputs = useRef({
    history: state.history,
    today,
    lastReviewPromptAt: state.lastReviewPromptAt,
    onboardingVisible: false,
  });
  reviewInputs.current = {
    history: state.history,
    today,
    lastReviewPromptAt: state.lastReviewPromptAt,
    onboardingVisible: !state.hasSeenOnboarding || firstRunActive,
  };
  const considerReview = useCallback(
    (trigger: ReviewTrigger) => {
      if (shouldRequestReview({ ...reviewInputs.current, now: new Date() })) {
        markReviewDue(trigger);
      }
    },
    [markReviewDue],
  );

  // A focus session just ended with "Mark task done" (or its task ticked).
  // A Done on the Live Activity while the app is backgrounded deliberately
  // doesn't earn one: nobody's looking at the app.
  const seenFocusDone = useRef(focusDoneCount);
  useEffect(() => {
    if (!ready || focusDoneCount === seenFocusDone.current) return;
    seenFocusDone.current = focusDoneCount;
    if (appActive) considerReview("focus_done");
  }, [ready, appActive, focusDoneCount, considerReview]);

  // Ticking today's first task done may complete an achievement: days showed
  // up reaching 7, 30 or 100, or 5 of the last 7. Only on that tick, never on
  // mount, a new day or in the background. Re-ticking it is harmless: the
  // first saved ask wins, and the cooldown follows an ask.
  const showedUpCount = useMemo(
    () => countShowedUpDays(state.history, today, { includeToday: total > 0 }),
    [state.history, today, total],
  );
  const firstTickBaseline = useRef<{ day: string; completed: number } | null>(null);
  useEffect(() => {
    if (!ready) return;
    const previous = firstTickBaseline.current;
    firstTickBaseline.current = { day: today, completed: completedCount };
    if (!previous || previous.day !== today || !appActive) return;
    if (previous.completed !== 0 || completedCount === 0) return;
    const achievement = achievementOnFirstTick(showedUpCount, week.showedUpDays);
    if (achievement) considerReview(achievement);
  }, [ready, appActive, today, completedCount, showedUpCount, week.showedUpDays, considerReview]);

  // Celebrate (and maybe ask for a rating) only at the moment the third task is
  // checked off, never just because the app opened on a finished day.
  const previousCompleted = useRef<number | null>(null);
  const celebratedDay = useRef<string | null>(null);
  const reviewInFlight = useRef(false);
  // When the rating prompt was last requested (0: not this session). With
  // reviewInFlight, keeps the aha and win-back paywalls off a rating ask.
  const ratingAskedAt = useRef(0);
  const ratingRecent = () =>
    reviewInFlight.current || Date.now() - ratingAskedAt.current < RATING_QUIET_MS;
  useEffect(() => {
    if (!ready) return;
    const transition = isPerfectDayTransition({
      previousCompleted: previousCompleted.current,
      completed: completedCount,
      total,
    });
    previousCompleted.current = completedCount;

    // Once per day: un-checking and re-checking the third task doesn't replay it.
    // Never in a background launch (a Done on the Live Activity): nobody's looking.
    if (!transition || !appActive || celebratedDay.current === today) return;
    celebratedDay.current = today;

    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    setShowCelebration(true);
    track("perfect_day", { count: total });
    // Maybe a rating ask: remembered for a later app open instead of
    // stacking it on the celebration and the evening check-in.
    considerReview("perfect_day");
  }, [ready, appActive, completedCount, total, today, considerReview]);

  // Stable identity: the overlay restarts its auto-dismiss timer whenever
  // onDismiss changes.
  const dismissCelebration = useCallback(() => {
    setShowCelebration(false);
  }, []);

  // Ask for the rating on a LATER app open (at least an hour after the happy
  // moment), when nothing else is happening. The cooldown is only spent if the
  // prompt was actually requested while the app was active.
  const reviewDueAtRef = useRef(state.reviewDueAt);
  reviewDueAtRef.current = state.reviewDueAt;
  const reviewDueSourceRef = useRef(state.reviewDueSource);
  reviewDueSourceRef.current = state.reviewDueSource;
  // Something else is on screen (rollover, onboarding, a sheet, the paywall,
  // a celebration): the rating ask waits for a quiet moment.
  const somethingUp =
    !state.hasSeenOnboarding ||
    firstRunActive ||
    paywallSource !== null ||
    ideasOpen ||
    brainDumpOpen ||
    routinesOpen ||
    focusTaskId !== null ||
    // No rating ask over a focus session: running, paused or at its check-in.
    focusSession !== null ||
    showCelebration ||
    // 1.5 D: "Meet Nag mode" from its Today card, and the share preview.
    nagCardOpen ||
    shareOpen;

  // What's new (1.4): once, for someone who updated, in the quiet window
  // right after a launch or a return to the foreground: Today in front with
  // nothing on top of it (the list above, yesterday's leftovers, a drag, a
  // break-down on its way), nobody typing and Plus known. If the user does
  // anything first it waits for the next foreground or launch.
  const keyboardUp = useKeyboardVisible();
  const todayFocused = useScreenFocused();
  // Set further down (the rating ask and the aha paywall are declared there).
  const whatsNewCanShow = useRef<() => ReturnType<typeof whatsNewMoment>>(() => "later");
  const whatsNew = useWhatsNew({
    active: appActive,
    idle: todayIdleForWhatsNew({
      todayFocused,
      somethingUp,
      rolloverPending: state.pendingRollover !== null,
      keyboardUp,
      dragging: reorder.draggingId !== null,
      breakingDown: breakingTaskId !== null,
    }),
    // Not while Plus is still being checked: the sheet and its button differ with and without it.
    pending: plusPending,
    activity: whatsNewActivity(state.tasks, state.todayCompletions),
    canShowNow: () => whatsNewCanShow.current(),
    // A new install's own "Meet Nag mode", once, on the next open after first run (1.5 D).
    firstDays: { id: NAG_FIRST_DAYS_ID, due: firstDays.nagIntroDue, seen: firstDays.nagIntroSeen },
  });
  // VoiceOver goes back to Today's title once the sheet has gone.
  const todayTitleRef = useRef<Text>(null);
  const whatsNewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (whatsNewTimer.current) clearTimeout(whatsNewTimer.current);
    },
    [],
  );
  // The sheet has gone so that something else can come up (the paywall, the
  // focus screen): Today still counts as busy until it has, so no rating ask
  // or other paywall slips into the gap.
  const [whatsNewHandingOff, setWhatsNewHandingOff] = useState(false);
  const handOffWhatsNew = () => {
    setWhatsNewHandingOff(true);
    if (whatsNewTimer.current) clearTimeout(whatsNewTimer.current);
    whatsNewTimer.current = setTimeout(() => {
      whatsNewTimer.current = null;
      setWhatsNewHandingOff(false);
    }, SHEET_SWAP_DELAY_MS + 150);
  };
  const closeWhatsNew = (next?: "paywall") => {
    whatsNew.close();
    afterNagSheet(next);
  };
  // "Meet Nag mode" from the Nag card: closed the same way (1.5 D).
  const closeNagSheet = (next?: "paywall") => {
    if (!nagCardOpen) {
      closeWhatsNew(next);
      return;
    }
    setNagCardOpen(false);
    // Seen once it's closed (or handed to the paywall): the card and the sheet's own showing are done.
    firstDays.nagIntroSeen();
    afterNagSheet(next);
  };
  const afterNagSheet = (next?: "paywall") => {
    if (next === "paywall") {
      // The paywall is about to appear: VoiceOver's focus is its to take.
      handOffWhatsNew();
      return;
    }
    if (whatsNewTimer.current) clearTimeout(whatsNewTimer.current);
    whatsNewTimer.current = setTimeout(() => {
      whatsNewTimer.current = null;
      if (todayTitleRef.current) AccessibilityInfo.sendAccessibilityEvent(todayTitleRef.current, "focus");
    }, SHEET_SWAP_DELAY_MS);
  };
  // A focus prompt while the sheet is up: the sheet steps aside, not seen
  // (the user didn't close it), and comes back at a later foreground.
  whatsNewStepAside.current = () => {
    if (nagCardOpen) {
      // The same for "Meet Nag mode" opened from its card: not seen, so the
      // card stays and it can be opened again there.
      setNagCardOpen(false);
      handOffWhatsNew();
      return true;
    }
    if (whatsNew.openId === null) return false;
    whatsNew.postpone();
    handOffWhatsNew();
    return true;
  };

  const busyRef = useRef(false);
  // The sheet counts as something on screen too: no rating ask or paywall over it.
  busyRef.current = somethingUp || whatsNew.openId !== null || whatsNewHandingOff;

  // Capture from anywhere (1.6 E; see lib/daily-tasks/capture.ts). The Dump
  // widget or control, the "Brain dump" shortcut or a dump link: the brain
  // dump opens (on a locked day too: the sheet saves everything for later
  // and says so). Not over first run, and not over the paywall (a purchase
  // under way); anything else on screen steps aside first (one modal at a
  // time on iOS) and the dump follows once it has animated away.
  //
  // Step-aside hook: every sheet or overlay Today shows registers here. Each
  // entry closes its own sheet if it's up and returns true (false if it
  // wasn't up). A new sheet must add itself, or a dump request over it opens
  // nothing (iOS shows one modal at a time).
  const stepAsideForDump = useRef<Record<string, () => boolean>>({});
  stepAsideForDump.current = {
    // What's new and "Meet Nag mode" (whatsNewStepAside, set further down).
    whatsNew: () => whatsNewStepAside.current(),
    ideas: () => {
      if (!ideasOpen) return false;
      setIdeasOpen(false);
      return true;
    },
    routines: () => {
      if (!routinesOpen) return false;
      setRoutinesOpen(false);
      return true;
    },
    focus: () => {
      if (focusTaskId === null) return false;
      setFocusTaskId(null);
      return true;
    },
    share: () => {
      if (!shareOpen) return false;
      setShareOpen(false);
      return true;
    },
    celebration: () => {
      if (!showCelebration) return false;
      dismissCelebration();
      return true;
    },
  };
  const dumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (dumpTimer.current) clearTimeout(dumpTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!dumpPrompt) return;
    clearDumpPrompt();
    if (!state.hasSeenOnboarding || firstRunActive || paywallSource !== null || brainDumpOpen) return;
    // Every entry runs (no short-circuit): all of them close.
    const stepped = Object.values(stepAsideForDump.current)
      .map((stepAside) => stepAside())
      .some(Boolean);
    if (dumpTimer.current) clearTimeout(dumpTimer.current);
    dumpTimer.current = null;
    if (!stepped) {
      setBrainDumpOpen(true);
      return;
    }
    dumpTimer.current = setTimeout(() => {
      dumpTimer.current = null;
      setBrainDumpOpen(true);
    }, SHEET_SWAP_DELAY_MS);
    // Only when a new prompt arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dumpPrompt]);
  // Captures from the share sheet or "Save for later", just saved for later
  // (or Saved for later is full). Not during onboarding or first run: it
  // waits, and is said once they're done.
  useEffect(() => {
    if (!captureNotice || !state.hasSeenOnboarding || firstRunActive) return;
    clearCaptureNotice();
    const message = captureToast(captureNotice);
    if (message) showToast(message);
    // When a notice arrives, or once onboarding is done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureNotice, state.hasSeenOnboarding, firstRunActive]);

  // The gentle aha paywall: once per install, after day 1, at a real win
  // (last night's draft used, Set, or a brain dump that filled the day's
  // three). Checked again when the delay ends, so a sheet, a timer, another
  // paywall, the app going to the background (or a purchase elsewhere)
  // cancels it. Rule: lib/daily-tasks/aha-paywall.ts.
  const totalRef = useRef(total);
  totalRef.current = total;
  const ahaAllowedRef = useRef<() => boolean>(() => false);
  ahaAllowedRef.current = () =>
    shouldOfferAhaPaywall({
      today,
      state: ahaPaywallState,
      now: Date.now(),
      paywallEnabled: Boolean(paywallEnabled),
      hasPlus,
      busy:
        !ready ||
        !appActive ||
        RNAppState.currentState !== "active" ||
        busyRef.current ||
        // A rating ask in flight or just made: never a paywall on top of it.
        ratingRecent() ||
        state.pendingRollover !== null ||
        // Any focus session, paused too: it's their time, not ours.
        focusSession !== null,
    });
  // The win-back paywall's quiet moment: nothing else up, no rating ask, app in front.
  const appActiveRef = useRef(appActive);
  appActiveRef.current = appActive;
  const winBackCanShow = () =>
    appActiveRef.current && RNAppState.currentState === "active" && !busyRef.current && !ratingRecent();
  const ahaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (ahaTimer.current) clearTimeout(ahaTimer.current);
    },
    [],
  );
  // Backgrounded while waiting: drop it rather than greet them with a paywall on return.
  useEffect(() => {
    if (!appActive && ahaTimer.current) {
      clearTimeout(ahaTimer.current);
      ahaTimer.current = null;
    }
  }, [appActive]);
  // Only judged when the delay ends: the moment may come from a sheet that's
  // still closing. `fillsFrom`: the task count before an add, so the offer only
  // stands if the add really filled the day (checked against the count after it).
  // As the what's-new delay ends: not on a rating ask, not as the aha paywall
  // is about to open (both: ask again shortly); not with a menu open or a
  // field in use (a hardware keyboard shows none): the user is busy.
  whatsNewCanShow.current = () =>
    whatsNewMoment({
      appActive: RNAppState.currentState === "active",
      busy: busyRef.current,
      menuOpen: actionSheetOpen(),
      fieldInUse: TextInput.State.currentlyFocusedInput() != null,
      ratingRecent: ratingRecent(),
      ahaPending: ahaTimer.current !== null,
    });
  const offerAhaPaywall = (options: { fillsFrom?: number } = {}) => {
    if (ahaTimer.current) clearTimeout(ahaTimer.current);
    ahaTimer.current = setTimeout(() => {
      ahaTimer.current = null;
      if (options.fillsFrom !== undefined && !fillsDay(options.fillsFrom, totalRef.current)) return;
      if (ahaAllowedRef.current()) openPaywall("aha");
    }, AHA_PAYWALL_DELAY_MS);
  };

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async () => {
      const due = reviewDueAtRef.current;
      if (!due || reviewInFlight.current) return;
      const status = reviewDueStatus(due, Date.now());
      // Expired (or corrupt): drop it, so a later happy moment can earn a fresh one.
      if (status === "expired") {
        clearReviewDue();
        return;
      }
      if (status === "wait" || busyRef.current) return;
      // The aha paywall is about to open: keep the ask for a later foreground.
      if (ahaTimer.current) return;
      if (RNAppState.currentState !== "active") return;
      reviewInFlight.current = true;
      ratingAskedAt.current = Date.now();
      try {
        if (await requestAppReview()) {
          // Storage gives an ask saved before 1.3 the source "perfect_day".
          track("rating_prompt_requested", { source: reviewDueSourceRef.current });
          markReviewPrompted();
        }
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
  }, [ready, markReviewPrompted, clearReviewDue]);

  // The ideas sheet has nothing to add once the day is locked, and neither
  // sheet may block the onboarding modals (iOS shows one modal at a time).
  // Yesterday's unfinished ones are a card now, so they don't close it.
  // A brain dump under way stays open when the day is set (auto-set can fire
  // mid-dump): closing it would drop what was typed. It saves everything for
  // later instead.
  useEffect(() => {
    if (state.todayLocked || !state.hasSeenOnboarding || firstRunActive) setIdeasOpen(false);
    if (!state.hasSeenOnboarding || firstRunActive) setBrainDumpOpen(false);
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
    if (!plusConfirmed && freeBreakDowns !== 0) {
      // Free, or Plus still being checked: the free try first (once per
      // install; the claim has the final say). A subscriber whose Plus is
      // confirmed meanwhile gets it back (see runBreakDown).
      void runBreakDown(taskId, text, options.starter, { freeTry: true, afterSheet: options.afterSheet });
      return;
    }
    if (!hasPlus) {
      showBreakDownPaywall(taskId, text, options);
      return;
    }
    void runBreakDown(taskId, text, options.starter);
  };

  const showBreakDownPaywall = (
    taskId: string,
    text: string,
    options: { starter?: boolean; afterSheet?: boolean } = {},
  ) => {
    showPaywall("break_down", {
      feature: "break_down",
      afterSheet: options.afterSheet,
      resume: { kind: "break_down", taskId, text, starter: options.starter },
    });
  };

  const offerStarter = (taskId: string, step: string) => {
    Alert.alert("Start with the first step?", `“${step}”. Just 5 minutes.`, [
      { text: "Not now", style: "cancel" },
      { text: "Start 5 minutes", onPress: () => startStarter(taskId, "check_in", step) },
    ]);
  };

  // `freeTry`: a free user's one try (1.5), claimed here before the request,
  // given back if the AI can't be reached, and matched to the server on a 402.
  const runBreakDown = async (
    taskId: string,
    text: string,
    starter = false,
    free: { freeTry?: boolean; afterSheet?: boolean } = {},
  ) => {
    if (breakingRef.current) return;
    breakingRef.current = taskId;
    setBreakingTaskId(taskId);
    if (free.freeTry) {
      const left = await claimFreeBreakDown();
      if (left === null) {
        breakingRef.current = null;
        setBreakingTaskId(null);
        setFreeBreakDowns(0);
        showBreakDownPaywall(taskId, text, { starter, afterSheet: free.afterSheet });
        return;
      }
      setFreeBreakDowns(left);
    }
    // From the check-in: the timer on this task makes way for the steps.
    if (starter && focusSessionRef.current?.taskId === taskId) stopFocusSession("broken_down");
    try {
      const steps = await requestBreakDown({ task: text, goalTitle: state.momentumProfile.goalTitle });
      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      // Only if the task still reads the same (it may have been edited meanwhile).
      setTaskSteps(taskId, steps, text);
      // Plus confirmed while it ran (it was still being checked): not a free try after all.
      const wasFreeTry = free.freeTry === true && !plusConfirmedRef.current;
      if (free.freeTry && !wasFreeTry) {
        void refundFreeBreakDown()
          .then(() => freeBreakDownsLeft())
          .then(setFreeBreakDowns);
      }
      track("break_down_used", wasFreeTry ? { count: steps.length, source: "free_try" } : { count: steps.length });
      // Break it down is Plus-only and AI-only: steps back means Plus was used.
      if (steps.length > 0 && !free.freeTry) void recordPlusUse("break_down");
      if (wasFreeTry) showToast("Steps added. That was your one free try.");
      // The store keeps steps trimmed: match it, so the starter names the step.
      const first = steps.map((step) => step.trim()).find(Boolean);
      if (starter && first) offerStarter(taskId, first);
    } catch (error) {
      const kind = classifyAiFailure(error);
      if (free.freeTry && kind === "needs_plus") {
        // The server has no free try left for this install's id (the badge
        // offered one): say so, then the paywall, as before.
        void spendFreeBreakDowns();
        setFreeBreakDowns(0);
        showToast("Your free try was already used.");
        showBreakDownPaywall(taskId, text, { starter });
        return;
      }
      if (free.freeTry) {
        void refundFreeBreakDown()
          .then(() => freeBreakDownsLeft())
          .then(setFreeBreakDowns);
      }
      Alert.alert("Couldn't break it down", breakDownFailureMessage(kind));
    } finally {
      breakingRef.current = null;
      setBreakingTaskId(null);
    }
  };

  // When the paywall closes, pick up where the user was: run the break-down
  // they asked for (if they now have Plus), or reopen the sheet they were in.
  resume.current = (unlock) => {
    if (unlock.kind === "evening_draft") {
      // Bought Plus from the teaser: the coach drafts the same day's close now.
      const closed = state.eveningClose;
      if (plusConfirmed && unlock.day === today && closed && isDayClosed(closed, today)) {
        runEveningClose(closed.result);
      }
      return;
    }
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
    runEveningClose(result, typedNote);
  };

  const runEveningClose = (result: ReflectionResult, typedNote?: string | null) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosingDay(true);
    setEveningAiFailedFor(null);
    // The day being closed is the one on screen now, whenever the reply lands.
    const day = today;
    const input = buildEveningInput(state, result, typedNote);
    // A "Clear memory" while this is on its way drops the memory it brings back.
    const startedAt = Date.now();
    // Confirmed Plus only: "still checking" must not spend an AI call on a free user.
    const useAi = plusConfirmed && getMomentumAiProxyUrl() != null;
    // Saved items due tomorrow lead the draft (1.6 F, Plus like the coach's draft).
    const parked = state.parkedTasks;
    void closeDay(input, { useAi })
      .then((closed) => {
        // Asked the coach, got the on-device close with nothing for tomorrow: offer a retry.
        // Judged on the coach's answer, before saved items are added (1.6 F).
        if (useAi && closed.source === "local" && closed.tomorrow.length === 0) setEveningAiFailedFor(day);
        // Counts what the coach (or the on-device close) drafted, not the saved items added.
        track("evening_closed", { source: closed.source, count: closed.tomorrow.length });
        setEveningClose(useAi ? withDueTomorrow(closed, parked, day) : closed, day, result, startedAt);
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
        text: "Lock",
        onPress: () => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
          lockToday();
          offerAhaPaywall();
        },
      },
    ]);
  };

  // "Unlock" on the status line (1.5; Settings keeps its row too). Always
  // asks first: "Unlock" is the clear action, "Keep locked" the cancel.
  const confirmUnlock = () => {
    const copy = unlockConfirmation({
      lockSource: state.todayLockSource,
      autoLockTime: clockTimeOf(state.todayLockedAt) ?? formatClockTime(state.autoLock.hour, state.autoLock.minute),
    });
    Alert.alert(copy.title, copy.message, [
      { text: copy.keep, style: "cancel" },
      {
        text: copy.unlock,
        style: "default",
        isPreferred: true,
        onPress: () => {
          // False when nothing was unlocked (the alert sat open past midnight).
          if (!unlockToday()) return;
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
          track("day_unlocked", { source: "today" });
          showToast(UNLOCKED_NOTE);
          announcePolitely(UNLOCKED_NOTE);
        },
      },
    ]);
  };

  const handleToggle = (id: string) => {
    const completing = !isCompleted(id);
    // A tap on every tick (1.5 D): firmer for done than for undone; the row's check pops in.
    haptic(() =>
      Haptics.impactAsync(completing ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light),
    );
    toggleTask(id);
    if (completing) track("task_completed", { count: completedCount + 1 });
    // The very first tick on this install: one line, once (1.5 D).
    if (completing && isFirstTickEver({ history: state.history, today, completedBefore: completedCount })) {
      void claimFirstTick().then((first) => {
        if (!first) return;
        showToast(FIRST_TICK_TOAST);
        // Queued after the tick's own words (and any "Done: …"), never in their place.
        announcePolitely(FIRST_TICK_TOAST);
      });
    }
    // Plus lapsed a while ago: offer it back once, after a small win (not on
    // launch). Skipped if anything else is on screen, e.g. the celebration.
    if (completing && winBackDue && paywallEnabled && !hasPlus) {
      setTimeout(() => {
        if (winBackCanShow() && winBackDueRef.current) openPaywall("win_back");
      }, 1200);
    } else if (completing && winBackOfferPending && paywallEnabled && !hasPlus) {
      // Later in the lapse: once Apple has a win-back offer for them, one more
      // showing. The check runs at most once a day, so it's only spent when
      // its answer could be shown right then.
      setTimeout(() => {
        if (!winBackCanShow()) return;
        void checkWinBackOffer().then((available) => {
          if (available && winBackCanShow()) openPaywall("win_back");
        });
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
    announceLater(`Done: ${text}`);
  };
  // Said a moment later, so a closing sheet doesn't cut it off.
  const announceLater = (message: string) => {
    if (focusDoneTimer.current) clearTimeout(focusDoneTimer.current);
    focusDoneTimer.current = setTimeout(() => {
      focusDoneTimer.current = null;
      AccessibilityInfo.announceForAccessibility(message);
    }, FOCUS_DONE_ANNOUNCE_DELAY_MS);
  };
  // Ending the session by hand never ticks the task: say so.
  const endSession = (outcome: "stopped" | "break") => {
    const text = sessionTask?.text;
    stopFocusSession(outcome);
    if (text) announceLater(sessionEndedAnnouncement(outcome, text));
  };

  // What the row's timer pill, the focus screen and the check-in can do to the session.
  // Only "Mark task done" ticks, through the normal path, so the haptic,
  // celebration and win-back all happen (and the store clears the session).
  // Stop timer and Take a break end the session and leave the task open.
  const sessionControls: FocusSessionControls = {
    pause: pauseFocusSession,
    resume: resumeFocusSession,
    stop: () => endSession("stopped"),
    takeBreak: () => endSession("break"),
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
            // The session stays until the break-down runs (runBreakDown
            // clears it): dismissing the paywall keeps it.
            setFocusTaskId(null);
            handleBreakDown(sessionTask.id, sessionTask.text, { starter: true, afterSheet: fromFocus });
          }
        : undefined,
  };

  // A tap where a set day used to offer a change (a row's words, an empty
  // slot): say why nothing happened and where to go (1.4).
  const handleLockedTap = () => {
    showToast(LOCKED_CHANGE_NOTE, "locked");
    announcePolitely(LOCKED_CHANGE_NOTE);
  };

  const handleDelete = (id: string, text: string) => {
    if (state.todayLocked) return handleLockedTap();
    Alert.alert("Remove this task?", `Remove “${text}” from today?`, [
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
  // Its timer goes with it (the store clears a session whose task leaves
  // today), and the note says so.
  const handleNotToday = (id: string) => {
    // A set day keeps its three (the store refuses too).
    if (state.todayLocked) return handleLockedTap();
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    const timed = focusSessionRef.current?.taskId === id;
    notToday(id);
    track("task_not_today", { source: "open" });
    const note = timed ? "Saved for later. Timer stopped." : "Saved for later.";
    showToast(note);
    AccessibilityInfo.announceForAccessibility(note);
  };

  // Words that can't go on today because it was set meanwhile (typed into a
  // slot as auto-set fired, a brain dump confirmed after it): saved for later
  // and said so, never dropped (the store refuses the add).
  const saveForLaterOnLockedDay = (texts: string[]) => {
    parkTasks(texts);
    const message = brainDumpToast(0, texts.length, { locked: true });
    if (!message) return;
    showToast(message, "locked");
    announcePolitely(message);
  };

  const handleAdd = (text: string) => {
    if (state.todayLocked) return saveForLaterOnLockedDay([text]);
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    addTask(text);
  };
  // A tapped suggestion: the store refuses one already on today (a double
  // tap), and says whether it landed. Typing by hand (handleAdd) has no such rule.
  const handleAddIdea = (text: string): boolean => {
    if (addSuggestions([text]) === 0) return false;
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    return true;
  };

  // One task's row: in the list, and again as the drag's ghost.
  const draggedTask = reorder.draggingId
    ? (state.tasks.find((task) => task.id === reorder.draggingId) ?? null)
    : null;
  const renderTaskRow = (task: Task, index: number, ghost = false) => {
    const options = reorderOptions(state.tasks, state.todayCompletions, task.id);
    return (
      <TaskRow
        task={task}
        index={index}
        // After a drop the old "Up next" row keeps its look for a moment, so
        // the drop's own render moves nothing; then the swap is eased in.
        hero={task.id === reorder.heroId}
        completed={isCompleted(task.id)}
        editable={!state.todayLocked}
        onToggle={() => handleToggle(task.id)}
        onEdit={(text) => editTask(task.id, text)}
        // An edit open when the day is set is saved, not dropped (the store's setDay).
        // The store's own (stable) function: the row's effect runs only when the words change.
        onDraftChange={ghost ? undefined : noteOpenEdit}
        onDelete={() => handleDelete(task.id, task.text)}
        onNotToday={() => handleNotToday(task.id)}
        onLockedPress={handleLockedTap}
        onBreakDown={
          breakDownAvailable ? () => handleBreakDown(task.id, task.text) : undefined
        }
        breakingDown={breakingTaskId === task.id}
        breakDownNeedsPlus={!hasPlus}
        breakDownFreeTry={hasPlus ? null : freeBreakDownBadge(freeBreakDowns ?? 0)}
        breakDownDisabled={breakingTaskId !== null && breakingTaskId !== task.id}
        onToggleStep={(stepId) => toggleTaskStep(task.id, stepId)}
        // Steps are a finishing aid, so clearing them is fine on a set day.
        onClearSteps={() => clearTaskSteps(task.id)}
        // A timer is fine on a set day too: it's for doing the day.
        onTimer={(anchor) => openTimerMenu(task.id, task.text, anchor)}
        session={focusSession?.taskId === task.id ? focusSession : null}
        controls={sessionControls}
        onOpenTimer={(via) => openFocus(task.id, via === "words" ? "row_words" : "row")}
        reorder={options}
        onDoNext={() => handleDoNext(task.id, task.text)}
        onMove={(direction) => handleMove(task.id, direction)}
        // The handle, where there's room; without it the menu has Move up / Move down.
        dragGesture={options.canDrag && handleFits && !ghost ? reorder.gestures[task.id] : undefined}
        moveInMenu={!handleFits}
        dragActive={reorder.draggingId !== null}
        focusTick={movedFocus?.id === task.id ? movedFocus.tick : 0}
        // The dragged copy: the same look, nothing live (and no testIDs).
        ghost={ghost}
      />
    );
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: 48 }}
          // A picked-up row moves, not the page.
          scrollEnabled={reorder.draggingId === null}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <TodayHeader
            titleRef={todayTitleRef}
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
              {update ? <UpdateBanner update={update} onDismiss={dismissUpdate} /> : null}
              {toast && (
                <View
                  className="flex-row items-center gap-2 rounded-2xl p-3"
                  style={{ backgroundColor: toastTone === "locked" ? colors.surface : `${colors.success}18` }}
                  accessibilityLiveRegion="polite"
                  testID="today-toast"
                >
                  {toastTone === "locked" ? (
                    <Ionicons name="lock-closed" size={18} color={colors.muted} testID="today-toast-locked" />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  )}
                  <Text className="flex-1 text-sm text-foreground">{toast}</Text>
                </View>
              )}

              {showWelcome ? (
                <View className="flex-row items-center gap-2 px-1" testID="welcome-back">
                  <Ionicons
                    name="sunny-outline"
                    size={16}
                    color={colors.primary}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  />
                  <Text className="flex-1 text-base text-foreground" style={{ fontWeight: "600" }}>
                    {welcomeBackLine(daysShowedUp)}
                  </Text>
                </View>
              ) : null}

              {/* No draft to weigh it against: yesterday's leftovers come first. */}
              {rolloverOnTop && rolloverCard}

              {/* One calm card: three rows, hairlines between them. */}
              <View
                className="rounded-3xl overflow-hidden border"
                style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                testID="today-tasks"
              >
                {/* The rows' own box (no border), so a row's measured place
                    and the dragged copy's `top` are counted from the same edge. */}
                <View>
                  {Array.from({ length: MAX_TASKS }).map((_, index) => {
                    // Always the saved order: a drag slides the rows (see
                    // ReorderRow) and only the drop changes it.
                    const task = state.tasks[index];
                    const divider =
                      index > 0 ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 58 }} /> : null;
                    if (task) {
                      return (
                        <ReorderRow
                          // Mounted anew by each drop that changed the order.
                          key={reorderRowKey(task.id, reorder.epoch)}
                          id={task.id}
                          index={index}
                          reorder={reorder}
                        >
                          {divider}
                          {renderTaskRow(task, index)}
                        </ReorderRow>
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
                          onLockedPress={handleLockedTap}
                          onLockedText={(text) => saveForLaterOnLockedDay([text])}
                        />
                      </View>
                    );
                  })}
                  {draggedTask ? (
                    <ReorderGhost
                      top={reorder.ghostTop}
                      height={reorder.ghostHeight}
                      dragY={reorder.dragY}
                      lift={reorder.lift}
                    >
                      {renderTaskRow(draggedTask, state.tasks.indexOf(draggedTask), true)}
                    </ReorderGhost>
                  ) : null}
                </View>
              </View>

              {/* Reordering, said once (1.4): the first time two or more
                  tasks are open. VoiceOver hears its own way to do it. */}
              {showReorderHint ? (
                <Text
                  className="text-xs"
                  style={{ color: colors.muted, paddingHorizontal: 6, marginTop: -6 }}
                  accessibilityLabel="To reorder, use a task's actions: Do this next, Move up or Move down."
                  testID="reorder-hint"
                >
                  {handleFits
                    ? "Drag ≡ to reorder"
                    : "To reorder, open a task's menu and choose Move up or Move down"}
                </Text>
              ) : null}

              {/* A full three-for-three day: the card and gradient say it all.
                  With room left, keep the line. A locked day always keeps it,
                  so the lock and its Unlock (1.5) still show on a finished three. */}
              {(state.todayLocked || !(progress.isPerfect && total >= MAX_TASKS)) && (
              <StatusLine status={status} onLock={confirmLock} onUnlock={confirmUnlock} />
              )}
              {/* Routines due today (1.3): right under the day's card, so
                  they're seen without opening Ideas. */}
              {showRoutinesCard && (
                <TodaysRoutinesCard
                  routines={dueRoutines}
                  block={routinesBlock}
                  onAdd={(id) => handleAddRoutine(id, "today")}
                  onEdit={() => setRoutinesOpen(true)}
                />
              )}
              {/* A full or locked day hides the ideas entry, but saved items
                  must stay reachable (to view or remove; on a locked day
                  nothing swaps in until it's unlocked). */}
              {/* 1.6 F: also when a saved item is for today (or a deadline just missed), so it's put forward. */}
              {(state.todayLocked || remainingSlots === 0 || savedDueToday > 0) && state.parkedTasks.length > 0 && (
                <Pressable
                  onPress={() => {
                    setIdeasSavedOnly(true);
                    setIdeasOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Saved for later, ${state.parkedTasks.length} ${
                    state.parkedTasks.length === 1 ? "item" : "items"
                  }${savedDueToday > 0 ? `, ${savedDueToday} for today` : ""}`}
                  hitSlop={8}
                  className="self-start flex-row items-center gap-1.5"
                  testID="saved-ideas-link"
                >
                  <Ionicons name="bookmark-outline" size={15} color={colors.primary} />
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    Saved for later ({state.parkedTasks.length}){savedDueToday > 0 ? ` · ${savedDueToday} for today` : ""}
                  </Text>
                </Pressable>
              )}
              {/* The day-5 trial note: under the day's card and status, away from the rollover. */}
              {ready && !firstRunActive && <TrialNote today={today} active={appActive} />}
            </View>

            {/* Also there for a first-days card alone, so the card has one place under the coach's note. */}
            {(rightHasContent || firstDays.showing !== null) && (
              <View style={twoColumn ? { flex: 1, gap: 14 } : { gap: 14 }}>

                {draft && (
                  <TomorrowDraftCard
                    // A new night's draft starts fresh; the same one keeps the user's ticks.
                    key={draft.forDate}
                    draft={draft}
                    reasons={draftDueReasons(draft.tasks, state.parkedTasks, today)}
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
                      if (draft.source === "ai" && hasPlus) void recordPlusUse("tomorrow_draft");
                      const added = `Added ${accepted.length} ${accepted.length === 1 ? "task" : "tasks"}.`;
                      const message = skipped > 0 ? `${added} ${skipped} saved for later.` : added;
                      AccessibilityInfo.announceForAccessibility(message);
                      if (skipped > 0) showToast(message);
                      offerAhaPaywall();
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
                    // One tap: a 5-minute starter (no length to choose); it
                    // shows on the task's row. Once it's on, the
                    // button opens focus mode instead (never a restart).
                    // A timer on another task: no button (the note stays a
                    // quiet line; that task's row has the timer).
                    timerRunning={focusSession?.taskId === coachTask.id}
                    onStart={
                      focusSession && focusSession.taskId !== coachTask.id
                        ? undefined
                        : () => {
                            if (focusSession) openFocus(coachTask.id, "coach");
                            else startStarter(coachTask.id, "coach");
                          }
                    }
                  />
                )}
                {/* First run's old last screens, as Today cards (1.5), under the coach's note. */}
                <FirstDaysCardsView cards={firstDays} />
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
                    {nextMilestone && (
                      <NextPathLink
                        title={nextMilestone.title}
                        onPress={openProgress}
                        onIdeas={
                          // Not when every idea for it is already on today: nothing left to get.
                          ideasVisible && milestoneGroup && hasMilestoneIdeaToAdd(milestoneGroup, addedTexts)
                            ? () => {
                                setIdeasFocusMilestone(true);
                                setIdeasOpen(true);
                              }
                            : undefined
                        }
                      />
                    )}
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
                          {coachDrafts
                            ? "Tonight, one tap closes the day and drafts tomorrow."
                            : "Tonight, one tap closes the day."}
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
                    coachDrafts={coachDrafts}
                    onPullOneMore={ideasVisible ? () => setIdeasOpen(true) : undefined}
                    // The picture goes to the iOS share sheet (1.5 D).
                    onShare={Platform.OS === "ios" && total > 0 ? () => setShareOpen(true) : undefined}
                  />
                )}
                {eveningCheckIn && (
                  <>
                    <CompletionReflection
                      value={state.todayReflection}
                      result={state.todayReflectionResult}
                      allowMissed={!progress.isPerfect}
                      coachDrafts={coachDrafts}
                      onSelectResult={handleEveningResult}
                      onSave={setTodayReflection}
                    />
                    <EveningResult
                      closing={closingDay}
                      note={dayClosed ? state.eveningClose?.note ?? null : null}
                      draft={closedDraft}
                      coachDrafts={plusConfirmed && getMomentumAiProxyUrl() != null}
                      onRetry={
                        eveningAiFailedFor === today && dayClosed && plusConfirmed && state.eveningClose
                          ? () => {
                              const closed = state.eveningClose;
                              if (closed) runEveningClose(closed.result);
                            }
                          : undefined
                      }
                      teaser={
                        eveningTeaser
                          ? {
                              line: eveningTeaser,
                              onSeePlus: () =>
                                showPaywall("evening_draft", {
                                  feature: "evening_draft",
                                  resume: { kind: "evening_draft", day: today },
                                }),
                            }
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
        onAdd={handleAddIdea}
        onAddAll={(texts) => {
          if (addSuggestions(texts) === 0) return;
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
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
        // Due today first, each dated one labelled (1.6 F).
        parked={savedItems}
        onAddParked={(id) => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
          addParkedTask(id);
        }}
        onRemoveParked={removeParkedTask}
        // 1.6 F: a wrong date is fixed from its label ("Change day" / "No date").
        dayChoices={whenChoices(today)}
        onSetParkedWhen={setParkedWhen}
        // 1.5 D: on a full, unlocked day a saved item swaps in for an open task.
        swapTargets={state.tasks.filter((task) => !isCompleted(task.id)).map((task) => ({ id: task.id, text: task.text }))}
        onSwapParked={(parkedId, taskId) => {
          const out = state.tasks.find((task) => task.id === taskId)?.text;
          // Its timer goes with it (the store clears a session whose task leaves today): say so, as Not today does.
          const timed = focusSessionRef.current?.taskId === taskId;
          if (!swapParkedTask(parkedId, taskId)) return;
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
          track("saved_swapped_in", { source: ideasSavedOnly ? "saved" : "ideas" });
          const swapped = out ? `Swapped in. “${out}” is saved for later.` : "Swapped in.";
          const message = timed ? `${swapped} Timer stopped.` : swapped;
          AccessibilityInfo.announceForAccessibility(message);
          showToast(message);
        }}
        onLock={total > 0 ? confirmLock : undefined}
        routines={dueRoutines}
        onAddRoutine={(id) => handleAddRoutine(id, "ideas")}
        locked={state.todayLocked}
        hasRoutines={state.routines.length > 0}
        onManageRoutines={openRoutinesFromIdeas}
        nextRoutine={nextRoutine}
        milestoneGroup={milestoneGroup}
        onAddMilestoneIdea={(text) => {
          // Counted only when the store took it (a double tap lands once).
          // Only the kind of suggestion is recorded, never its text.
          if (handleAddIdea(text) && milestoneGroup) {
            track("milestone_idea_added", { source: milestoneGroup.source });
          }
        }}
        focusMilestone={ideasFocusMilestone}
      />

      <RoutinesManager visible={routinesOpen} onVisibleChange={setRoutinesOpen} />

      <BrainDumpSheet
        visible={brainDumpOpen}
        onClose={() => setBrainDumpOpen(false)}
        openSlots={Math.max(1, remainingSlots)}
        freeAiLeft={freeAiLeft}
        locked={state.todayLocked}
        onSort={async (text) => {
          // What the coach has noticed over 30 days (1.5), worked out only
          // when a dump is sorted: sent with it, and checks the reasons.
          const basicMemory = buildBasicMemory(state.history, today, state.memoryClearedAt ?? null);
          const stats = memoryStatsPayload(basicMemory);
          const params = {
            text,
            openSlots: Math.max(1, remainingSlots),
            goalTitle: state.momentumProfile.goalTitle,
            // Only once there is something to tell (1.5).
            ...(stats ? { stats } : {}),
          };
          // A pick the AI gave no reason for gets one from the memory, if any.
          const withReasons = (sorted: SortedBrainDump): SortedBrainDump => ({
            ...sorted,
            result: withMovedReasons(sorted.result, basicMemory),
          });
          dumpDatesRef.current = undefined;
          if (hasPlus) {
            const sorted = await sortBrainDump({
              ...params,
              ...(state.agendaEnabled ? { agenda: await readTodayAgenda() } : {}),
              // 1.6 F: the AI reads dates ("deck for Tuesday") for Plus only.
              today,
            });
            dumpDatesRef.current = sorted.result.dates;
            track("brain_dump_sorted", { source: sorted.result.source, count: sorted.result.picks.length });
            if (sorted.result.source === "ai") void recordPlusUse("brain_dump");
            return withReasons(sorted);
          }
          // Free plan: a few AI sorts to try it, then the simple on-device split.
          const left = await claimFreeAiDump();
          if (left === null) {
            // Not a tap on "Get Plus": the free sorts ran out (own source).
            track("plus_gate_hit", { feature: "brain_dump", source: "free_exhausted" });
            // Say so: a silent simple split looks like the AI got it wrong.
            return withReasons({
              result: localBrainDump(params.text, params.openSlots),
              notice: FREE_LIMIT_NOTICE,
              freeLimit: true,
            });
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
          return withReasons(sorted);
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
          // A day set meanwhile takes nothing (the store refuses): save it all.
          const room = state.todayLocked ? 0 : remainingSlots;
          const accepted = picks.slice(0, room);
          const saved = [...picks.slice(room), ...parked];
          if (accepted.length > 0) {
            haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
            addTasks(accepted);
          }
          const dates = dumpDatesRef.current;
          if (dates) parkTasks(saved, dates);
          else parkTasks(saved);
          dumpDatesRef.current = undefined;
          setBrainDumpOpen(false);
          // Offered only if the dump really filled the day's three (checked once the sheet has gone).
          if (accepted.length > 0) offerAhaPaywall({ fillsFrom: total });
          const message = brainDumpToast(accepted.length, saved.length, { locked: state.todayLocked });
          if (message) showToast(message, state.todayLocked ? "locked" : "done");
        }}
      />

      {focusTask && (
        <FocusMode
          task={focusTask}
          startLine={focusStartLine}
          session={focusSession?.taskId === focusTask.id ? focusSession : null}
          initialCustom={focusCustom}
          otherTimerText={sessionTask && sessionTask.id !== focusTask.id ? sessionTask.text : null}
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

      <NagIntro
        // The 1.4 announcement for people who updated; a new install's own
        // introduction (on its own once, or from the Nag card) for the rest (1.5 D).
        visible={whatsNew.openId === NAG_ANNOUNCEMENT_ID || whatsNew.openId === NAG_FIRST_DAYS_ID || nagCardOpen}
        id={whatsNew.openId === NAG_ANNOUNCEMENT_ID ? NAG_ANNOUNCEMENT_ID : NAG_FIRST_DAYS_ID}
        source={nagCardOpen ? "card" : "today"}
        onClose={closeNagSheet}
        onShow={whatsNew.shown}
        onTurnedOn={() => {
          showToast(NAG_ON_TOAST);
          announceLater(NAG_ON_TOAST);
        }}
      />

      <ShareDaySheet
        visible={shareOpen}
        tasks={state.tasks.map((task) => ({ text: task.text, done: isCompleted(task.id) }))}
        daysShowedUp={daysShowedUp}
        dateLabel={dateLabel}
        hideTaskNames={state.notifications.hideTaskNames}
        onClose={() => setShareOpen(false)}
      />

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
          // A day locked meanwhile (auto-lock fired mid-dump) takes nothing (the
          // store refuses): save every pick for later instead of losing it.
          const room = state.todayLocked ? 0 : remainingSlots;
          const accepted = picks.slice(0, room);
          if (accepted.length > 0) addTasks(accepted);
          parkTasks([...picks.slice(room), ...parked]);
          if (accepted.length === 0 && picks.length > 0) {
            // Nothing landed on today: say where the picks went instead of "picked".
            const message = brainDumpToast(0, picks.length + parked.length, { locked: state.todayLocked });
            if (message) {
              showToast(message, state.todayLocked ? "locked" : "done");
              announceLater(message);
            }
          }
          return accepted.length;
        }}
        // Tasks already on today (an earlier first run added them, then
        // didn't finish): it just finishes. Read only when it (re)appears.
        resumeCount={state.tasks.length}
        onFinish={({ picked, source, name }) => {
          markOnboardingSeen();
          // 1.5 D: the optional name from the "three" screen, for the greeting.
          if (name && name !== (state.momentumProfile.name ?? "")) {
            updateMomentumProfile({ ...state.momentumProfile, name });
          }
          setFirstRunActive(false);
          // Resumed: count what's already on today (nothing was dumped now).
          const count = source === "resume" ? state.tasks.length : picked;
          track("onboarding_completed", { source, count });
          // 1.5: no paywall at the end of first run (the aha paywall comes
          // later); the nudge and widget tip become Today cards from here.
          void saveFirstDays(startFirstDays(today)).then(() => setFirstDaysVersion((v) => v + 1));
          const note = pickedNote(picked);
          if (note) {
            showToast(note);
            announceLater(note);
          }
        }}
      />

    </ScreenContainer>
  );
}
