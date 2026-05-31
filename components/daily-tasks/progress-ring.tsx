import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useColors } from "@/hooks/use-colors";

interface ProgressRingProps {
  completed: number;
  total: number;
  size?: number;
  strokeWidth?: number;
}

export function ProgressRing({
  completed,
  total,
  size = 156,
  strokeWidth = 14,
}: ProgressRingProps) {
  const colors = useColors();
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(completed / safeTotal, 0), 1);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);

  const accent =
    ratio >= 1 ? colors.success : ratio > 0 ? colors.primary : colors.muted;

  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center"
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accent}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View className="absolute items-center justify-center">
        <Text className="text-5xl font-extrabold text-foreground">
          {completed}/{total || 0}
        </Text>
        <Text className="text-sm text-muted mt-1 uppercase tracking-wide">focuses</Text>
      </View>
    </View>
  );
}
