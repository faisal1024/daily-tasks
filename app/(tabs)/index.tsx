import { useEffect, useRef, useState } from "react";
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

import { ScreenContainer } from "@/components/screen-container";
import { AddTaskRow } from "@/components/daily-tasks/add-task-row";
import { CompletionReflection } from "@/components/daily-tasks/completion-reflection";
import { ConfettiOverlay } from "@/components/daily-tasks/confetti-overlay";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import { StreakPill } from "@/components/daily-tasks/streak-pill";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TaskSuggestions } from "@/components/daily-tasks/task-suggestions";
import { TodaySummaryCard } from "@/components/daily-tasks/today-summary-card";
import { greetingFor, greetingText } from "@/lib/daily-tasks/date";
import { randomPersonalizedTask } from "@/lib/daily-tasks/task-catalog";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import {
  computeDayStreak,
  computePerfectStreak,
} from "@/lib/daily-tasks/streaks";
import { MAX_TASKS } from "@/lib/daily-tasks/types";

function impact(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(style).catch(() => {});
}

function success() {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {},
  );
}

export default function HomeScreen() {
  const {
    ready,
    state,
    today,
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
    markOnboardingSeen,
    setProfile,
    setTodayReflection,
  } = useDailyTasks();

  const [confetti, setConfetti] = useState(false);
  const [suggestionAttempt, setSuggestionAttempt] = useState(0);
  const [customSlot, setCustomSlot] = useState<number | null>(null);
  const lastConfettiDay = useRef<string | null>(null);

  const total = state.tasks.length;
  const dayStreak = computeDayStreak(state.history, today);
  const perfectStreak = computePerfectStreak(state.history, today);
  const greeting = greetingText(greetingFor());
  const suggestion =
    ready && !state.pendingRollover && !state.todayLocked && remainingSlots > 0
      ? randomPersonalizedTask(
          state.profile,
          today,
          suggestionAttempt,
          state.tasks.map((task) => task.text),
        )
      : null;

  useEffect(() => {
    if (!ready) return;
    if (
      total === MAX_TASKS &&
      completedCount === MAX_TASKS &&
      lastConfettiDay.current !== today
    ) {
      lastConfettiDay.current = today;
      success();
      setConfetti(true);
    }
    if (completedCount < MAX_TASKS && lastConfettiDay.current === today) {
      lastConfettiDay.current = null;
    }
  }, [ready, total, completedCount, today]);

  const handleToggle = (id: string) => {
    impact(Haptics.ImpactFeedbackStyle.Light);
    toggleTask(id);
  };

  const handleDelete = (id: string, text: string) => {
    Alert.alert("Release this focus?", `Remove "${text}" from Today's Three?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          impact(Haptics.ImpactFeedbackStyle.Medium);
          deleteTask(id);
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 72 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 120, gap: 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <View className="gap-1">
            <Text className="text-base text-muted">{greeting}</Text>
            <Text className="text-3xl font-bold text-foreground">
              Today's Three
            </Text>
            <Text className="text-sm text-muted">
              Pick less. Set the day. Finish calmly.
            </Text>
          </View>

        <TodaySummaryCard
          completedCount={completedCount}
          total={total}
          remainingSlots={remainingSlots}
          locked={state.todayLocked}
        />

        <View className="flex-row gap-3">
          <StreakPill icon="flame" label="Day streak" value={dayStreak} />
          <StreakPill icon="star" label="Perfect days" value={perfectStreak} />
        </View>

        <View className="items-center py-2">
          <ProgressRing completed={completedCount} total={total || MAX_TASKS} />
        </View>

        <LockedStateCard
          locked={state.todayLocked}
          lockSource={state.todayLockSource}
          autoLockNoticeDate={state.autoLockNoticeDate}
          today={today}
          onLock={() => {
            impact(Haptics.ImpactFeedbackStyle.Medium);
            lockToday();
          }}
          onDismissNotice={dismissAutoLockNotice}
        />

        {state.tasks.length === 0 && !state.todayLocked && (
          <View className="gap-2">
            <Text className="text-xl font-semibold text-foreground">
              What would make today feel complete?
            </Text>
            <Text className="text-sm text-muted">
              Most to-do apps help you collect more. This one helps you choose
              less.
            </Text>
          </View>
        )}

        <View className="gap-3">
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
                  key={`empty-focus-${index}`}
                  remainingSlots={remainingSlots}
                  slotNumber={index + 1}
                  disabled={state.todayLocked}
                  forceEditing={customSlot === index}
                  onEditingHandled={() => setCustomSlot(null)}
                  onAdd={(text) => {
                    impact(Haptics.ImpactFeedbackStyle.Light);
                    addTask(text);
                  }}
                />
              );
          })}

          {state.tasks.length < MAX_TASKS && !state.todayLocked && !state.pendingRollover && (
            <TaskSuggestions
              suggestion={suggestion}
              onAccept={(text) => {
                impact(Haptics.ImpactFeedbackStyle.Light);
                addTask(text);
              }}
              onShuffle={() => setSuggestionAttempt((current) => current + 1)}
              onCustom={() => setCustomSlot(state.tasks.length)}
            />
          )}
        </View>

        {total > 0 && completedCount === total && (
          <>
            <View className="rounded-2xl bg-surface border border-border p-4 gap-1">
              <Text className="text-sm font-semibold text-foreground">
                {total === MAX_TASKS
                  ? "Today's Three are done."
                  : "Today's commitments are done."}
              </Text>
              <Text className="text-sm text-muted">
                A small finish is still a finish.
              </Text>
            </View>
            <CompletionReflection
              value={state.todayReflection}
              onSave={setTodayReflection}
            />
          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfettiOverlay
        visible={confetti}
        onDismiss={() => setConfetti(false)}
      />

      <OnboardingModal
        visible={ready && !state.hasSeenOnboarding && !state.pendingRollover}
        profile={state.profile}
        onComplete={(profile) => {
          setProfile(profile);
          markOnboardingSeen();
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

function LockedStateCard({
  locked,
  lockSource,
  autoLockNoticeDate,
  today,
  onLock,
  onDismissNotice,
}: {
  locked: boolean;
  lockSource: "manual" | "auto" | null;
  autoLockNoticeDate: string | null;
  today: string;
  onLock: () => void;
  onDismissNotice: () => void;
}) {
  const autoNoticeVisible = autoLockNoticeDate === today;

  if (locked) {
    return (
      <View className="rounded-2xl bg-surface border border-border p-4 gap-2">
        <Text className="text-sm font-semibold text-foreground">
          {lockSource === "auto"
            ? "Today's Three is set"
            : "Today's Three is set"}
        </Text>
        <Text className="text-sm text-muted">
          You can still check things off, but today is no longer a place to
          reshuffle.
        </Text>
        {autoNoticeVisible && (
          <Pressable onPress={onDismissNotice} className="self-start">
            <Text className="text-sm font-semibold text-foreground">
              Dismiss
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
      <View className="gap-1">
        <Text className="text-sm font-semibold text-foreground">
          Still choosing
        </Text>
        <Text className="text-sm text-muted">
          Set Today's Three when the day feels chosen, even if you picked fewer
          than three.
        </Text>
      </View>
      <Pressable
        onPress={onLock}
        className="self-start rounded-full px-4 py-2 border border-border"
      >
        <Text className="text-sm font-semibold text-foreground">
          Set Today's Three
        </Text>
      </Pressable>
    </View>
  );
}
