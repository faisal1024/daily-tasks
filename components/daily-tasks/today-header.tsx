import { useState } from "react";
import { Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GradientBackground } from "@/components/daily-tasks/gradient-card";
import { Fonts } from "@/constants/theme";
import {
  streakChipLabel,
  streakChipText,
  type TodayProgress,
} from "@/lib/daily-tasks/today-view";

interface TodayHeaderProps {
  greeting: string;
  progress: TodayProgress;
  dayStreak: number;
  level: number;
}

/**
 * Compact header for the Today screen. The three tasks are the hero now, so
 * this only carries the greeting, one streak/level chip, and today's progress.
 */
export function TodayHeader({ greeting, progress, dayStreak, level }: TodayHeaderProps) {
  const insets = useSafeAreaInsets();
  // Live width: correct after iPad rotation, Split View and Stage Manager resizes.
  const screenW = useWindowDimensions().width;
  const [height, setHeight] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  return (
    <View
      onLayout={onLayout}
      className="overflow-hidden"
      style={{ borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
      testID="today-header"
    >
      <GradientBackground width={screenW} height={height || 220} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 22, paddingBottom: 20 }}>
        <View className="flex-row items-center justify-between">
          <Text
            style={{
              flex: 1,
              marginRight: 12,
              color: "rgba(255,255,255,0.92)",
              fontWeight: "700",
              fontSize: 16,
            }}
            numberOfLines={1}
            maxFontSizeMultiplier={1.6}
          >
            {greeting}
          </Text>
          <View
            accessible
            accessibilityLabel={streakChipLabel(dayStreak, level)}
            style={{
              backgroundColor: "rgba(255,255,255,0.20)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.28)",
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 16,
            }}
          >
            <Text
              style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}
              maxFontSizeMultiplier={1.4}
            >
              {streakChipText(dayStreak, level)}
            </Text>
          </View>
        </View>

        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
          style={{
            color: "#fff",
            fontFamily: Fonts.rounded,
            fontWeight: "800",
            fontSize: 30,
            lineHeight: 34,
            marginTop: 14,
          }}
        >
          {progress.headline}
        </Text>

        <View className="flex-row items-center gap-3 mt-3">
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Today's progress"
            // Spoken as "0 of 1 done · 2 open" rather than a bare percentage.
            accessibilityValue={{ text: progress.spokenLabel }}
            style={{
              flex: 1,
              height: 10,
              borderRadius: 99,
              backgroundColor: "rgba(255,255,255,0.25)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${progress.ratio * 100}%`,
                borderRadius: 99,
                backgroundColor: "#FFD37A",
              }}
            />
          </View>
          <Text
            style={{ color: "#fff", fontWeight: "800", fontSize: 14, flexShrink: 1 }}
            maxFontSizeMultiplier={1.4}
            importantForAccessibility="no"
            accessibilityElementsHidden
          >
            {progress.label}
          </Text>
        </View>
      </View>
    </View>
  );
}
