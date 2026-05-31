import { Dimensions, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { Fonts } from "@/constants/theme";

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
      className="overflow-hidden"
      style={{ borderBottomLeftRadius: 36, borderBottomRightRadius: 36 }}
    >
      <Svg
        width={screenW}
        height={520}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <Defs>
          <SvgLinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#6C63FF" />
            <Stop offset="0.55" stopColor="#8B82FF" />
            <Stop offset="1" stopColor="#A78BFF" />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width={screenW} height={520} fill="url(#hero)" />
      </Svg>

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
                {completed}/{total || 0}
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
            <Text style={{ color: "rgba(255,255,255,0.92)", fontWeight: "800", fontSize: 12 }}>
              Level {level} · {stageLabel} {stageGlyph}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.92)", fontWeight: "800", fontSize: 12 }}>
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
