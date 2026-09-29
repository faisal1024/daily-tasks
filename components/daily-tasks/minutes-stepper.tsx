// Focus mode's custom timer length where there's no native duration wheel
// (Android and the web): minutes in steps of 5, within 1–180.
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import {
  FOCUS_TIMER_MAX_MINUTES,
  FOCUS_TIMER_MIN_MINUTES,
  durationShort,
  durationWords,
} from "@/lib/daily-tasks/focus-timer";

const STEP = 5;

export function MinutesStepper({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const colors = useColors();
  // Snap to multiples of 5, with 1 minute below 5.
  const down = minutes <= STEP ? FOCUS_TIMER_MIN_MINUTES : Math.ceil(minutes / STEP) * STEP - STEP;
  const up = minutes < STEP ? STEP : Math.floor(minutes / STEP) * STEP + STEP;
  const canDown = minutes > FOCUS_TIMER_MIN_MINUTES;
  const canUp = minutes < FOCUS_TIMER_MAX_MINUTES;
  const button = (icon: "remove" | "add", label: string, enabled: boolean, next: number, testID: string) => (
    <Pressable
      onPress={() => onChange(Math.min(FOCUS_TIMER_MAX_MINUTES, next))}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: enabled ? 1 : 0.4,
      }}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={colors.foreground} />
    </Pressable>
  );
  return (
    <View className="flex-row items-center justify-between gap-3" testID="focus-timer-stepper">
      {button("remove", "Shorter timer", canDown, down, "focus-timer-stepper-down")}
      <Text
        className="flex-1 text-center text-lg font-semibold text-foreground"
        accessibilityLabel={`Timer length, ${durationWords(minutes)}`}
        accessibilityLiveRegion="polite"
        testID="focus-timer-stepper-value"
      >
        {durationShort(minutes)}
      </Text>
      {button("add", "Longer timer", canUp, up, "focus-timer-stepper-up")}
    </View>
  );
}
