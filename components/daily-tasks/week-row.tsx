import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { weekRowLabel, type WeekSummary } from "@/lib/daily-tasks/today-phase";
import { dayChipText } from "@/lib/daily-tasks/today-view";

const DOT = 12;
/** Today's halo: a 1.5pt ring around its dot, with a hairline gap. */
const HALO = 1.5;
const HALO_GAP = 1.5;

/**
 * "This week": seven quiet dots (filled on days you showed up) and "Day N".
 * Days without a plan are hollow rings, never red; today is marked on the dot
 * itself, and its dot is a ring until it counts. Tapping opens Progress.
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
      accessibilityHint="Opens Progress"
      // All inline (no className): a style function needs the full style.
      style={({ pressed }) => ({
        gap: 10,
        borderRadius: 24,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.7 : 1,
      })}
      testID="week-row"
    >
      <View
        className="flex-row items-center justify-between"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text className="text-xs font-semibold" style={{ color: colors.muted }} maxFontSizeMultiplier={1.4}>
          This week
        </Text>
        <View className="flex-row items-center gap-0.5">
          <Text
            style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 15 }}
            maxFontSizeMultiplier={1.4}
          >
            {dayChipText(daysShowedUp)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </View>
      </View>
      <View
        className="flex-row items-center justify-between"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {summary.days.map((day) => {
          const ring = !day.filled;
          const dot = (
            <View
              style={{
                width: DOT,
                height: DOT,
                borderRadius: DOT / 2,
                backgroundColor: day.filled ? colors.primary : "transparent",
                // No plan: a hollow ring, so it still reads as a day. Today's
                // ring is primary until it counts.
                borderWidth: ring ? (day.isToday ? 2 : 1.5) : 0,
                borderColor: day.isToday ? colors.primary : `${colors.muted}73`,
              }}
            />
          );
          const outer = DOT + 2 * (HALO + HALO_GAP);
          return (
            <View key={day.date} className="items-center gap-1.5" testID={`week-dot-${day.date}`}>
              <View style={{ width: outer, height: outer, alignItems: "center", justifyContent: "center" }}>
                {day.isToday && day.filled ? (
                  <View
                    style={{
                      width: outer,
                      height: outer,
                      borderRadius: outer / 2,
                      borderWidth: HALO,
                      borderColor: colors.primary,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {dot}
                  </View>
                ) : (
                  dot
                )}
              </View>
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
          );
        })}
      </View>
    </Pressable>
  );
}
