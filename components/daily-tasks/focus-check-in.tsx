// The end check-in (1.3): when a focus session reaches zero it asks what's
// next instead of stopping dead. A timer: 5 more minutes / Done / Stuck?
// Break it down (and Stop here). A starter: Keep going / Done / Stop here.
// Extend is always on the left and Done on the right, as on the Live
// Activity, the Dynamic Island and the notification, and extend is the
// lead (solid) one everywhere at time's up: one emphasis rule.
// Shown under the task's row on Today and on the focus screen; it never ticks anything itself.
// On the focus screen the footer's Done is the one solid button, so the
// check-in's buttons are tinted there.
import { Pressable, Text, View } from "react-native";

import type { ThemeColorPalette } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { checkInTitle, KEEP_GOING_MINUTES, type FocusSession } from "@/lib/daily-tasks/focus-session";

/** What the timer views can do to the session (Today wires them to the store). */
export interface FocusSessionControls {
  /** Pause / Resume: false when there was nothing to pause or resume. */
  pause: () => boolean | void;
  resume: () => boolean | void;
  /** Stop timer, Stop here: clears the session. */
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
  showDone = true,
  showTitle = true,
}: {
  session: FocusSession;
  controls: FocusSessionControls;
  /** The focus screen has its own Done below (and it's the one solid button). */
  showDone?: boolean;
  showTitle?: boolean;
}) {
  const colors = useColors();
  const starter = session.kind === "starter";
  // The lead choice is solid only where there's no other solid Done.
  const lead = showDone ? "primary" : "tint";

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

  const link = (label: string, onPress: () => void, testID: string, hint?: string) => (
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

  const primaryRow = starter
    ? [
        pill(
          lead,
          "Keep going",
          controls.keepGoing,
          "focus-check-in-keep-going",
          `Starts a ${KEEP_GOING_MINUTES}-minute timer`,
        ),
        showDone ? pill("tint", "Done", controls.done, "focus-check-in-done", "Marks this task done") : null,
      ]
    : [
        pill(lead, "5 more minutes", controls.extend, "focus-check-in-extend", "Adds 5 minutes to the timer"),
        showDone ? pill("tint", "Done", controls.done, "focus-check-in-done", "Marks this task done") : null,
      ];
  const breakDown = !starter && controls.breakDown ? controls.breakDown : null;

  return (
    <View className="gap-2 self-stretch" testID="focus-check-in">
      {showTitle ? (
        <Text className="text-base font-semibold text-foreground" testID="focus-check-in-title">
          {checkInTitle(session)}
        </Text>
      ) : null}
      <View className="flex-row gap-2">{primaryRow}</View>
      {/* Wraps at large text sizes rather than squeezing. Alone, Stop here
          sits under the first button (left), not off at the far edge. */}
      <View
        className="flex-row items-center"
        style={{ flexWrap: "wrap", columnGap: 12, justifyContent: breakDown ? "space-between" : "flex-start" }}
        testID="focus-check-in-links"
      >
        {breakDown
          ? link("Stuck? Break it down", breakDown, "focus-check-in-break-down", "Splits this task into a few tiny steps")
          : null}
        {link("Stop here", controls.stop, "focus-check-in-stop", "Clears the timer")}
      </View>
    </View>
  );
}
