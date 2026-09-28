import { useState } from "react";
import { View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { useColorScheme } from "@/hooks/use-color-scheme";

import { GRADIENT_DARK, GRADIENT_LIGHT } from "./gradient-stops";

// Re-exported so any gradient surface stays in sync.
export { GRADIENT_DARK, GRADIENT_LIGHT };

let gradientCounter = 0;

interface GradientBackgroundProps {
  /** Measured width to draw (px). */
  width: number;
  /** Measured height to draw (px). */
  height: number;
}

/**
 * Absolutely-positioned scheme-aware gradient fill. Uses measured px (NOT "100%")
 * because react-native-svg does not reliably honor percentage root dimensions on
 * native. Pair with GradientCard or drive width/height via onLayout yourself.
 */
export function GradientBackground({ width, height }: GradientBackgroundProps) {
  const scheme = useColorScheme();
  const stops = scheme === "dark" ? GRADIENT_DARK : GRADIENT_LIGHT;
  // Stable unique id per mount so multiple gradients don't collide.
  const [id] = useState(() => `grad-${(gradientCounter += 1)}`);
  if (width <= 0 || height <= 0) return null;
  return (
    <Svg
      width={width}
      height={height}
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      <Defs>
        <SvgLinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={stops[0]} />
          <Stop offset="0.55" stopColor={stops[1]} />
          <Stop offset="1" stopColor={stops[2]} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

interface GradientCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  className?: string;
}

/**
 * A rounded card with a scheme-aware gradient background that self-measures, so
 * the gradient always fills it (no blank-render risk from percentage sizing).
 */
export function GradientCard({ children, style, className }: GradientCardProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  return (
    <View onLayout={onLayout} className={className} style={[{ overflow: "hidden" }, style]}>
      <GradientBackground width={size.width} height={size.height} />
      {children}
    </View>
  );
}
