// "What's new" in 1.7: one card, the night before. Its button opens the
// night-before sheet in the evening; at other times the card only explains.
// Who sees it is whatsNewDecision (whats-new.ts, NIGHT_17_ID); what the
// button does is Today's (app/(tabs)/index.tsx).
import { memo, useEffect, useRef } from "react";
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { WHATS_NEW_17_COPY } from "@/lib/daily-tasks/whats-new";

/** Memoized: Today re-renders often (stable callbacks there). */
export const WhatsNew17Sheet = memo(function WhatsNew17Sheet({
  visible,
  canPlan,
  onPlan,
  onGotIt,
  onShow,
}: {
  visible: boolean;
  /** There is a night to plan now (the evening): the card's button shows. */
  canPlan: boolean;
  /** "Plan tomorrow" (the sheet closes first). */
  onPlan: () => void;
  /** "Got it", a swipe down or the back button. */
  onGotIt: () => void;
  /** The sheet is on screen. */
  onShow?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sheetAnimation = useSheetAnimation();
  const copy = WHATS_NEW_17_COPY;

  // VoiceOver starts at the title.
  const titleRef = useRef<Text>(null);
  const focusTitle = () => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
  };
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(focusTitle);
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      onRequestClose={onGotIt}
      onShow={() => {
        focusTitle();
        onShow?.();
      }}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View
        className="flex-1"
        style={{ backgroundColor: colors.background, paddingTop: Platform.OS === "ios" ? 24 : insets.top + 16 }}
        accessibilityViewIsModal
        testID="whats-new-17-sheet"
      >
        {/* One scroll for everything, "Got it" too: nothing is covered at large text. */}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 12 }}>
          <View className="gap-1 pb-1">
            <Text className="text-sm font-semibold" style={{ color: colors.primary }} maxFontSizeMultiplier={1.6}>
              {copy.label}
            </Text>
            <Text
              ref={titleRef}
              accessibilityRole="header"
              className="text-3xl text-foreground"
              style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
            >
              {copy.title}
            </Text>
          </View>
          <View
            className="rounded-2xl p-4 border gap-2"
            style={{ borderColor: colors.border, backgroundColor: colors.surface }}
            testID="whats-new-17-card"
          >
            <View className="flex-row gap-3 items-start">
              <View
                className="w-9 h-9 rounded-xl items-center justify-center"
                style={{ backgroundColor: `${colors.primary}16` }}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Ionicons name="moon-outline" size={18} color={colors.primary} />
              </View>
              <View className="flex-1 gap-1">
                <Text accessibilityRole="header" className="text-base text-foreground" style={{ fontWeight: "700" }}>
                  {copy.cardTitle}
                </Text>
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {copy.cardBody}
                </Text>
                {canPlan ? null : (
                  <Text className="text-sm" style={{ color: colors.muted }} testID="whats-new-17-later">
                    {copy.later}
                  </Text>
                )}
              </View>
            </View>
            {canPlan ? (
              <Pressable
                onPress={onPlan}
                accessibilityRole="button"
                accessibilityHint={copy.buttonHint}
                className="self-start rounded-full px-4 items-center justify-center"
                style={{ minHeight: 44, backgroundColor: `${colors.primary}16` }}
                testID="whats-new-17-plan"
              >
                <Text className="text-sm font-semibold text-center" style={{ color: colors.primary }}>
                  {copy.button}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={onGotIt}
            accessibilityRole="button"
            className="rounded-2xl px-4 py-3 items-center justify-center mt-2"
            style={{ minHeight: 50, backgroundColor: colors.primary }}
            testID="whats-new-17-got-it"
          >
            <Text className="text-base font-semibold text-center" style={{ color: colors.onPrimary }}>
              {copy.gotIt}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
});
