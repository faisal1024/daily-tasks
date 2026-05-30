import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useColors } from "@/hooks/use-colors";

const DURATION = 2600;

interface CelebrationOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  emoji?: string;
  title?: string;
  subtitle?: string;
}

/**
 * A calm celebration: a soft expanding ring behind the emoji and a card that
 * gently scales + fades in, then auto-dismisses. Tap anywhere to dismiss.
 * Theme-aware and deliberately quiet — no confetti spray.
 */
export function CelebrationOverlay({
  visible,
  onDismiss,
  emoji = "🎉",
  title = "All Done!",
  subtitle = "Three for three. Nice work.",
}: CelebrationOverlayProps) {
  const colors = useColors();
  const progress = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      progress.value = 0;
      ring.value = 0;
      return;
    }
    progress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    ring.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(onDismiss, DURATION);
    return () => clearTimeout(timer);
  }, [visible, onDismiss, progress, ring]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.85 + progress.value * 0.15 }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - ring.value) * 0.45,
    transform: [{ scale: 0.6 + ring.value * 1.7 }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50,
          backgroundColor: "rgba(0,0,0,0.35)",
        },
        backdropStyle,
      ]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityLabel="Dismiss celebration"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Animated.View
        style={[
          {
            backgroundColor: colors.background,
            paddingHorizontal: 28,
            paddingVertical: 28,
            borderRadius: 28,
            alignItems: "center",
            maxWidth: 300,
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          },
          cardStyle,
        ]}
      >
        <View
          style={{
            width: 84,
            height: 84,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <Animated.View
            style={[
              {
                position: "absolute",
                width: 84,
                height: 84,
                borderRadius: 42,
                backgroundColor: colors.primary,
              },
              ringStyle,
            ]}
          />
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ fontSize: 40 }}>{emoji}</Text>
          </View>
        </View>
        <Text
          style={{
            fontSize: 20,
            fontWeight: "700",
            color: colors.foreground,
            textAlign: "center",
          }}
        >
          {title}
        </Text>
        <Text
          style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}
        >
          {subtitle}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
