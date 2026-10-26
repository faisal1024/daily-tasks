// "What's new" in 1.6 (and 1.5, which ships inside it): short cards, each
// with an icon, a bold title, a line or two and at most one button, and one
// "Got it". Only what it looks like and says: which cards show is
// whatsNew16Cards (lib/daily-tasks/whats-new-16.ts), and what the buttons do
// is Today's (app/(tabs)/index.tsx).
import { memo, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SaveLaterHowTo } from "@/components/daily-tasks/save-later-how-to";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import {
  WHATS_NEW_16_COPY,
  type WhatsNew16Action,
  type WhatsNew16Card,
} from "@/lib/daily-tasks/whats-new-16";

/** From this text size up "Got it" scrolls with the cards, so it never covers them. */
const INLINE_BUTTON_FONT_SCALE = 1.5;

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Memoized: Today re-renders often, and the sheet only changes with its props (stable callbacks there). */
export const WhatsNew16Sheet = memo(function WhatsNew16Sheet({
  visible,
  cards,
  onAction,
  onHowTo,
  onGotIt,
  onShow,
}: {
  visible: boolean;
  cards: WhatsNew16Card[];
  /** A card's button that leads somewhere (the sheet closes first). */
  onAction: (action: Exclude<WhatsNew16Action, "how_to">) => void;
  /** "Show me" opened the how-to in place (nothing closes). */
  onHowTo?: () => void;
  /** "Got it", a swipe down or the back button. */
  onGotIt: () => void;
  /** The sheet is on screen. */
  onShow?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sheetAnimation = useSheetAnimation();
  const { fontScale } = useWindowDimensions();
  const inlineButton = fontScale >= INLINE_BUTTON_FONT_SCALE;
  const copy = WHATS_NEW_16_COPY;

  // Each opening starts with the how-to folded.
  const [howToOpen, setHowToOpen] = useState(false);
  useEffect(() => {
    if (visible) setHowToOpen(false);
  }, [visible]);

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

  const gotIt = (
    <Pressable
      onPress={onGotIt}
      accessibilityRole="button"
      accessibilityLabel={copy.gotIt}
      className="rounded-2xl px-4 py-3 items-center justify-center"
      style={{ minHeight: 50, backgroundColor: colors.primary }}
      testID="whats-new-16-got-it"
    >
      <Text className="text-base font-semibold text-center" style={{ color: colors.onPrimary }}>
        {copy.gotIt}
      </Text>
    </Pressable>
  );

  const renderButton = (card: WhatsNew16Card) => {
    const button = card.button;
    if (!button) return null;
    const howTo = button.action === "how_to";
    const label = howTo && howToOpen ? copy.saveLater.hideButton : button.label;
    return (
      <Pressable
        onPress={() => {
          if (button.action === "how_to") {
            if (!howToOpen) onHowTo?.();
            setHowToOpen(!howToOpen);
            return;
          }
          onAction(button.action);
        }}
        accessibilityRole="button"
        accessibilityLabel={howTo ? copy.saveLater.button : button.label}
        accessibilityHint={button.hint}
        accessibilityState={howTo ? { expanded: howToOpen } : undefined}
        className="self-start rounded-full px-4 items-center justify-center"
        style={{ minHeight: 44, backgroundColor: `${colors.primary}16` }}
        testID={`whats-new-16-${card.id}-button`}
      >
        <Text className="text-sm font-semibold text-center" style={{ color: colors.primary }}>
          {label}
        </Text>
      </Pressable>
    );
  };

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
        testID="whats-new-16-sheet"
      >
        <ScrollView
          testID="whats-new-16-scroll"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: inlineButton ? insets.bottom + 24 : 20,
            gap: 12,
          }}
        >
          <View className="gap-1 pb-1">
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.primary }}
              maxFontSizeMultiplier={1.6}
              testID="whats-new-16-label"
            >
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

          {cards.map((card) => (
            <View
              key={card.id}
              className="rounded-2xl p-4 border gap-2"
              style={{ borderColor: colors.border, backgroundColor: colors.surface }}
              testID={`whats-new-16-card-${card.id}`}
            >
              <View className="flex-row gap-3 items-start">
                <View
                  className="w-9 h-9 rounded-xl items-center justify-center"
                  style={{ backgroundColor: `${colors.primary}16` }}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Ionicons name={card.icon as IconName} size={18} color={colors.primary} />
                </View>
                <View className="flex-1 gap-1">
                  <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                    <Text
                      accessibilityRole="header"
                      // Said with its Plus tag, as one heading.
                      accessibilityLabel={card.plus ? `${card.title}, Plus` : card.title}
                      className="text-base text-foreground"
                      style={{ fontWeight: "700" }}
                    >
                      {card.title}
                    </Text>
                    {card.plus ? (
                      <View
                        className="rounded-full px-2 py-0.5"
                        style={{ backgroundColor: `${colors.primary}16` }}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        testID={`whats-new-16-${card.id}-plus`}
                      >
                        <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                          {copy.plusTag}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="text-sm" style={{ color: colors.muted }}>
                    {card.body}
                  </Text>
                  {card.example ? (
                    <View
                      accessible
                      accessibilityLabel={card.example.spoken}
                      className="flex-row flex-wrap items-center gap-x-2 gap-y-0.5 pt-1"
                      testID="whats-new-16-example"
                    >
                      <Text className="text-sm text-foreground">{card.example.line}</Text>
                      <Ionicons name="arrow-forward" size={14} color={colors.muted} />
                      <Text className="text-sm text-foreground" style={{ fontWeight: "600" }}>
                        {card.example.filled}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {card.id === "save_later" && howToOpen ? <SaveLaterHowTo testID="whats-new-16-how-to" /> : null}
              {renderButton(card)}
            </View>
          ))}

          {inlineButton ? <View className="pt-2">{gotIt}</View> : null}
        </ScrollView>

        {inlineButton ? null : (
          <View
            className="px-5 pt-3"
            style={{ paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: colors.border }}
          >
            {gotIt}
          </View>
        )}
      </View>
    </Modal>
  );
});
