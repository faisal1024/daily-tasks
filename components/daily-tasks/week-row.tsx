import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { weekRowLabel, type WeekSummary } from "@/lib/daily-tasks/today-phase";
import { dayChipText } from "@/lib/daily-tasks/today-view";

const DOT = 12;

/**
 * "This week": seven quiet dots (filled on days you showed up) and "Day N".
 * Days without a plan are just faint, never red; today is a ring until it
 * counts. Tapping opens Progress.
 */
export function WeekRow({
  summary,
  daysShowedUp,
  onPress,
}: {
  summary: WeekSummary;
  daysShowedUp: number;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={weekRowLabel(summary.showedUpDays, daysShowedUp)}
      className="flex-row items-center gap-3 rounded-3xl border px-4 py-3"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      testID="week-row"
    >
      <View
        className="flex-1 flex-row items-center justify-between"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {summary.days.map((day) => (
          <View key={day.date} className="items-center gap-1.5" testID={`week-dot-${day.date}`}>
            <View
              style={{
                width: DOT,
                height: DOT,
                borderRadius: DOT / 2,
                // Today: an outline ring until it counts. Other days: filled, or faint.
                backgroundColor: day.filled ? colors.primary : day.isToday ? "transparent" : colors.border,
                borderWidth: day.isToday && !day.filled ? 2 : 0,
                borderColor: colors.primary,
              }}
            />
            <Text
              className="text-xs"
              style={{
                color: day.isToday ? colors.primary : colors.muted,
                fontWeight: day.isToday ? "800" : "600",
              }}
              maxFontSizeMultiplier={1.4}
            >
              {day.letter}
            </Text>
          </View>
        ))}
      </View>
      <View
        className="flex-row items-center gap-1"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 15 }}
          maxFontSizeMultiplier={1.4}
        >
          {dayChipText(daysShowedUp)}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </View>
    </Pressable>
  );
}
