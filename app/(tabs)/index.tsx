import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import { generateMomentumSuggestions } from "@/lib/daily-tasks/momentum";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import {
  computeDayStreak,
  computePerfectStreak,
} from "@/lib/daily-tasks/streaks";
import type { GeneratedTask } from "@/lib/daily-tasks/types";
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
    addTasks,
    editTask,
    deleteTask,
    toggleTask,
    lockToday,
    dismissAutoLockNotice,
    resolveRollover,
    completeMomentumOnboarding,
    setTodayReflection,
    setTodayReflectionResult,
  } = useDailyTasks();

  const [confetti, setConfetti] = useState(false);
  const lastConfettiDay = useRef<string | null>(null);

  const total = state.tasks.length;
  const dayStreak = computeDayStreak(state.history, today);
  const perfectStreak = computePerfectStreak(state.history, today);
  const greeting = greetingText(greetingFor());
  const suggestions = useMemo(
    () => generateMomentumSuggestions(state.momentumProfile),
    [state.momentumProfile],
  );
  const momentumSuggestions = state.momentumPlan?.todaySuggestions ?? [];

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
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="text-base text-muted">{greeting}</Text>
          <Text className="text-3xl font-bold text-foreground">
            Today's Three
          </Text>
          <Text className="text-sm text-muted">
            Your accountability coach for three daily commitments.
          </Text>
        </View>

        <CoachRitualCard
          goalTitle={state.momentumProfile.goalTitle}
          completedCount={completedCount}
          total={total}
          locked={state.todayLocked}
        />

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
              What are you willing to be accountable for today?
            </Text>
            <Text className="text-sm text-muted">
              Momentum helps you choose fewer tasks, follow through, and learn
              from the day.
            </Text>
          </View>
        )}

        {state.tasks.length === 0 && !state.todayLocked && momentumSuggestions.length > 0 && (
          <MomentumSuggestionCard
            goalTitle={state.momentumProfile.goalTitle}
            suggestions={momentumSuggestions}
            adaptationReason={state.adaptationSnapshot?.reason ?? null}
            onAccept={() => {
              impact(Haptics.ImpactFeedbackStyle.Medium);
              addTasks(momentumSuggestions.map((task) => task.text));
            }}
          />
        )}

        {total > 0 && completedCount < total && (
          <AccountabilityCheckCard
            completedCount={completedCount}
            total={total}
            locked={state.todayLocked}
          />
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
                onAdd={(text) => {
                  impact(Haptics.ImpactFeedbackStyle.Light);
                  addTask(text);
                }}
              />
            );
          })}

          {state.tasks.length === 0 && !state.todayLocked && momentumSuggestions.length === 0 && (
            <TaskSuggestions
              suggestions={suggestions}
              title={
                state.momentumProfile.goalTitle
                  ? `For ${state.momentumProfile.goalTitle}`
                  : "Gentle starting points"
              }
              onPick={(text) => {
                impact(Haptics.ImpactFeedbackStyle.Light);
                addTask(text);
              }}
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
                You showed up today. Momentum will use this check-in to tune
                tomorrow.
              </Text>
            </View>
            {state.momentumSettings.eveningReflection && (
              <CompletionReflection
                value={state.todayReflection}
                result={state.todayReflectionResult}
                onSelectResult={(result) => {
                  impact(Haptics.ImpactFeedbackStyle.Light);
                  setTodayReflectionResult(result);
                }}
                onSave={setTodayReflection}
              />
            )}
          </>
        )}
      </ScrollView>

      <ConfettiOverlay
        visible={confetti}
        onDismiss={() => setConfetti(false)}
      />

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

