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
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { timesUpText } from "@/lib/daily-tasks/focus-timer";
import {
  cancelFocusTimerNotification,
  scheduleFocusTimerNotification,
} from "@/lib/daily-tasks/notifications";
import type { Task } from "@/lib/daily-tasks/types";

export type FocusTimer = 0 | 10 | 25;
export const FOCUS_TIMERS: FocusTimer[] = [0, 10, 25];

export { timesUpText };

const MINUTE_MS = 60_000;
/** Lets the button's own "selected" read out before the timer is announced. */
const START_ANNOUNCE_DELAY_MS = 300;

/** m:ss, rounding up so it never shows 0:00 with time still left. */
function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface FocusModeProps {
  task: Task;
  /** The coach's `start` line for this task (AI or built-in), if any. */
  startLine?: string | null;
  onToggleStep: (stepId: string) => void;
  /** Ticks the task the normal way (once); the screen closes focus mode. */
  onDone: (timer: FocusTimer) => void;
  /** Closes without changes. */
  onClose: () => void;
  /** A timer was started (or started again). */
  onTimerStart?: (timer: Exclude<FocusTimer, 0>) => void;
}

/**
 * Mounted only while open (see Today), so each open starts with no timer.
 * The timer runs from a start timestamp, so it's right after the app comes
 * back from the background; it ticks each second only while running. Full
 * screen on iPhone, so a stray swipe can't drop a running timer: Done and
 * Not now are the ways out.
 */
export function FocusMode({ task, startLine, onToggleStep, onDone, onClose, onTimerStart }: FocusModeProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animation = useSheetAnimation();
  const fullScreen = Platform.OS === "ios" && !Platform.isPad;
  const [timer, setTimer] = useState<FocusTimer>(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const durationMs = timer * MINUTE_MS;
  // Clamped both ways: the clock can move back as well as forward.
  const remainingMs =
    startedAt === null ? 0 : Math.min(durationMs, Math.max(0, durationMs - (now - startedAt)));
  const running = startedAt !== null && remainingMs > 0;
  const finished = startedAt !== null && remainingMs === 0;

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

  // A notification for the end, in case they're in another app (only with
  // permission already given). Replaced on a restart; gone on None or close.
  useEffect(() => {
    if (startedAt === null) return;
    void scheduleFocusTimerNotification(new Date(startedAt + durationMs), durationMs / MINUTE_MS);
    return () => {
      void cancelFocusTimerNotification();
    };
  }, [startedAt, durationMs]);

  // Once per run: one light haptic and the line read out. Never closes.
  useEffect(() => {
    if (!finished) return;
    void cancelFocusTimerNotification();
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    AccessibilityInfo.announceForAccessibility(timesUpText(timer));
    // Only when it finishes; the length can't change without restarting it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    },
    [],
  );

  // None clears it. A length starts it; the running one is left alone (a
  // stray tap mustn't reset it), and starts again once it's finished.
  const pickTimer = (minutes: FocusTimer) => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    if (minutes === 0) {
      setTimer(0);
      setStartedAt(null);
      return;
    }
    if (minutes === timer && running) return;
    const start = Date.now();
    setTimer(minutes);
    setStartedAt(start);
    setNow(start);
    onTimerStart?.(minutes);
    announceTimer.current = setTimeout(() => {
      announceTimer.current = null;
      AccessibilityInfo.announceForAccessibility(`Timer started, ${minutes} minutes`);
    }, START_ANNOUNCE_DELAY_MS);
  };

  // A double tap on Done must tick it only once.
  const doneRef = useRef(false);
  const done = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(timer);
  };

  const steps = task.steps ?? [];
  const allStepsDone = steps.length > 0 && steps.every((step) => step.done);
  // Read as whole minutes, so VoiceOver isn't told every second.
  const minutesLeft = Math.ceil(remainingMs / MINUTE_MS);
  const timerLabel = finished ? "Timer finished" : `${minutesLeft} of ${timer} minutes left`;

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

          <View className="gap-3 items-center">
            <Text className="self-start text-sm font-semibold" style={{ color: colors.muted }}>
              Timer
            </Text>
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
                    accessibilityHint={minutes !== 0 && selected && finished ? "Starts it again" : undefined}
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
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: selected ? colors.onPrimary : colors.foreground }}
                    >
                      {minutes === 0 ? "No timer" : `${minutes} min`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {startedAt !== null ? (
              <View accessible accessibilityLabel={timerLabel} testID="focus-timer-ring" className="mt-2">
                <ProgressRing
                  completed={durationMs - remainingMs}
                  total={durationMs}
                  color={finished ? colors.success : colors.primary}
                  size={168}
                  strokeWidth={10}
                >
                  {finished ? (
                    <Ionicons name="checkmark" size={48} color={colors.success} testID="focus-timer-check" />
                  ) : (
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
                  )}
                </ProgressRing>
              </View>
            ) : null}

            {finished ? (
              <Text className="text-base text-center text-foreground" testID="focus-times-up">
                {timesUpText(timer)}
              </Text>
            ) : null}
          </View>
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
