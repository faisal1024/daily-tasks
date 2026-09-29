// The end check-in (1.3): when a focus session reaches zero it asks what's
// next instead of stopping dead. A timer: 5 more minutes / Take a break, then
// the quiet links "Stuck? Break it down · ✓ Mark task done". A starter: Keep
// going / Take a break, and "✓ Mark task done". Extend is always the lead
// (solid, on the left), as on the Live Activity, the Dynamic Island and the
// notification. A timer session is often just the first sitting, so ending
// it never ticks the task: Take a break ends the session with the task still
// open, and only "Mark task done" ticks it. Shown under the task's row on
// Today and on the focus screen (which, at time's up, has no other way out).
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { ThemeColorPalette } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { checkInTitle, KEEP_GOING_MINUTES, type FocusSession } from "@/lib/daily-tasks/focus-session";

/** What the timer views can do to the session (Today wires them to the store). */
export interface FocusSessionControls {
  /** Pause / Resume: false when there was nothing to pause or resume. */
  pause: () => boolean | void;
  resume: () => boolean | void;
  /** Stop timer: clears the session (the task stays open). */
  stop: () => void;
  /** Take a break (time's up): ends the session; the task stays open. */
  takeBreak: () => void;
  /** 5 more minutes. */
  extend: () => void;
  /** A starter's Keep going (a 20-minute timer). */
  keepGoing: () => void;
  /** "Mark task done": ticks the task the normal way. */
  done: () => void;
  /** Stuck? Break it down: only when a break-down is possible. */
  breakDown?: () => void;
}

/**
 * The timer's pill buttons (check-in, focus screen): a solid primary fill
 * (text in colors.onPrimary), a primary tint (text in colors.primaryInk,
 * AA on the tint), or the plain surface.
 */
export function focusPillStyle(colors: ThemeColorPalette, fill: "primary" | "tint" | "surface", minHeight = 44) {
  return {
    flex: 1,
    minHeight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 999,
    ...(fill === "primary"
      ? { backgroundColor: colors.primary }
      : fill === "tint"
        ? { backgroundColor: `${colors.primary}1F` }
        : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }),
  };
}

export function FocusCheckIn({
  session,
  controls,
  showTitle = true,
}: {
  session: FocusSession;
  controls: FocusSessionControls;
  showTitle?: boolean;
}) {
  const colors = useColors();
  const starter = session.kind === "starter";

  const pill = (fill: "primary" | "tint", label: string, onPress: () => void, testID: string, hint?: string) => (
    <Pressable
      key={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => ({ ...focusPillStyle(colors, fill), opacity: pressed ? 0.85 : 1 })}
      testID={testID}
    >
      <Text
        className="text-sm font-bold"
        style={{ color: fill === "primary" ? colors.onPrimary : colors.primaryInk }}
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </Text>
    </Pressable>
  );

  const lead = starter
    ? pill(
        "primary",
        "Keep going",
        controls.keepGoing,
        "focus-check-in-keep-going",
        `Starts a ${KEEP_GOING_MINUTES}-minute timer`,
      )
    : pill("primary", "5 more minutes", controls.extend, "focus-check-in-extend", "Adds 5 minutes to the timer");
  const breakDown = !starter && controls.breakDown ? controls.breakDown : null;

  return (
    <View className="gap-2 self-stretch" testID="focus-check-in">
      {showTitle ? (
        <Text className="text-base font-semibold text-foreground" testID="focus-check-in-title">
          {checkInTitle(session)}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        {lead}
        {pill("tint", "Take a break", controls.takeBreak, "focus-check-in-break", "Ends the timer. The task stays open.")}
      </View>
      {/* "Stuck? Break it down · ✓ Mark task done", left-aligned under the
          buttons; wraps at large text sizes rather than squeezing. */}
      <View
        className="flex-row items-center"
        style={{ flexWrap: "wrap", columnGap: 8 }}
        testID="focus-check-in-links"
      >
        {breakDown ? (
          <>
            <QuietLink
              label="Stuck? Break it down"
              onPress={breakDown}
              testID="focus-check-in-break-down"
              hint="Splits this task into a few tiny steps"
            />
            <Text
              className="text-sm"
              style={{ color: colors.muted }}
              accessibilityElementsHidden
              importantForAccessibility="no"
              testID="focus-check-in-links-dot"
            >
              ·
            </Text>
          </>
        ) : null}
        <MarkTaskDoneLink taskText={session.taskText} onPress={controls.done} testID="focus-check-in-done" />
      </View>
    </View>
  );
}

/** A quiet (muted) text link, 44pt tall. */
function QuietLink({
  label,
  onPress,
  testID,
  hint,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  hint?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={{ minHeight: 44, justifyContent: "center", flexShrink: 1 }}
      testID={testID}
    >
      <Text className="text-sm font-semibold" style={{ color: colors.muted, flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "✓ Mark task done": the only thing on the timer's views that ticks the
 * task (through the normal path). A quiet link, never a button that could be
 * mistaken for "I'm finished with this timer".
 */
export function MarkTaskDoneLink({
  taskText,
  onPress,
  testID,
  align = "flex-start",
}: {
  taskText: string;
  onPress: () => void;
  testID: string;
  align?: "flex-start" | "center";
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Mark task done"
      accessibilityHint={`Ticks off ${taskText}`}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        alignSelf: align,
        gap: 4,
        flexShrink: 1,
        opacity: pressed ? 0.6 : 1,
      })}
      testID={testID}
    >
      <Ionicons name="checkmark" size={16} color={colors.primaryInk} />
      <Text className="text-sm font-semibold" style={{ color: colors.primaryInk, flexShrink: 1 }}>
        Mark task done
      </Text>
    </Pressable>
  );
}
