import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useColors } from "@/hooks/use-colors";

interface ProgressRingProps {
  completed: number;
  total: number;
  /** The filled arc's colour. */
  color: string;
  size?: number;
  strokeWidth?: number;
  /** What sits in the middle (e.g. focus mode's timer). */
  children?: ReactNode;
}

export function ProgressRing({
  completed,
  total,
  color,
  size = 156,
  strokeWidth = 14,
  children,
}: ProgressRingProps) {
  const colors = useColors();
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(completed / safeTotal, 0), 1);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);

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
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View className="absolute items-center justify-center">{children}</View>
    </View>
  );
}