function CoachRitualCard({
  goalTitle,
  completedCount,
  total,
  locked,
}: {
  goalTitle: string | null;
  completedCount: number;
  total: number;
  locked: boolean;
}) {
  const hasTasks = total > 0;
  const isDone = hasTasks && completedCount === total;
  const phase = !hasTasks
    ? "Commit"
    : isDone
      ? "Reflect"
      : locked
        ? "Follow through"
        : "Set the day";
  const title = !hasTasks
    ? "Start with the three that actually matter."
    : isDone
      ? "Capture the win before tomorrow arrives."
      : locked
        ? "The list is protected. Now finish calmly."
        : "Choose, then stop choosing.";
  const body = !hasTasks
    ? "Your coach will help turn one meaningful goal into a small list you can stand behind today."
    : isDone
      ? "A quick reflection helps Momentum make tomorrow easier, sharper, or just right."
      : locked
        ? "No backlog, no reshuffle. Pick the next unfinished commitment and give it your attention."
        : "When the list feels honest, set it. Momentum works best when today has edges.";

  return (
    <View className="rounded-3xl bg-foreground p-5 gap-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-xs uppercase tracking-wide text-background/70">
          Momentum coach
        </Text>
        <Text className="text-xs font-semibold text-background/80">
          {phase}
        </Text>
      </View>
      <View className="gap-2">
        <Text className="text-2xl font-bold text-background">{title}</Text>
        <Text className="text-sm text-background/75">{body}</Text>
      </View>
      {goalTitle && (
        <View className="self-start rounded-full bg-background/12 px-3 py-1.5">
          <Text className="text-xs font-semibold text-background">
            Goal: {goalTitle}
          </Text>
        </View>
      )}
    </View>
  );
}

function MomentumSuggestionCard({
  goalTitle,
  suggestions,
  adaptationReason,
  onAccept,
}: {
  goalTitle: string | null;
  suggestions: GeneratedTask[];
  adaptationReason: string | null;
  onAccept: () => void;
}) {
  return (
    <View className="rounded-3xl bg-surface border border-border p-5 gap-4">
      <View className="gap-1">
        <Text className="text-xs uppercase tracking-wide text-muted">
          Coach-picked trio
        </Text>
        <Text className="text-xl font-semibold text-foreground">
          Three commitments toward {goalTitle ?? "your goal"}
        </Text>
        <Text className="text-sm text-muted">
          Small enough to do today. Focused enough to build discipline.
        </Text>
        {adaptationReason && (
          <Text className="text-xs text-muted">
            {adaptationReason}
          </Text>
        )}
      </View>

      <View className="gap-2">
        {suggestions.map((task, index) => (
          <View
            key={task.id}
            className="rounded-2xl bg-background border border-border p-3 flex-row gap-3"
          >
            <View className="w-6 h-6 rounded-full border border-border items-center justify-center">
              <Text className="text-xs font-semibold text-muted">{index + 1}</Text>
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-semibold text-foreground">
                {task.text}
              </Text>
              <Text className="text-xs text-muted">
                {task.estimatedMinutes} min · {task.reason}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={onAccept}
        className="self-stretch rounded-full py-3 items-center bg-foreground"
        accessibilityRole="button"
        accessibilityLabel="Set suggested tasks as Today's Three"
      >
        <Text className="text-base font-semibold text-background">
          Commit to these three
        </Text>
      </Pressable>
    </View>
  );
}

function AccountabilityCheckCard({
  completedCount,
  total,
  locked,
}: {
  completedCount: number;
  total: number;
  locked: boolean;
}) {
  const remaining = Math.max(0, total - completedCount);
  const remainingLabel = `${remaining} commitment${remaining === 1 ? "" : "s"} left`;

  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-2">
      <Text className="text-xs uppercase tracking-wide text-muted">
        Accountability check-in
      </Text>
      <Text className="text-base font-semibold text-foreground">
        {locked ? remainingLabel : "Choose the work you'll stand behind"}
      </Text>
      <Text className="text-sm text-muted">
        {locked
          ? "The list is set. Pick one unfinished task and give it 10 focused minutes."
          : "Before the day gets noisy, set the three commitments that deserve follow-through."}
      </Text>
    </View>
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
