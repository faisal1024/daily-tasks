// The end check-in (1.3): when a focus session reaches zero it asks what's
// next instead of stopping dead. A timer: Done / 5 more minutes / Stuck?
// Break it down (and Not now). A starter: Keep going / Done / Stop here.
// Shown in the Now bar and on the focus screen; it never ticks anything itself.
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { checkInTitle, KEEP_GOING_MINUTES, type FocusSession } from "@/lib/daily-tasks/focus-session";
import { durationWords } from "@/lib/daily-tasks/focus-timer";

/** What the timer views can do to the session (Today wires them to the store). */
export interface FocusSessionControls {
  pause: () => void;
  resume: () => void;
  /** Stop timer, Not now, Stop here: clears the session. */
  stop: () => void;
  /** 5 more minutes. */
  extend: () => void;
  /** A starter's Keep going (a 20-minute timer). */
  keepGoing: () => void;
  /** Ticks the task the normal way. */
  done: () => void;
  /** Stuck? Break it down: only when a break-down is possible. */
  breakDown?: () => void;
}

/** Read out after the button's own label, and without cutting anything off. */
export function announcePolitely(text: string): void {
  if (Platform.OS === "ios" && typeof AccessibilityInfo.announceForAccessibilityWithOptions === "function") {
    AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
    return;
  }
  AccessibilityInfo.announceForAccessibility(text);
}

export function FocusCheckIn({
  session,
  controls,
  showDone = true,
  showTitle = true,
}: {
  session: FocusSession;
  controls: FocusSessionControls;
  /** The focus screen has its own Done below. */
  showDone?: boolean;
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
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        backgroundColor: fill === "primary" ? colors.primary : `${colors.primary}1F`,
        opacity: pressed ? 0.85 : 1,
      })}
      testID={testID}
    >
      <Text
        className="text-sm font-bold"
        style={{ color: fill === "primary" ? colors.onPrimary : colors.primary }}
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </Text>
    </Pressable>
  );

  const link = (label: string, onPress: () => void, testID: string, hint?: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={{ minHeight: 44, justifyContent: "center" }}
      testID={testID}
    >
      <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
        {label}
      </Text>
    </Pressable>
  );

  const primaryRow = starter
    ? [
        pill(
          "primary",
          "Keep going",
          controls.keepGoing,
          "focus-check-in-keep-going",
          `Starts a ${durationWords(KEEP_GOING_MINUTES)} timer`,
        ),
        showDone ? pill("tint", "Done", controls.done, "focus-check-in-done", "Marks this task done") : null,
      ]
    : [
        showDone ? pill("primary", "Done", controls.done, "focus-check-in-done", "Marks this task done") : null,
        pill(showDone ? "tint" : "primary", "5 more minutes", controls.extend, "focus-check-in-extend"),
      ];

  return (
    <View className="gap-2 self-stretch" testID="focus-check-in">
      {showTitle ? (
        <Text className="text-base font-semibold text-foreground" testID="focus-check-in-title">
          {checkInTitle(session)}
        </Text>
      ) : null}
      <View className="flex-row gap-2">{primaryRow}</View>
      <View className="flex-row items-center justify-between gap-3">
        {!starter && controls.breakDown
          ? link("Stuck? Break it down", controls.breakDown, "focus-check-in-break-down", "Splits this task into a few tiny steps")
          : <View />}
        {starter
          ? link("Stop here", controls.stop, "focus-check-in-stop", "Clears the timer")
          : link("Not now", controls.stop, "focus-check-in-not-now", "Clears the timer")}
      </View>
    </View>
  );
}
