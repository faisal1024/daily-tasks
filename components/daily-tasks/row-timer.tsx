// The day's one timer, on its task's row (1.3, "one timer, on the task"):
// the pill (ring with ⏸/▶ and the time left; tap to pause or resume), the
// muted line under the task's words, and at zero the check-in under the row.
import { PixelRatio, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { FocusCheckIn, type FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { useColors } from "@/hooks/use-colors";
import { useFocusClock } from "@/hooks/use-focus-clock";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import {
  checkInTitle,
  MINUTE_MS,
  remainingMs,
  sessionPhase,
  starterLine,
  type FocusSession,
  type FocusSessionStatus,
} from "@/lib/daily-tasks/focus-session";
import { durationWords, formatRemaining } from "@/lib/daily-tasks/focus-timer";

/**
 * Pause or resume the timer, felt (a selection haptic) and said ("Paused" /
 * "Resumed") only when it changed: the pill, and the timed row's menu.
 */
export function toggleTimer(controls: FocusSessionControls, action: "pause" | "resume"): void {
  const changed = action === "pause" ? controls.pause() : controls.resume();
  if (changed === false) return;
  if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
  announcePolitely(action === "pause" ? "Paused" : "Resumed");
}

/** Where the timed row's session is, read from one clock for the whole row. */
export interface RowSessionClock {
  session: FocusSession;
  phase: FocusSessionStatus;
  /** Ms left in the current countdown. */
  left: number;
}

/**
 * The timed row's one clock: its pill, line and check-in all read this, so
 * they never disagree (e.g. the pill at 0:00 while the check-in isn't up).
 * Ticks each second only while the session runs; a row without one never does.
 */
export function useRowSessionClock(session: FocusSession | null): RowSessionClock | null {
  const now = useFocusClock(session);
  if (!session) return null;
  return { session, phase: sessionPhase(session, now), left: remainingMs(session, now) };
}

const PILL_HEIGHT = 30;
/** The pill's least width at the default text size; it grows with Dynamic Type (to 1.3×). */
const PILL_MIN_WIDTH = 44;
/** Below this window width the pill is the ring alone (the words need the room). */
const NARROW_WIDTH = 360;
/** Tabular digits at text-sm, for a width that doesn't reflow as it ticks. */
const DIGIT_WIDTH = 8.5;
const COLON_WIDTH = 4;

/** The width of the time text at its longest (the countdown's full length). */
function timeWidth(durationMs: number): number {
  const full = formatRemaining(durationMs);
  const colons = full.split(":").length - 1;
  return (full.length - colons) * DIGIT_WIDTH + colons * COLON_WIDTH;
}

/**
 * The pill: a small ring (⏸ inside while running, ▶ while paused) and the
 * time left. Tapping it pauses or resumes; at time's up it's the full ring
 * with a bell (no outline) and opens the focus screen. No taller than the row's circle, so the row never
 * grows; its 44pt target comes from the hit slop.
 */
export function RowTimerPill({
  clock,
  taskText,
  controls,
  onOpen,
}: {
  clock: RowSessionClock;
  taskText: string;
  controls: FocusSessionControls;
  /** Opens the focus screen (the pill at time's up). */
  onOpen?: () => void;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { session, phase, left } = clock;
  const paused = phase === "paused";
  const ended = phase === "ended";
  const ringOnly = ended || width < NARROW_WIDTH;
  const pill = {
    height: PILL_HEIGHT,
    minWidth: Math.round(PILL_MIN_WIDTH * Math.min(PixelRatio.getFontScale(), 1.3)),
    // In line with the ▶ it replaces.
    marginRight: -8,
    paddingLeft: 4,
    paddingRight: ringOnly ? 4 : 10,
    borderRadius: PILL_HEIGHT / 2,
    // An outline on the row's own surface (no fill), so the time's contrast
    // is the surface's; paused, it goes quiet with the ring. At time's up
    // it's just the ring and bell (no outline).
    borderWidth: ended ? 0 : 1,
    borderColor: paused ? colors.muted : colors.primary,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  };

  if (ended) {
    return (
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Time's up: ${taskText}`}
        accessibilityHint="Opens focus"
        hitSlop={{ top: 7, bottom: 7 }}
        style={({ pressed }) => ({ ...pill, opacity: pressed ? 0.7 : 1 })}
        testID={`task-timer-running-${session.taskId}`}
      >
        {/* Time's up, not done: a bell on the full ring, never a green tick. */}
        <ProgressRing completed={session.durationMs} total={session.durationMs} color={colors.primary} size={22} strokeWidth={2.5}>
          <Ionicons
            name="notifications-outline"
            size={11}
            color={colors.primary}
            accessible={false}
            testID={`task-timer-times-up-${session.taskId}`}
          />
        </ProgressRing>
      </Pressable>
    );
  }

  // One element, said once: "Timer, 12 minutes left" (whole minutes, so
  // VoiceOver isn't told every second), then "Double-tap to pause". The state
  // is in the label only (no value repeating it), the task isn't (the row's
  // checkbox just said it), and the glyph and digits inside are never elements
  // of their own, so nothing in the pill is read a second time.
  const label = `Timer${paused ? " paused" : ""}, ${durationWords(Math.ceil(left / MINUTE_MS))} left`;
  const toggle = () => toggleTimer(controls, paused ? "resume" : "pause");
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={paused ? "Double-tap to resume" : "Double-tap to pause"}
      hitSlop={{ top: 7, bottom: 7 }}
      style={({ pressed }) => ({ ...pill, opacity: pressed ? 0.7 : 1 })}
      testID={`task-timer-running-${session.taskId}`}
    >
      {/* The ring drains (what's left), like Clock and the Live Activity.
          Paused: it goes quiet and the glyph offers ▶. */}
      <ProgressRing
        completed={left}
        total={session.durationMs}
        color={paused ? colors.muted : colors.primary}
        size={22}
        strokeWidth={2.5}
      >
        {/* The glyph and the digits are a Text each, which iOS makes an
            element of its own: never one here (the pill's label says it). */}
        <Ionicons
          name={paused ? "play" : "pause"}
          size={11}
          color={colors.primary}
          accessible={false}
          testID={`task-timer-${paused ? "play" : "pause"}-${session.taskId}`}
        />
      </ProgressRing>
      {ringOnly ? null : (
        <Text
          className="text-sm font-semibold"
          style={{
            color: paused ? colors.muted : colors.primary,
            fontVariant: ["tabular-nums"],
            minWidth: timeWidth(session.durationMs),
          }}
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          accessible={false}
          testID={`task-timer-left-${session.taskId}`}
        >
          {formatRemaining(left)}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The muted lines under the timed task's words: the step it's on (a starter
 * after "Stuck?", kept at time's up) and, until then, a 5-minute starter's
 * "Just start" line, or just "Paused." while paused.
 */
export function RowSessionLine({ clock }: { clock: RowSessionClock }) {
  const colors = useColors();
  const { session, phase } = clock;
  const step = session.stepText ? `Now: ${session.stepText}` : null;
  const status = phase === "ended" ? null : phase === "paused" ? "Paused." : starterLine(session);
  if (!step && !status) return null;
  return (
    <View testID={`task-session-line-${session.taskId}`}>
      {step ? (
        <Text className="text-sm" style={{ color: colors.muted }}>
          {step}
        </Text>
      ) : null}
      {status ? (
        <Text
          className="text-sm"
          style={{ color: colors.muted }}
          // "Paused." is the pill's own "Timer paused, …": VoiceOver says it there, once.
          accessibilityElementsHidden={phase === "paused"}
          importantForAccessibility={phase === "paused" ? "no-hide-descendants" : "auto"}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
}

/** At zero, the check-in under its task's row (in line with the words; no card of its own). */
export function RowCheckIn({
  clock,
  controls,
  inset,
}: {
  clock: RowSessionClock;
  controls: FocusSessionControls;
  /** The words' left edge in the row. */
  inset: number;
}) {
  const colors = useColors();
  const { session, phase } = clock;
  if (phase !== "ended") return null;
  return (
    <View style={{ marginLeft: inset, marginTop: 10, gap: 8 }} testID={`task-check-in-${session.taskId}`}>
      <Text className="text-sm font-semibold" style={{ color: colors.foreground }} testID="task-check-in-title">
        {session.kind === "starter" || session.stepText ? checkInTitle(session) : "Time's up."}
      </Text>
      <FocusCheckIn session={session} controls={controls} showTitle={false} />
    </View>
  );
}
