import { useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { AddTaskRow } from "@/components/daily-tasks/add-task-row";
import { ConfettiOverlay } from "@/components/daily-tasks/confetti-overlay";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { StreakPill } from "@/components/daily-tasks/streak-pill";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { greetingFor, greetingText } from "@/lib/daily-tasks/date";
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
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export default function HomeScreen() {
  const {
    ready,
    state,
    today,
    completedCount,
    isCompleted,
    addTask,
    editTask,
    deleteTask,
    toggleTask,
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
          <Text className="text-3xl font-bold text-foreground">
            Your day, three tasks.
          </Text>
        </View>

        <View className="flex-row gap-3">
          <StreakPill icon="flame" label="Day streak" value={dayStreak} />
          <StreakPill icon="star" label="Perfect days" value={perfectStreak} />
        </View>

        <View className="items-center py-2">
          <ProgressRing completed={completedCount} total={total || MAX_TASKS} />
        </View>

        <View className="gap-3">
          {state.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              completed={isCompleted(task.id)}
              onToggle={() => handleToggle(task.id)}
              onEdit={(text) => editTask(task.id, text)}
              onDelete={() => handleDelete(task.id, task.text)}
            />
          ))}

          <AddTaskRow
            remainingSlots={MAX_TASKS - state.tasks.length}
            onAdd={(text) => {
              impact(Haptics.ImpactFeedbackStyle.Light);
              addTask(text);
            }}
          />

          {state.tasks.length === 0 && (
            <Text className="text-sm text-muted text-center mt-2">
              Add up to three tasks to focus on today.
            </Text>
          )}
        </View>
      </ScrollView>

      <ConfettiOverlay visible={confetti} onDismiss={() => setConfetti(false)} />
    </ScreenContainer>
  );
}
