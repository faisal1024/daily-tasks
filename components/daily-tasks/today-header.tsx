import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { dayChipLabel, dayChipText, type TodayProgress } from "@/lib/daily-tasks/today-view";

interface TodayHeaderProps {
  /** e.g. "Sunday, 27 September". */
  dateLabel: string;
  progress: TodayProgress;
  /** Days with a plan, today included ("Day N"). */
  daysShowedUp: number;
}

/**
 * A plain large-title header: "Today", the date, one "Day N" chip and a thin
 * progress line. No gradient: the card of three is the hero, and the one
 * gradient in the app is saved for the finished day.
 */
export function TodayHeader({ dateLabel, progress, daysShowedUp }: TodayHeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 4 }} testID="today-header">
      <View className="flex-row items-end justify-between gap-3">
        <Text
          accessibilityRole="header"
          style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "800", fontSize: 34, lineHeight: 40 }}
          maxFontSizeMultiplier={1.4}
        >
          Today
        </Text>
        <View
          accessible
          accessibilityLabel={dayChipLabel(daysShowedUp)}
          className="rounded-full px-3 py-1 mb-1.5"
          style={{ backgroundColor: `${colors.primary}14` }}
        >
          <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 13 }} maxFontSizeMultiplier={1.4}>
            {dayChipText(daysShowedUp)}
          </Text>
        </View>
      </View>
      <Text className="text-base mt-0.5" style={{ color: colors.muted }} maxFontSizeMultiplier={1.6}>
        {dateLabel}
        {progress.total > 0 ? ` · ${progress.label}` : ""}
      </Text>
      {progress.total > 0 ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Today's progress"
          accessibilityValue={{ text: progress.spokenLabel }}
          className="mt-3 rounded-full overflow-hidden"
          style={{ height: 4, backgroundColor: colors.border }}
        >
          <View
            style={{
              height: "100%",
              width: `${progress.ratio * 100}%`,
              borderRadius: 99,
              // The accent is saved for "done".
              backgroundColor: colors.success,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
