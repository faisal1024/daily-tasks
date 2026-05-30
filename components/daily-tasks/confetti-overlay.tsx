import { useEffect, useMemo } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const COLORS = ["#6366F1", "#22C55E", "#F59E0B", "#EC4899", "#06B6D4", "#A855F7"];
const PARTICLE_COUNT = 60;
const DURATION = 3200;

interface ConfettiOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  emoji?: string;
  title?: string;
  subtitle?: string;
}

interface Particle {
  id: number;
  x: number;
  size: number;
  delay: number;
  color: string;
  rotateFrom: number;
  rotateTo: number;
  drift: number;
}

function makeParticles(width: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }).map((_, i) => ({
    id: i,
    x: Math.random() * width,
    size: 6 + Math.random() * 8,
    delay: Math.random() * 800,
    color: COLORS[i % COLORS.length],
    rotateFrom: Math.random() * 360,
    rotateTo: Math.random() * 720 - 360,
    drift: (Math.random() - 0.5) * 80,
  }));
}

function ConfettiPiece({ particle, height }: { particle: Particle; height: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: DURATION,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
  }, [progress]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const ty = -40 + p * (height + 80);
    const tx = p * particle.drift;
    const rot = particle.rotateFrom + p * particle.rotateTo;
    return {
      transform: [
        { translateY: ty },
        { translateX: tx },
        { rotate: `${rot}deg` },
      ],
      opacity: p < 0.95 ? 1 : 1 - (p - 0.95) / 0.05,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: particle.x,
          top: 0,
          width: particle.size,
          height: particle.size * 0.4,
          backgroundColor: particle.color,
          borderRadius: 2,
        },
        style,
      ]}
    />
  );
}

export function ConfettiOverlay({
  visible,
  onDismiss,
  emoji = "🎉",
  title = "All Done!",
  subtitle = "Three for three. Nice work.",
}: ConfettiOverlayProps) {
  const { width, height } = Dimensions.get("window");
  const particles = useMemo(() => (visible ? makeParticles(width) : []), [visible, width]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, 3200);
    return () => clearTimeout(t);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <Pressable
      onPress={onDismiss}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
      }}
    >
      <View pointerEvents="none" style={{ flex: 1 }}>
        {particles.map((p) => (
          <ConfettiPiece key={p.id} particle={p} height={height} />
        ))}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(255,255,255,0.95)",
              paddingHorizontal: 32,
              paddingVertical: 24,
              borderRadius: 24,
              alignItems: "center",
              shadowColor: "#000",
              shadowOpacity: 0.15,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
            }}
          >
            <Text style={{ fontSize: 36, marginBottom: 4 }}>{emoji}</Text>
            <Text style={{ fontSize: 22, fontWeight: "700", color: "#11181C" }}>
              {title}
            </Text>
            <Text style={{ fontSize: 13, color: "#687076", marginTop: 4 }}>
              {subtitle}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
