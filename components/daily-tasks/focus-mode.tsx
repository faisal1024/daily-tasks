// "Start" focus mode (1.2): one task, full screen, with its steps and an
// optional timer. Done ticks it through Today's normal toggle path.
import { useRef } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FocusTimerPanel } from "@/components/daily-tasks/focus-timer-panel";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { timesUpText } from "@/lib/daily-tasks/focus-timer";
import type { Task } from "@/lib/daily-tasks/types";

export { timesUpText };

interface FocusModeProps {
  task: Task;
  /** The coach's `start` line for this task (AI or built-in), if any. */
  startLine?: string | null;
  onToggleStep: (stepId: string) => void;
  /**
   * Ticks the task the normal way (once); the screen closes focus mode.
   * `timer` is the last started timer's length in minutes, 0 for none.
   */
  onDone: (timer: number) => void;
  /** Closes without changes. */
  onClose: () => void;
  /** A timer was started (or restarted), with its length in minutes (1–180). */
  onTimerStart?: (timer: number) => void;
}

/**
 * Mounted only while open (see Today), so each open starts with no timer.
 * Full screen on iPhone, so a stray swipe can't drop a running timer: Done
 * and Not now are the ways out (either one ends the timer and its
 * notification).
 */
export function FocusMode({ task, startLine, onToggleStep, onDone, onClose, onTimerStart }: FocusModeProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animation = useSheetAnimation();
  const fullScreen = Platform.OS === "ios" && !Platform.isPad;
  // The last started timer's length (0 for none), reported on Done.
  const lastTimer = useRef(0);
  const timerStarted = (minutes: number) => {
    lastTimer.current = minutes;
    onTimerStart?.(minutes);
  };

  // A double tap on Done must tick it only once.
  const doneRef = useRef(false);
  const done = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(lastTimer.current);
  };

  const steps = task.steps ?? [];
  const allStepsDone = steps.length > 0 && steps.every((step) => step.done);

  return (
    <Modal
      visible
      onRequestClose={onClose}
      animationType={animation}
      presentationStyle={fullScreen ? "fullScreen" : "pageSheet"}
    >
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        accessibilityViewIsModal
        testID="focus-mode"
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            // A page sheet (iPad) sits below the status bar already.
            paddingTop: Platform.OS === "ios" && !fullScreen ? 32 : insets.top + 24,
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

          <FocusTimerPanel onStart={timerStarted} />
        </ScrollView>

        <View className="px-6 pt-3 gap-2" style={{ paddingBottom: insets.bottom + 16 }}>
          {allStepsDone ? (
            <Text className="text-sm text-center" style={{ color: colors.muted }} testID="focus-steps-done">
              All steps done.
            </Text>
          ) : null}
          <Pressable
            onPress={done}
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
            <Text className="text-base font-bold" style={{ color: colors.onPrimary }}>
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
