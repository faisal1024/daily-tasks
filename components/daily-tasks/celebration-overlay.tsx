import { useEffect, useRef } from "react";
import { AccessibilityInfo, BackHandler, Platform, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useColors } from "@/hooks/use-colors";
import { useScreenReaderEnabled } from "@/hooks/use-screen-reader";
import { announcePolitely } from "@/lib/daily-tasks/announce";

const DURATION = 2600;
// Lets a closing modal (Focus mode's Done) go before VoiceOver moves here.
const FOCUS_DELAY_MS = 500;

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
 * Theme-aware and deliberately quiet — no confetti spray. With VoiceOver or
 * TalkBack on it is read out and stays until dismissed (2.6s is too short to
 * find and hear it).
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
  // Reduce Motion: appear without scaling, and no expanding ring.
  const reduceMotion = useReducedMotion();
  const screenReader = useScreenReaderEnabled();
  const spoken = `${title}${/[.!?]$/.test(title) ? "" : "."} ${subtitle}`;

  const cardRef = useRef<View>(null);

  // VoiceOver moves to the card a moment after it shows, so it's read out
  // whole (focus on it speaks its label) and isn't cut off by a closing modal.
  // TalkBack doesn't reliably speak on a focus move: it hears an announcement.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      if (Platform.OS === "ios") {
        // sendAccessibilityEvent "focus" takes the element itself (works on the New Architecture).
        if (cardRef.current) AccessibilityInfo.sendAccessibilityEvent(cardRef.current, "focus");
      } else {
        announcePolitely(spoken);
      }
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, spoken]);

  // Android's back button closes it while a screen reader keeps it up.
  useEffect(() => {
    if (!visible || !screenReader || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, screenReader, onDismiss]);

  useEffect(() => {
    if (!visible) {
      progress.value = 0;
      ring.value = 0;
      return;
    }
    if (reduceMotion) {
      progress.value = withTiming(1, { duration: 150 });
      ring.value = 1;
    } else {
      progress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
      ring.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
    }
  }, [visible, progress, ring, reduceMotion]);

  // A screen reader user dismisses it themselves (the card, Dismiss, the escape gesture, Android's back).
  useEffect(() => {
    if (!visible || screenReader) return;
    const timer = setTimeout(onDismiss, DURATION);
    return () => clearTimeout(timer);
  }, [visible, onDismiss, screenReader]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: reduceMotion ? 1 : 0.85 + progress.value * 0.15 }],
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
      // VoiceOver stays on the overlay, and the escape gesture closes it.
      accessibilityViewIsModal
      onAccessibilityEscape={onDismiss}
      testID="celebration-overlay"
    >
      {/* First in VoiceOver's order, and itself the way to close it. */}
      <Pressable
        ref={cardRef}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Double-tap to close"
        // Above the full-screen Dismiss drawn after it.
        style={{ zIndex: 1 }}
        testID="celebration-card"
      >
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
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        accessibilityHint="Closes the celebration"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
    </Animated.View>
  );
}
