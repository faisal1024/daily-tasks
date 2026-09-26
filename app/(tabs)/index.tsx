import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import { aiFailureMessage } from "@/lib/daily-tasks/ai-status";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import { greetingFor, greetingText } from "@/lib/daily-tasks/date";
import { generateMomentumSuggestions } from "@/lib/daily-tasks/momentum";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { shouldRequestReview } from "@/lib/daily-tasks/review-prompt";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { computeDayStreak } from "@/lib/daily-tasks/streaks";
import {
  ideasSource,
  isPerfectDayTransition,
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
  } = useDailyTasks();
  const { update, dismiss: dismissUpdate } = useAppUpdate();

  const [showCelebration, setShowCelebration] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);

  const total = state.tasks.length;
  const progress = todayProgress(completedCount, total);
  const status = todayStatus({
    locked: state.todayLocked,
    lockSource: state.todayLockSource,
    taskCount: total,
    completedCount,
  });
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
  const planIdeas = state.momentumPlan?.todaySuggestions ?? [];
  const genericIdeas = useMemo(
    () => generateMomentumSuggestions(state.momentumProfile),
    [state.momentumProfile],
  );
  const ideas: IdeaItem[] =
    planIdeas.length > 0
      ? planIdeas.map((task) => ({
          id: task.id,
          text: task.text,
          estimatedMinutes: task.estimatedMinutes,
        }))
      : genericIdeas.map((text, index) => ({ id: `starter_${index}`, text }));
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
  useEffect(() => {
    if (!ready) return;
    const transition = isPerfectDayTransition({
      previousCompleted: previousCompleted.current,
      completed: completedCount,
      total,
    });
    previousCompleted.current = completedCount;
    if (!transition) return;

    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    setShowCelebration(true);
    if (
      shouldRequestReview({
        history: state.history,
        lastReviewPromptAt: state.lastReviewPromptAt,
        now: new Date(),
        justCompletedPerfectDay: true,
      })
    ) {
      markReviewPrompted();
      // Let the celebration land first; the system sheet would cover it.
      setTimeout(() => void requestAppReview(), 2500);
    }
  }, [ready, completedCount, total, state.history, state.lastReviewPromptAt, markReviewPrompted]);

  // The sheet has nothing to add once the day is locked.
  useEffect(() => {
    if (state.todayLocked) setIdeasOpen(false);
  }, [state.todayLocked]);

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

            <StatusLine
              status={status}
              onLock={() => {
                haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
                lockToday();
              }}
            />

            {showIdeasEntry({ locked: state.todayLocked, remainingSlots }) && (
              <Pressable
                onPress={() => setIdeasOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Need ideas? Open suggestions"
                className="flex-row items-center justify-center gap-2 rounded-2xl py-3.5 border"
                style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                testID="need-ideas"
              >
                <Ionicons
                  name={source.personalized ? "sparkles" : "bulb-outline"}
                  size={18}
                  color={colors.primary}
                />
                <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                  Need ideas?
                </Text>
              </Pressable>
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
        canRegenerate={getMomentumAiProxyUrl() != null && planIdeas.length > 0}
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
      />

      <CelebrationOverlay visible={showCelebration} onDismiss={() => setShowCelebration(false)} />

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
