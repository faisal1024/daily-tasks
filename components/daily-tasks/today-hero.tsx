import { useState } from "react";
import { Dimensions, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { GradientBackground } from "@/components/daily-tasks/gradient-card";
import { Fonts } from "@/constants/theme";
import { MAX_TASKS } from "@/lib/daily-tasks/types";

interface TodayHeroProps {
  greeting: string;
  completed: number;
  total: number;
  dayStreak: number;
  level: number;
  stageLabel: string;
  stageGlyph: string;
  xpRatio: number;
  xpRemaining: number;
}

const RING = 150;
const STROKE = 14;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;

export function TodayHero({
  greeting,
  completed,
  total,
  dayStreak,
  level,
  stageLabel,
  stageGlyph,
  xpRatio,
  xpRemaining,
}: TodayHeroProps) {
  const insets = useSafeAreaInsets();
  const screenW = Dimensions.get("window").width;
  const [heroHeight, setHeroHeight] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setHeroHeight(e.nativeEvent.layout.height);
  const safeTotal = Math.max(total, 3);
  const ratio = Math.min(Math.max(completed / safeTotal, 0), 1);
  const isDone = total > 0 && completed === total;
  const headline = isDone
    ? "Perfect day!"
    : completed === 0
      ? "Let's go!"
      : "Almost there!";
  const subcopy = isDone
    ? "Three for three. Beautifully done. 🎉"
    : completed === 0
      ? "Pick today's three and start strong. ✨"
      : `${total - completed} more to a perfect day 💪`;

  return (
    <View
      onLayout={onLayout}
      className="overflow-hidden"
      style={{ borderBottomLeftRadius: 36, borderBottomRightRadius: 36 }}
    >
      <GradientBackground width={screenW} height={heroHeight || 520} />

      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 22, paddingBottom: 26 }}>
        {/* Top row */}
        <View className="flex-row items-center justify-between">
          <Text
            style={{ color: "rgba(255,255,255,0.9)", fontWeight: "700", fontSize: 16 }}
          >
            {greeting}
          </Text>
          <View className="flex-row gap-2">
            <Chip>🔥 {dayStreak}</Chip>
            <Chip>⭐ Lv {level}</Chip>
          </View>
        </View>

        {/* Ring + headline */}
        <View className="flex-row items-center gap-4 mt-4">
          <View style={{ width: RING, height: RING }}>
            <Svg width={RING} height={RING}>
              <Circle
                cx={RING / 2}
                cy={RING / 2}
                r={R}
                stroke="rgba(255,255,255,0.28)"
                strokeWidth={STROKE}
                fill="none"
              />
              <Circle
                cx={RING / 2}
                cy={RING / 2}
                r={R}
                stroke="#FFFFFF"
                strokeWidth={STROKE}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${C} ${C}`}
                strokeDashoffset={C * (1 - ratio)}
                transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
              />
            </Svg>
            <View className="absolute inset-0 items-center justify-center">
              <Text
                style={{
                  color: "#fff",
                  fontFamily: Fonts.rounded,
                  fontWeight: "800",
                  fontSize: 44,
                }}
              >
                {completed}/{total || MAX_TASKS}
              </Text>
              <Text
                style={{
                  color: "rgba(255,255,255,0.85)",
                  fontSize: 12,
                  letterSpacing: 2,
                  fontWeight: "800",
                  marginTop: 2,
                }}
              >
                TODAY
              </Text>
            </View>
          </View>

          <View className="flex-1">
            <Text
              style={{
                color: "#fff",
                fontFamily: Fonts.rounded,
                fontWeight: "800",
                fontSize: 30,
                lineHeight: 32,
              }}
            >
              {headline}
            </Text>
            <Text
              style={{
                color: "rgba(255,255,255,0.92)",
                fontWeight: "600",
                fontSize: 14,
                marginTop: 6,
              }}
            >
              {subcopy}
            </Text>
          </View>
        </View>

        {/* XP bar */}
        <View className="mt-5">
          <View className="flex-row justify-between mb-1.5">
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>
              Level {level} · {stageLabel} {stageGlyph}
            </Text>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>
              {xpRemaining} XP to Lv {level + 1}
            </Text>
          </View>
          <View
            style={{
              height: 12,
              borderRadius: 99,
              backgroundColor: "rgba(255,255,255,0.22)",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${Math.min(Math.max(xpRatio, 0), 1) * 100}%`,
                borderRadius: 99,
                backgroundColor: "#FFD37A",
              }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "rgba(255,255,255,0.20)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.28)",
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 18,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{children}</Text>
    </View>
  );
}
