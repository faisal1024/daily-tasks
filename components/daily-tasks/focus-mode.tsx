// "Start" focus mode (1.2): one task, full screen, with its steps and its
// timer. Since 1.3 it's the detail view of the focus session: the timer is
// the store's, so closing this doesn't stop it. Nothing here ticks the task
// unless it says so: "✓ Mark task done" ticks it through Today's normal toggle
// path; Back to Today and Take a break leave it open (a timer session is
// often just the first sitting). One way off the page at a time: Back to
// Today, or Take a break at time's up.
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FocusCheckIn, MarkTaskDoneLink, type FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { FocusTimerPanel } from "@/components/daily-tasks/focus-timer-panel";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSessionEnded } from "@/hooks/use-focus-clock";
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
   * "✓ Mark task done": ticks the task the normal way (once); the screen
   * closes focus mode.
   * `timer` is the session's length in minutes, 0 for none.
   */
  onDone: (timer: number) => void;
  /** Back to Today (and after Take a break): closes; a running timer keeps going. */
  onClose: () => void;
  /** A length was chosen here, in minutes (1–180): starts a session on this task. */
  onStartTimer: (minutes: number) => void;
  controls: FocusSessionControls;
  /** Opens with the custom length wheel showing. */
  initialCustom?: boolean;
  /** The task another session is on (a start here stops it), if any. */
  otherTimerText?: string | null;
}

/**
 * Mounted only while open (see Today). Full screen on iPhone. One way out at
 * a time: Back to Today (the timer keeps going), or at time's up the
 * check-in's Take a break (ends the session). "✓ Mark task done" ticks the
 * task and closes.
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
  otherTimerText = null,
}: FocusModeProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animation = useSheetAnimation();
  const fullScreen = Platform.OS === "ios" && !Platform.isPad;
  // At time's up the check-in's Take a break is the way out (never both).
  const timesUp = useSessionEnded(session);
  const timerActive = session !== null && !timesUp;
  // The custom wheel waits until the sheet has finished sliding in: its
  // first-spin fix (see CountdownWheel) only works once it's on screen.
  const [shown, setShown] = useState(false);
  // While the custom wheel shows, its Start is the one solid button and Back
  // to Today steps back to a tint.
  const [customOpen, setCustomOpen] = useState(false);

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
  // At time's up the check-in (under the ring) is what matters: bring it in.
  useEffect(() => {
    // Only when time's up comes (revealTimer only touches refs).
    if (timesUp) revealTimer();
  }, [timesUp]);

  // A double tap on Mark task done must tick it only once.
  const doneRef = useRef(false);
  const done = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(session ? sessionMinutes(session) : 0);
  };
  // The check-in here: its Mark task done is the screen's (closes, reports
  // the length), and Take a break ends the session and goes back to Today.
  const checkInControls: FocusSessionControls = {
    ...controls,
    done,
    takeBreak: () => {
      controls.takeBreak();
      onClose();
    },
  };

  const steps = task.steps ?? [];
  const allStepsDone = steps.length > 0 && steps.every((step) => step.done);

  return (
    <Modal
      visible
      onRequestClose={onClose}
      animationType={animation}
      presentationStyle={fullScreen ? "fullScreen" : "pageSheet"}
      onShow={() => setShown(true)}
      testID="focus-modal"
    >
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        accessibilityViewIsModal
        // VoiceOver's escape (two-finger Z): the screen's one way out, Back
        // to Today, or at time's up Take a break.
        onAccessibilityEscape={timesUp ? checkInControls.takeBreak : onClose}
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
            // So a running timer's ring can sit in the middle of the space
            // left, not high up with a gap under it.
            flexGrow: 1,
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

          <View style={session ? { flexGrow: 1, justifyContent: "center" } : undefined} testID="focus-timer-block">
            <FocusTimerPanel
              session={session}
              onStart={onStartTimer}
              controls={controls}
              openCustom={initialCustom && shown}
              otherTimerText={session ? null : otherTimerText}
              onReveal={revealTimer}
              onCustomOpenChange={setCustomOpen}
              checkIn={
                session ? <FocusCheckIn session={session} controls={checkInControls} focusTitle /> : null
              }
            />
          </View>
        </ScrollView>

        <View className="px-6 pt-3 gap-2" style={{ paddingBottom: insets.bottom + 16 }}>
          {allStepsDone ? (
            <Text className="text-sm text-center" style={{ color: colors.muted }} testID="focus-steps-done">
              All steps done.
            </Text>
          ) : null}
          {timesUp ? null : (
            <>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Back to Today"
                accessibilityHint={timerActive ? "The timer keeps going" : "Closes focus mode"}
                style={({ pressed }) => ({
                  minHeight: 52,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                  backgroundColor: customOpen ? `${colors.primary}1F` : colors.primary,
                  opacity: pressed ? 0.85 : 1,
                })}
                testID="focus-close"
              >
                <Text
                  className="text-base font-bold"
                  style={{ color: customOpen ? colors.primaryInk : colors.onPrimary }}
                >
                  Back to Today
                </Text>
              </Pressable>
              <MarkTaskDoneLink taskText={task.text} onPress={done} testID="focus-done" align="center" />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
