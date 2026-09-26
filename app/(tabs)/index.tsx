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
import { aiFailureMessage, classifyAiFailure } from "@/lib/daily-tasks/ai-status";
import { requestBreakDown, sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import { greetingFor, greetingText } from "@/lib/daily-tasks/date";
import { generateMomentumSuggestions } from "@/lib/daily-tasks/momentum";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { shouldRequestReview } from "@/lib/daily-tasks/review-prompt";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { computeDayStreak } from "@/lib/daily-tasks/streaks";
import {
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
  } = useDailyTasks();
  const { update, dismiss: dismissUpdate } = useAppUpdate();

  const [showCelebration, setShowCelebration] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [breakingTaskId, setBreakingTaskId] = useState<string | null>(null);
  const aiAvailable = getMomentumAiProxyUrl() != null;

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

  const handleBreakDown = async (taskId: string, text: string) => {
    if (breakingTaskId) return;
    setBreakingTaskId(taskId);
    try {
      const steps = await requestBreakDown({ task: text, goalTitle: state.momentumProfile.goalTitle });
      haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
      setTaskSteps(taskId, steps);
    } catch (error) {
      Alert.alert(
        "Couldn't break it down",
        aiFailureMessage(classifyAiFailure(error)) ?? "Try again in a bit.",
      );
    } finally {
      setBreakingTaskId(null);
    }
  };

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
                        aiAvailable ? () => void handleBreakDown(task.id, task.text) : undefined
                      }
                      breakingDown={breakingTaskId === task.id}
                      onToggleStep={(stepId) => toggleTaskStep(task.id, stepId)}
                      onClearSteps={state.todayLocked ? undefined : () => clearTaskSteps(task.id)}
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
              <View className="gap-2">
                <Pressable
                  onPress={() => setIdeasOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.label}. Opens suggestions`}
                  className="flex-row items-center justify-center gap-2 rounded-2xl py-3.5 border"
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
                  className="flex-row items-center justify-center gap-2 rounded-2xl py-3 border"
                  style={{ borderColor: colors.border }}
                  testID="brain-dump-entry"
                >
                  <Ionicons name="cloud-outline" size={18} color={colors.primary} />
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
        onSort={(text) =>
          sortBrainDump({
            text,
            openSlots: Math.max(1, remainingSlots),
            goalTitle: state.momentumProfile.goalTitle,
          })
        }
        onConfirm={(picks, parked) => {
          haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
          addTasks(picks);
          parkTasks(parked);
          setBrainDumpOpen(false);
        }}
      />

      <CelebrationOverlay visible={showCelebration} onDismiss={dismissCelebration} />

      <OnboardingModal
        visible={ready && !state.hasSeenOnboarding && !state.pendingRollover}
        initialProfile={state.momentumProfile}
        onComplete={completeMomentumOnboarding}
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
