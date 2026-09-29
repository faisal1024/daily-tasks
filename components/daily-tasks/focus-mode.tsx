// "Start" focus mode (1.2): one task, full screen, with its steps and its
// timer. Since 1.3 it's the detail view of the focus session: the timer is
// the store's, so closing this doesn't stop it. Done ticks the task through
// Today's normal toggle path.
import { useEffect, useRef } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FocusCheckIn, type FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { FocusTimerPanel } from "@/components/daily-tasks/focus-timer-panel";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { sessionMinutes, type FocusSession } from "@/lib/daily-tasks/focus-session";
import type { Task } from "@/lib/daily-tasks/types";

interface FocusModeProps {
  task: Task;
  /** The coach's `start` line for this task (AI or built-in), if any. */
  startLine?: string | null;
  /** The focus session, when it's on this task. */
  session: FocusSession | null;
  onToggleStep: (stepId: string) => void;
  /**
   * Ticks the task the normal way (once); the screen closes focus mode.
   * `timer` is the session's length in minutes, 0 for none.
   */
  onDone: (timer: number) => void;
  /** Closes; a running timer keeps going. */
  onClose: () => void;
  /** A length was chosen here, in minutes (1–180): starts a session on this task. */
  onStartTimer: (minutes: number) => void;
  controls: FocusSessionControls;
  /** Opens with the custom length wheel showing. */
  initialCustom?: boolean;
}

/**
 * Mounted only while open (see Today). Full screen on iPhone; Done and Close
 * are the ways out, and neither stops the timer (Stop timer does).
 */
export function FocusMode({
  task,
  startLine,
  session,
  onToggleStep,
  onDone,
  onClose,
  onStartTimer,
  controls,
  initialCustom = false,
}: FocusModeProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animation = useSheetAnimation();
  const fullScreen = Platform.OS === "ios" && !Platform.isPad;
  const timerActive = session !== null && session.status !== "ended";

  // Custom opening or a timer starting scrolls the timer (last) into view.
  const scrollRef = useRef<ScrollView>(null);
  const revealFrame = useRef<number | null>(null);
  const revealTimer = () => {
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = null;
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };
  useEffect(
    () => () => {
      if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
    },
    [],
  );

  // A double tap on Done must tick it only once.
  const doneRef = useRef(false);
  const done = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(session ? sessionMinutes(session) : 0);
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
          ref={scrollRef}
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

          <FocusTimerPanel
            session={session}
            onStart={onStartTimer}
            controls={controls}
            initialCustom={initialCustom}
            onReveal={revealTimer}
            checkIn={
              session ? <FocusCheckIn session={session} controls={controls} showDone={false} /> : null
            }
          />
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
            accessibilityLabel="Close"
            accessibilityHint={timerActive ? "Closes focus mode. The timer keeps going." : "Closes focus mode"}
            style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
            testID="focus-close"
          >
            <Text className="text-base font-semibold" style={{ color: colors.muted }}>
              Close
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
