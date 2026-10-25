// "Meet Nag mode" (1.4): the sheet that introduces Nag mode to people who
// update, and that Settings › Reminders opens again from "What is Nag mode?".
// Only what it looks like and says: who sees it and what its buttons do are
// in NagIntro (nag-intro.tsx).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceChips } from "@/components/daily-tasks/choice-chips";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import type { NagChoice } from "@/hooks/use-nag-turn-on";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import {
  NAG_LEVEL_LABELS,
  NAG_LEVELS,
  NAG_PERSONA_LABELS,
  NAG_PERSONAS,
  nagTitle,
  type NagLevel,
  type NagPersona,
} from "@/lib/daily-tasks/nag";
import { NAG_LEVEL_COUNT_NOTE, nagLevelRudeNote } from "@/lib/daily-tasks/nag-copy";
import { NAG_INTRO_COPY, nagIntroSamples } from "@/lib/daily-tasks/whats-new";

/** From this text size up the two buttons scroll with the rest, so they never cover it. */
const INLINE_BUTTONS_FONT_SCALE = 1.5;
const PREVIEW_FADE_MS = 180;

export function NagIntroSheet({
  visible,
  hasPlus,
  initial,
  taskText,
  onTry,
  onDismiss,
  onShow,
}: {
  visible: boolean;
  hasPlus: boolean;
  /** The chips' starting choice: the saved voice and level. */
  initial: NagChoice;
  /** An open task for the preview to name; null when there is none or names are hidden. */
  taskText: string | null;
  onTry: (choice: NagChoice) => void;
  /** "Not now", the close button, a swipe down or the back button. */
  onDismiss: (choice: NagChoice) => void;
  /** The sheet is on screen. */
  onShow?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sheetAnimation = useSheetAnimation();
  const reduceMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const inlineButtons = fontScale >= INLINE_BUTTONS_FONT_SCALE;

  const [persona, setPersona] = useState<NagPersona>(initial.persona);
  const [level, setLevel] = useState<NagLevel>(initial.level);
  const [turn, setTurn] = useState(0);
  // Each opening starts from the saved choice.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => {
    if (!visible) return;
    setPersona(initialRef.current.persona);
    setLevel(initialRef.current.level);
    setTurn(0);
  }, [visible]);

  // On the phone only: nothing is sent for the preview.
  const samples = useMemo(() => nagIntroSamples({ persona, level, taskText }), [persona, level, taskText]);
  const sample = samples.length > 0 ? samples[turn % samples.length] : "";

  // The new line fades in; with Reduce Motion it is simply there.
  const fade = useRef(new Animated.Value(1)).current;
  const shownSample = useRef(sample);
  useEffect(() => {
    if (shownSample.current === sample) return;
    shownSample.current = sample;
    if (reduceMotion || !visible) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: PREVIEW_FADE_MS, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [sample, reduceMotion, visible, fade]);

  // VoiceOver starts at the title.
  const titleRef = useRef<Text>(null);
  const focusTitle = () => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
  };
  useEffect(() => {
    if (!visible) return;
    // A frame later, once it's laid out (onShow does it again once the sheet is up).
    const frame = requestAnimationFrame(focusTitle);
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  const choice: NagChoice = { persona, level };
  // The sample changes in place when a chip is picked: say the new one.
  const announceFirst = (next: NagChoice) => {
    const first = nagIntroSamples({ ...next, taskText })[0];
    if (first) announcePolitely(first);
  };
  const pickPersona = (next: NagPersona) => {
    if (next !== persona) announceFirst({ persona: next, level });
    setPersona(next);
    setTurn(0);
  };
  const pickLevel = (next: NagLevel) => {
    if (next !== level) announceFirst({ persona, level: next });
    setLevel(next);
    setTurn(0);
  };

  // Without Plus the main button opens the paywall: it says so, and the line
  // above it says why, before the tap.
  const primaryLabel = hasPlus ? NAG_INTRO_COPY.primary : NAG_INTRO_COPY.primaryFree;
  const buttons = (
    <View className="gap-2">
      {!hasPlus ? (
        <Text className="text-sm text-center pb-1" style={{ color: colors.muted }} testID="nag-intro-plus">
          {NAG_INTRO_COPY.plus}
        </Text>
      ) : null}
      <Pressable
        onPress={() => onTry(choice)}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityHint={hasPlus ? undefined : NAG_INTRO_COPY.primaryFreeHint}
        className="rounded-2xl px-4 py-3 items-center justify-center"
        style={{ minHeight: 50, backgroundColor: colors.primary }}
        testID="nag-intro-try"
      >
        <Text className="text-base font-semibold text-center" style={{ color: colors.onPrimary }}>
          {primaryLabel}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onDismiss(choice)}
        accessibilityRole="button"
        accessibilityLabel={NAG_INTRO_COPY.secondary}
        className="rounded-2xl px-4 py-2 items-center justify-center"
        style={{ minHeight: 44 }}
        testID="nag-intro-not-now"
      >
        <Text className="text-base font-semibold text-center" style={{ color: colors.primary }}>
          {NAG_INTRO_COPY.secondary}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <Modal
      visible={visible}
      onRequestClose={() => onDismiss(choice)}
      onShow={() => {
        focusTitle();
        onShow?.();
      }}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View
        className="flex-1"
        style={{ backgroundColor: colors.background, paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
        accessibilityViewIsModal
        testID="nag-intro-sheet"
      >
        <View className="flex-row items-center justify-between gap-3 px-5">
          <Text
            className="flex-1 text-sm font-semibold"
            style={{ color: colors.primary }}
            maxFontSizeMultiplier={1.6}
            testID="nag-intro-label"
          >
            {NAG_INTRO_COPY.label}
          </Text>
          <Pressable
            onPress={() => onDismiss(choice)}
            accessibilityRole="button"
            accessibilityLabel={NAG_INTRO_COPY.close}
            hitSlop={10}
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
            testID="nag-intro-close"
          >
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: inlineButtons ? insets.bottom + 24 : 20,
            gap: 18,
          }}
        >
          <View className="gap-2">
            <Text
              ref={titleRef}
              accessibilityRole="header"
              className="text-3xl text-foreground"
              style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
            >
              {NAG_INTRO_COPY.title}
            </Text>
            <Text className="text-base" style={{ color: colors.muted }}>
              {NAG_INTRO_COPY.lede}
            </Text>
          </View>

          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">{NAG_INTRO_COPY.voice}</Text>
            <ChoiceChips
              label={NAG_INTRO_COPY.voice}
              spokenGroup
              value={persona}
              onChange={pickPersona}
              options={NAG_PERSONAS.map((value) => ({ value, label: NAG_PERSONA_LABELS[value] }))}
              testID="nag-intro-voice"
              columns={3}
            />
          </View>
          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">{NAG_INTRO_COPY.level}</Text>
            <ChoiceChips
              label={NAG_INTRO_COPY.level}
              spokenGroup
              value={level}
              onChange={pickLevel}
              options={NAG_LEVELS.map((value) => ({ value, label: NAG_LEVEL_LABELS[value] }))}
              testID="nag-intro-level"
              columns={3}
            />
            <Text className="text-xs" style={{ color: colors.muted }} testID="nag-intro-level-count">
              {NAG_LEVEL_COUNT_NOTE[level]}
            </Text>
            {nagLevelRudeNote(persona, level) ? (
              <Text className="text-xs" style={{ color: colors.muted }} testID="nag-intro-level-rude">
                {nagLevelRudeNote(persona, level)}
              </Text>
            ) : null}
          </View>

          {/* How one would look when it arrives. */}
          <View className="gap-1">
            <View
              accessible
              accessibilityLabel={`Sample: ${sample}`}
              className="rounded-2xl p-4 border flex-row gap-3"
              style={{ borderColor: colors.border, backgroundColor: colors.surface }}
              testID="nag-intro-preview"
            >
              <View
                className="w-9 h-9 rounded-xl items-center justify-center"
                style={{ backgroundColor: `${colors.primary}16` }}
              >
                <Ionicons name="notifications" size={18} color={colors.primary} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-semibold text-foreground" testID="nag-intro-preview-title">
                  {nagTitle(persona)}
                </Text>
                <Animated.View style={{ opacity: fade }}>
                  <Text className="text-sm text-foreground" testID="nag-intro-sample">
                    {sample}
                  </Text>
                </Animated.View>
              </View>
            </View>
            <Pressable
              onPress={() => {
                setTurn(turn + 1);
                // The line changes in place: say the new one.
                if (samples.length > 0) announcePolitely(samples[(turn + 1) % samples.length]);
              }}
              accessibilityRole="button"
              accessibilityLabel={NAG_INTRO_COPY.another}
              accessibilityHint="Shows another sample line"
              className="self-start justify-center"
              style={{ minHeight: 44 }}
              testID="nag-intro-another"
            >
              <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                {NAG_INTRO_COPY.another}
              </Text>
            </Pressable>
          </View>

          <View className="gap-3">
            {NAG_INTRO_COPY.points.map((point) => (
              <View key={point.text} className="flex-row gap-3 items-start">
                <Ionicons
                  name={point.icon}
                  size={20}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
                <Text className="flex-1 text-base text-foreground">{point.text}</Text>
              </View>
            ))}
          </View>

          {inlineButtons ? buttons : null}

          <Text className="text-xs" style={{ color: colors.muted }} testID="nag-intro-footer">
            {NAG_INTRO_COPY.footer}
          </Text>
        </ScrollView>

        {inlineButtons ? null : (
          <View
            className="px-5 pt-3"
            style={{ paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: colors.border }}
          >
            {buttons}
          </View>
        )}
      </View>
    </Modal>
  );
}
