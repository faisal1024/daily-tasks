import { useEffect, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { AddTaskRow } from "@/components/daily-tasks/add-task-row";
import { ConfettiOverlay } from "@/components/daily-tasks/confetti-overlay";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import { StreakPill } from "@/components/daily-tasks/streak-pill";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TaskSuggestions } from "@/components/daily-tasks/task-suggestions";
import { greetingFor, greetingText } from "@/lib/daily-tasks/date";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { computeDayStreak, computePerfectStreak } from "@/lib/daily-tasks/streaks";
import { MAX_TASKS, TASK_SUGGESTIONS } from "@/lib/daily-tasks/types";

function impact(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(style).catch(() => {});
}

function success() {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
  } = useDailyTasks();

  const [confetti, setConfetti] = useState(false);
  const lastConfettiDay = useRef<string | null>(null);

  const total = state.tasks.length;
  const dayStreak = computeDayStreak(state.history, today);
  const perfectStreak = computePerfectStreak(state.history, today);
  const greeting = greetingText(greetingFor());

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
    Alert.alert("Delete task?", `Remove "${text}"?`, [
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
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
        <Text className="text-base text-muted">{greeting}</Text>
          <Text className="text-3xl font-bold text-foreground">Your day, three tasks.</Text>
        </View>

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
              Choose up to three tasks. Keep it small enough to finish.
            </Text>
          </View>
        )}

        <View className="gap-3">
          {state.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              completed={isCompleted(task.id)}
              onToggle={() => handleToggle(task.id)}
              onEdit={(text) => editTask(task.id, text)}
              onDelete={() => handleDelete(task.id, task.text)}
              canEdit={!state.todayLocked}
              canDelete={!state.todayLocked}
            />
          ))}

          <AddTaskRow
            remainingSlots={remainingSlots}
            disabled={state.todayLocked}
            onAdd={(text) => {
              impact(Haptics.ImpactFeedbackStyle.Light);
              addTask(text);
            }}
          />

          {state.tasks.length === 0 && !state.todayLocked && (
            <TaskSuggestions
              suggestions={TASK_SUGGESTIONS}
              onPick={(text) => {
                impact(Haptics.ImpactFeedbackStyle.Light);
                addTask(text);
              }}
            />
          )}
        </View>

        {total > 0 && completedCount === total && (
          <View className="rounded-2xl bg-surface border border-border p-4 gap-1">
            <Text className="text-sm font-semibold text-foreground">
              {total === MAX_TASKS ? "Today's three are done." : "Today's list is done."}
            </Text>
            <Text className="text-sm text-muted">
              A small finish is still a finish.
            </Text>
          </View>
        )}
      </ScrollView>

      <ConfettiOverlay visible={confetti} onDismiss={() => setConfetti(false)} />

      <OnboardingModal
        visible={ready && !state.hasSeenOnboarding && !state.pendingRollover}
        onDismiss={markOnboardingSeen}
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
          {lockSource === "auto" ? "Today's list is locked" : "Today's list is set"}
        </Text>
        <Text className="text-sm text-muted">
          Your list is locked for today so you can focus on finishing.
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
        <Text className="text-sm font-semibold text-foreground">Still editable</Text>
        <Text className="text-sm text-muted">
          Lock today's list when it feels set, even if you picked fewer than three tasks.
        </Text>
      </View>
      <Pressable
        onPress={onLock}
        className="self-start rounded-full px-4 py-2 border border-border"
      >
        <Text className="text-sm font-semibold text-foreground">Lock Today's List</Text>
      </Pressable>
    </View>
  );
}
