// "Start" focus mode (1.2): one task, full screen, with its steps and an
// optional gentle timer. Done ticks it through Today's normal toggle path.
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import type { Task } from "@/lib/daily-tasks/types";

export type FocusTimer = 0 | 10 | 25;
export const FOCUS_TIMERS: FocusTimer[] = [0, 10, 25];
export const TIMES_UP_TEXT = "Time's up. Keep going, or take a break.";

const MINUTE_MS = 60_000;

/** m:ss, rounding up so it never shows 0:00 with time still left. */
function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface FocusModeProps {
  visible: boolean;
  task: Task;
  /** The coach's `start` line for this task (AI or built-in), if any. */
  startLine?: string | null;
  onToggleStep: (stepId: string) => void;
  /** Ticks the task the normal way; the screen closes focus mode. */
  onDone: () => void;
  /** Not now, or swiped away: closes without changes. */
  onClose: () => void;
  /** Once, however it closes (or unmounts): the last timer started, 0 if none. */
  onEnd?: (timer: FocusTimer) => void;
}

/**
 * Mounted only while open (see Today), so each open starts with no timer.
 * The timer runs from a start timestamp, so it's right after the app comes
 * back from the background; it ticks each second only while running.
 */
export function FocusMode({ visible, task, startLine, onToggleStep, onDone, onClose, onEnd }: FocusModeProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [timer, setTimer] = useState<FocusTimer>(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const durationMs = timer * MINUTE_MS;
  const remainingMs = startedAt === null ? 0 : Math.max(0, durationMs - (now - startedAt));
  const running = startedAt !== null && remainingMs > 0;
  const finished = startedAt !== null && remainingMs === 0;

  // Analytics on the way out: the last timer they started.
  const lastTimer = useRef<FocusTimer>(0);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  useEffect(() => () => onEndRef.current?.(lastTimer.current), []);

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [running]);

  // Once per run: one light haptic and the line read out. Never closes.
  useEffect(() => {
    if (!finished) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    AccessibilityInfo.announceForAccessibility(TIMES_UP_TEXT);
  }, [finished]);

  // Picking a length (again) starts it from the top; None clears it.
  const pickTimer = (minutes: FocusTimer) => {
    setTimer(minutes);
    if (minutes === 0) {
      setStartedAt(null);
      return;
    }
    const start = Date.now();
    setStartedAt(start);
    setNow(start);
    lastTimer.current = minutes;
    AccessibilityInfo.announceForAccessibility(`Timer started, ${minutes} minutes`);
  };

  const steps = task.steps ?? [];
  // Read as whole minutes, so VoiceOver isn't told every second.
  const minutesLeft = Math.ceil(remainingMs / MINUTE_MS);
  const timerLabel = finished
    ? "Timer finished"
    : `Timer: ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"} left of ${timer}`;

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        accessibilityViewIsModal
        testID="focus-mode"
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: Platform.OS === "ios" ? 32 : insets.top + 24,
            paddingBottom: 24,
            gap: 20,
          }}
        >
          <View className="gap-2">
            <Text
              className="text-xs font-bold uppercase"
              style={{ color: colors.primary, letterSpacing: 0.6 }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              Focus
            </Text>
            <Text
              accessibilityRole="header"
              accessibilityLabel={`Focus: ${task.text}`}
              style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontSize: 28, fontWeight: "700", lineHeight: 36 }}
              testID="focus-task-text"
            >
              {task.text}
            </Text>
            {startLine ? (
              <Text className="text-base" style={{ color: colors.muted }} testID="focus-start-line">
                {startLine}
              </Text>
            ) : null}
          </View>

          {steps.length > 0 ? (
            <View className="rounded-3xl p-4 gap-1" style={{ backgroundColor: colors.surface }} testID="focus-steps">
              {steps.map((step, stepIndex) => (
                <Pressable
                  key={step.id}
                  onPress={() => onToggleStep(step.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: step.done }}
                  accessibilityLabel={`Step ${stepIndex + 1} of ${steps.length}: ${step.text}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}
                  testID={`focus-step-${step.id}`}
                >
                  <Ionicons
                    name={step.done ? "checkbox" : "square-outline"}
                    size={22}
                    color={step.done ? colors.success : colors.muted}
                  />
                  <Text
                    className="flex-1 text-base text-foreground"
                    style={{ textDecorationLine: step.done ? "line-through" : "none", opacity: step.done ? 0.6 : 1 }}
                  >
                    {step.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="gap-4 items-center">
            <View
              className="flex-row self-stretch rounded-full p-1"
              style={{ backgroundColor: colors.surface }}
              testID="focus-timer-options"
            >
              {FOCUS_TIMERS.map((minutes) => {
                const selected = minutes === timer;
                return (
                  <Pressable
                    key={minutes}
                    onPress={() => pickTimer(minutes)}
                    accessibilityRole="button"
                    accessibilityLabel={minutes === 0 ? "No timer" : `${minutes} minute timer`}
                    accessibilityState={{ selected }}
                    accessibilityHint={minutes !== 0 && selected ? "Starts it again" : undefined}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      backgroundColor: selected ? colors.primary : "transparent",
                    }}
                    testID={`focus-timer-${minutes}`}
                  >
                    <Text className="text-sm font-semibold" style={{ color: selected ? "#fff" : colors.foreground }}>
                      {minutes === 0 ? "None" : `${minutes} min`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {startedAt !== null ? (
              <View accessible accessibilityLabel={timerLabel} testID="focus-timer-ring">
                <ProgressRing completed={durationMs - remainingMs} total={durationMs} size={168} strokeWidth={10}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: Fonts.rounded,
                      fontSize: 36,
                      fontWeight: "700",
                      fontVariant: ["tabular-nums"],
                    }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    testID="focus-timer-remaining"
                  >
                    {clock(remainingMs)}
                  </Text>
                </ProgressRing>
              </View>
            ) : null}

            {finished ? (
              <Text className="text-base text-center text-foreground" testID="focus-times-up">
                {TIMES_UP_TEXT}
              </Text>
            ) : null}
          </View>
        </ScrollView>

        <View className="px-6 pt-3 gap-2" style={{ paddingBottom: insets.bottom + 16 }}>
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Done"
            accessibilityHint="Marks this task done"
            style={({ pressed }) => ({
              minHeight: 52,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
            })}
            testID="focus-done"
          >
            <Text className="text-base font-bold" style={{ color: "#fff" }}>
              Done
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            accessibilityHint="Closes focus mode"
            style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
            testID="focus-not-now"
          >
            <Text className="text-base font-semibold" style={{ color: colors.muted }}>
              Not now
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
