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
import { Fonts } from "@/constants/theme";
import { ScreenContainer } from "@/components/screen-container";
import { TodayHero } from "@/components/daily-tasks/today-hero";
import { stageForLevel } from "@/lib/daily-tasks/journey";
import { AddTaskRow } from "@/components/daily-tasks/add-task-row";
import { CompletionReflection } from "@/components/daily-tasks/completion-reflection";
import { CelebrationOverlay } from "@/components/daily-tasks/celebration-overlay";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TaskSuggestions } from "@/components/daily-tasks/task-suggestions";
import { UpdateBanner } from "@/components/daily-tasks/update-banner";
import { useAppUpdate } from "@/hooks/use-app-update";
import { greetingFor, greetingText } from "@/lib/daily-tasks/date";
import { generateMomentumSuggestions } from "@/lib/daily-tasks/momentum";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { computeDayStreak } from "@/lib/daily-tasks/streaks";
import type { GeneratedTask } from "@/lib/daily-tasks/types";
import { MAX_TASKS } from "@/lib/daily-tasks/types";

function impact(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(style).catch(() => {});
}

function celebrationHaptic() {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
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
    dismissAutoLockNotice,
    resolveRollover,
    completeMomentumOnboarding,
    setTodayReflection,
    setTodayReflectionResult,
    requestMomentumPlan,
    journeyLevel,
    journeyProgress,
  } = useDailyTasks();
  const { update, dismiss: dismissUpdate } = useAppUpdate();

  const addedTexts = useMemo(
    () => new Set(state.tasks.map((task) => task.text.trim().toLowerCase())),
    [state.tasks],
  );
  const canRegenerate = getMomentumAiProxyUrl() != null;

  const [showCelebration, setShowCelebration] = useState(false);
  const lastCelebrationDay = useRef<string | null>(null);

  const total = state.tasks.length;
  const dayStreak = computeDayStreak(state.history, today);
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
      lastCelebrationDay.current !== today
    ) {
      lastCelebrationDay.current = today;
      celebrationHaptic();
      setShowCelebration(true);
    }
    if (completedCount < MAX_TASKS && lastCelebrationDay.current === today) {
      lastCelebrationDay.current = null;
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
        <TodayHero
          greeting={greeting}
          completed={completedCount}
          total={total}
          dayStreak={dayStreak}
          level={journeyLevel}
          stageLabel={stageForLevel(journeyLevel).label}
          stageGlyph={stageForLevel(journeyLevel).glyph}
          xpRatio={journeyProgress.ratio}
          xpRemaining={journeyProgress.xpRemaining}
        />

        <View style={{ paddingHorizontal: 22, paddingTop: 22, gap: 22 }}>
        {update ? <UpdateBanner update={update} onDismiss={dismissUpdate} /> : null}

        <View className="flex-row items-center justify-between">
          <Text
            className="text-foreground"
            style={{ fontFamily: Fonts.rounded, fontWeight: "800", fontSize: 26 }}
          >
            Today&apos;s Three
          </Text>
          <View
            className="rounded-2xl px-3 py-1.5"
            style={{ backgroundColor: `${colors.primary}1A` }}
          >
            <Text className="font-extrabold" style={{ color: colors.primary }}>
              {completedCount} / {total || MAX_TASKS}
            </Text>
          </View>
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

        {!state.todayLocked && remainingSlots > 0 && momentumSuggestions.length > 0 && (
          <MomentumSuggestionCard
            goalTitle={state.momentumProfile.goalTitle}
            suggestions={momentumSuggestions}
            adaptationReason={state.adaptationSnapshot?.reason ?? null}
            addedTexts={addedTexts}
            remainingSlots={remainingSlots}
            canRegenerate={canRegenerate}
            regenerating={state.momentumPlanStatus === "loading"}
            onAdd={(text) => {
              impact(Haptics.ImpactFeedbackStyle.Light);
              addTask(text);
            }}
            onAddAll={() => {
              impact(Haptics.ImpactFeedbackStyle.Medium);
              addTasks(
                momentumSuggestions
                  .filter((task) => !addedTexts.has(task.text.trim().toLowerCase()))
                  .map((task) => task.text),
              );
            }}
            onRegenerate={() => {
              impact(Haptics.ImpactFeedbackStyle.Light);
              void requestMomentumPlan();
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

          {remainingSlots > 0 && !state.todayLocked && momentumSuggestions.length === 0 && (
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
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <CelebrationOverlay
        visible={showCelebration}
        onDismiss={() => setShowCelebration(false)}
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
      <Text className="text-sm uppercase tracking-wide text-muted font-semibold">
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

function MomentumSuggestionCard({
  goalTitle,
  suggestions,
  adaptationReason,
  addedTexts,
  remainingSlots,
  canRegenerate,
  regenerating,
  onAdd,
  onAddAll,
  onRegenerate,
}: {
  goalTitle: string | null;
  suggestions: GeneratedTask[];
  adaptationReason: string | null;
  addedTexts: Set<string>;
  remainingSlots: number;
  canRegenerate: boolean;
  regenerating: boolean;
  onAdd: (text: string) => void;
  onAddAll: () => void;
  onRegenerate: () => void;
}) {
  const colors = useColors();
  const available = suggestions.filter(
    (task) => !addedTexts.has(task.text.trim().toLowerCase()),
  );

  return (
    <View className="rounded-3xl bg-surface border border-border p-5 gap-4">
      <View className="gap-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm uppercase tracking-wide text-muted font-semibold">
            Suggested for you
          </Text>
          {canRegenerate && (
            <Pressable
              onPress={onRegenerate}
              disabled={regenerating}
              accessibilityRole="button"
              accessibilityLabel="Get new suggestions"
              hitSlop={8}
              className="flex-row items-center gap-1"
              style={{ opacity: regenerating ? 0.5 : 1 }}
            >
              <Ionicons name="refresh" size={16} color={colors.primary} />
              <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                {regenerating ? "Refreshing…" : "New ideas"}
              </Text>
            </Pressable>
          )}
        </View>
        <Text className="text-2xl font-bold text-foreground">
          Pick what works toward {goalTitle ?? "your goal"}
        </Text>
        <Text className="text-base text-muted">
          Add any you like — one, two, or all three. You can also write your own below.
        </Text>
        {adaptationReason && (
          <Text className="text-xs text-muted">{adaptationReason}</Text>
        )}
      </View>

      <View className="gap-2">
        {suggestions.map((task) => {
          const added = addedTexts.has(task.text.trim().toLowerCase());
          const disabled = added || remainingSlots <= 0;
          return (
            <Pressable
              key={task.id}
              onPress={() => onAdd(task.text)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={added ? `${task.text}, added` : `Add ${task.text}`}
              className="rounded-2xl bg-background border p-3 flex-row items-center gap-3"
              style={{
                borderColor: added ? colors.success : colors.border,
                opacity: disabled && !added ? 0.5 : 1,
              }}
            >
              <Ionicons
                name={added ? "checkmark-circle" : "add-circle-outline"}
                size={26}
                color={added ? colors.success : colors.primary}
              />
              <View className="flex-1 gap-0.5">
                <Text className="text-base font-semibold text-foreground">{task.text}</Text>
                <Text className="text-sm text-muted">{task.estimatedMinutes} min</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {available.length > 1 && remainingSlots > 0 && (
        <Pressable
          onPress={onAddAll}
          className="self-stretch rounded-full py-3 items-center bg-foreground"
          accessibilityRole="button"
          accessibilityLabel="Add all suggestions"
        >
          <Text className="text-base font-semibold text-background">
            {available.length > remainingSlots
              ? `Add ${remainingSlots} more`
              : "Add all"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

