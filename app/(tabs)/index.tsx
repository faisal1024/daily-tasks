import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState as RNAppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
import { AddTaskRow } from "@/components/daily-tasks/add-task-row";
import { BrainDumpSheet } from "@/components/daily-tasks/brain-dump-sheet";
import { CompletionReflection } from "@/components/daily-tasks/completion-reflection";
import { CelebrationOverlay } from "@/components/daily-tasks/celebration-overlay";
import { IdeasSheet, type IdeaItem } from "@/components/daily-tasks/ideas-sheet";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import { StatusLine } from "@/components/daily-tasks/status-line";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TodayHeader } from "@/components/daily-tasks/today-header";
import { UpdateBanner } from "@/components/daily-tasks/update-banner";
import { useAppUpdate } from "@/hooks/use-app-update";
import {
  aiFailureMessage,
  breakDownFailureMessage,
  classifyAiFailure,
} from "@/lib/daily-tasks/ai-status";
import { proxyRouteUrl } from "@/lib/daily-tasks/ai-client";
import { localBrainDump, requestBreakDown, sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { track } from "@/lib/daily-tasks/analytics";
import type { PaywallSource, PlusFeature } from "@/lib/daily-tasks/plus";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import { greetingFor, greetingText } from "@/lib/daily-tasks/date";
import { generateMomentumSuggestions } from "@/lib/daily-tasks/momentum";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { shouldRequestReview } from "@/lib/daily-tasks/review-prompt";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { computeDayStreak } from "@/lib/daily-tasks/streaks";
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
import { MAX_TASKS } from "@/lib/daily-tasks/types";

type Unlock =
  | { kind: "break_down"; taskId: string; text: string }
  | { kind: "brain_dump" }
  | { kind: "new_ideas" };

function haptic(fn: () => Promise<void>) {
  if (Platform.OS === "web") return;
  fn().catch(() => {});
}

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
    toggleTask,
    lockToday,
    resolveRollover,
    completeMomentumOnboarding,
    setTodayReflection,
    setTodayReflectionResult,
    requestMomentumPlan,
    journeyLevel,
    markReviewPrompted,
    parkTasks,
    removeParkedTask,
    addParkedTask,
    setTaskSteps,
    toggleTaskStep,
    clearTaskSteps,
    hasPlus,
  } = useDailyTasks();
  const { paywallEnabled, paywallSource, purchaseCount, openPaywall } = usePlus();

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

  const [showCelebration, setShowCelebration] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
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
  const dayStreak = computeDayStreak(state.history, today);
  const firstName = state.momentumProfile.name?.trim().split(/\s+/)[0] ?? "";
  const greeting = firstName
    ? `${greetingText(greetingFor())}, ${firstName}`
    : greetingText(greetingFor());

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
  const reviewPending = useRef(false);
  const reviewInFlight = useRef(false);
  const reviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const transition = isPerfectDayTransition({
      previousCompleted: previousCompleted.current,
      completed: completedCount,
      total,
    });
    previousCompleted.current = completedCount;

    // Unchecking cancels a rating request that hasn't shown yet.
    if (completedCount < MAX_TASKS) {
      reviewPending.current = false;
      if (reviewTimer.current) clearTimeout(reviewTimer.current);
      reviewTimer.current = null;
    }
    // Once per day: un-checking and re-checking the third task doesn't replay it.
    if (!transition || celebratedDay.current === today) return;
    celebratedDay.current = today;

    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    setShowCelebration(true);
    track("perfect_day", { count: total });
    reviewPending.current = !reviewInFlight.current && shouldRequestReview({
      history: state.history,
      lastReviewPromptAt: state.lastReviewPromptAt,
      now: new Date(),
      justCompletedPerfectDay: true,
    });
  }, [ready, completedCount, total, today, state.history, state.lastReviewPromptAt]);

  // The rating sheet waits until the celebration is dismissed, and the cooldown
  // is only spent if the prompt was actually requested while the app is active.
  // Stable identity: the overlay restarts its auto-dismiss timer whenever
  // onDismiss changes, which would delay (or repeat) the rating flow.
  const dismissCelebration = useCallback(() => {
    setShowCelebration(false);
    if (!reviewPending.current) return;
    reviewPending.current = false;
    reviewTimer.current = setTimeout(async () => {
      reviewTimer.current = null;
      // iOS ignores the request when the app isn't in the foreground, and we
      // mustn't spend the cooldown then. ("unknown" can occur briefly at launch.)
      const appState = RNAppState.currentState;
      if (appState === "background" || appState === "inactive") return;
      // Guard against a second perfect-day transition while this is in flight
      // (lastReviewPromptAt isn't updated until it resolves).
      reviewInFlight.current = true;
      try {
        if (await requestAppReview()) markReviewPrompted();
      } finally {
        reviewInFlight.current = false;
      }
    }, 600);
  }, [markReviewPrompted]);
  useEffect(
    () => () => {
      if (reviewTimer.current) clearTimeout(reviewTimer.current);
    },
    [],
  );

  // The sheet has nothing to add once the day is locked, and it must not block
  // the rollover or onboarding modals (iOS shows one modal at a time).
  useEffect(() => {
    if (state.todayLocked || state.pendingRollover || !state.hasSeenOnboarding) {
      setIdeasOpen(false);
      setBrainDumpOpen(false);
    }
  }, [state.todayLocked, state.pendingRollover, state.hasSeenOnboarding]);

  const handleBreakDown = (taskId: string, text: string) => {
    if (breakingRef.current) return;
    if (!hasPlus) {
      showPaywall("break_down", {
        feature: "break_down",
        resume: { kind: "break_down", taskId, text },
      });
      return;
    }
    void runBreakDown(taskId, text);
  };

  const runBreakDown = async (taskId: string, text: string) => {
    if (breakingRef.current) return;
    breakingRef.current = taskId;
    setBreakingTaskId(taskId);
    try {
      const steps = await requestBreakDown({ task: text, goalTitle: state.momentumProfile.goalTitle });
      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      // Only if the task still reads the same (it may have been edited meanwhile).
      setTaskSteps(taskId, steps, text);
      track("break_down_used", { count: steps.length });
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
        void runBreakDown(task.id, task.text);
      }
      return;
    }
    if (state.todayLocked || state.pendingRollover) return;
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

  const confirmLock = () => {
    const { title, message } = lockConfirmation(total);
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Lock in",
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
  };

  const handleDelete = (id: string, text: string) => {
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
            greeting={greeting}
            progress={progress}
            dayStreak={dayStreak}
            level={journeyLevel}
          />

          <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 14 }}>
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

            <View className="gap-3" testID="today-tasks">
              {Array.from({ length: MAX_TASKS }).map((_, index) => {
                const task = state.tasks[index];
                if (task) {
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      index={index}
                      completed={isCompleted(task.id)}
                      onToggle={() => handleToggle(task.id)}
                      onEdit={(text) => editTask(task.id, text)}
                      onDelete={() => handleDelete(task.id, task.text)}
                      canEdit={!state.todayLocked}
                      canDelete={!state.todayLocked}
                      onBreakDown={
                        breakDownAvailable
                          ? () => handleBreakDown(task.id, task.text)
                          : undefined
                      }
                      breakingDown={breakingTaskId === task.id}
                      breakDownNeedsPlus={!hasPlus}
                      breakDownDisabled={breakingTaskId !== null && breakingTaskId !== task.id}
                      onToggleStep={(stepId) => toggleTaskStep(task.id, stepId)}
                      // Steps are a finishing aid, so clearing them is fine on a locked day.
                      onClearSteps={() => clearTaskSteps(task.id)}
                    />
                  );
                }
                return (
                  <AddTaskRow
                    key={`empty-${index}`}
                    remainingSlots={remainingSlots}
                    slotNumber={index + 1}
                    disabled={state.todayLocked}
                    onAdd={handleAdd}
                  />
                );
              })}
            </View>

            <StatusLine status={status} onLock={confirmLock} />

            {showIdeasEntry({ locked: state.todayLocked, remainingSlots }) && (
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
                    color={entry.prominent ? "#fff" : colors.primary}
                  />
                  <Text
                    className="text-base font-semibold"
                    style={{ color: entry.prominent ? "#fff" : colors.primary }}
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

            {progress.isPerfect && (
              <>
                <View className="rounded-2xl bg-surface border border-border p-4 gap-1">
                  <Text className="text-sm font-semibold text-foreground">
                    {total === MAX_TASKS ? "All three, done." : "Everything you picked is done."}
                  </Text>
                  <Text className="text-sm text-muted">
                    You showed up today. Momentum will use this to shape tomorrow.
                  </Text>
                </View>
                {state.momentumSettings.eveningReflection && (
                  <CompletionReflection
                    value={state.todayReflection}
                    result={state.todayReflectionResult}
                    onSelectResult={(result) => {
                      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
                      setTodayReflectionResult(result);
                    }}
                    onSave={setTodayReflection}
                  />
                )}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <IdeasSheet
        visible={ideasOpen}
        onClose={() => setIdeasOpen(false)}
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
        onSort={async (text) => {
          const params = {
            text,
            openSlots: Math.max(1, remainingSlots),
            goalTitle: state.momentumProfile.goalTitle,
          };
          // Free plan: the simple on-device split (no AI call).
          const sorted = hasPlus
            ? await sortBrainDump(params)
            : { result: localBrainDump(params.text, params.openSlots), notice: null };
          track("brain_dump_sorted", { source: sorted.result.source, count: sorted.result.picks.length });
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

      <CelebrationOverlay visible={showCelebration} onDismiss={dismissCelebration} />

      <OnboardingModal
        visible={ready && !state.hasSeenOnboarding && !state.pendingRollover}
        initialProfile={state.momentumProfile}
        onComplete={(profile) => {
          completeMomentumOnboarding(profile);
          track("onboarding_completed", { source: profile.goalSource ?? "none" });
          // Offer the trial once, at the end of first-run onboarding (closable).
          if (paywallEnabled && !hasPlus) showPaywall("onboarding", { afterSheet: true });
        }}
      />

      <RolloverModal
        visible={Boolean(state.pendingRollover)}
        pending={state.pendingRollover}
        remainingSlots={remainingSlots}
        currentTaskCount={state.tasks.length}
        onApply={resolveRollover}
      />
    </ScreenContainer>
  );
}
