import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BodyFont, Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { suggestionsHint } from "@/lib/daily-tasks/ai-status";
import { THINKING_HINT_DELAY_MS, type IdeasSource } from "@/lib/daily-tasks/today-view";

export interface IdeaItem {
  id: string;
  text: string;
  estimatedMinutes?: number;
}

interface IdeasSheetProps {
  visible: boolean;
  onClose: () => void;
  goalTitle: string | null;
  source: IdeasSource;
  ideas: IdeaItem[];
  addedTexts: Set<string>;
  remainingSlots: number;
  adaptationReason: string | null;
  canRegenerate: boolean;
  regenerating: boolean;
  failureMessage: string | null;
  onAdd: (text: string) => void;
  onAddAll: (texts: string[]) => void;
  onRegenerate: () => void;
}

const keyOf = (text: string) => text.trim().toLowerCase();

export function IdeasSheet({
  visible,
  onClose,
  goalTitle,
  source,
  ideas,
  addedTexts,
  remainingSlots,
  adaptationReason,
  canRegenerate,
  regenerating,
  failureMessage,
  onAdd,
  onAddAll,
  onRegenerate,
}: IdeasSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const stillThinking = useStillThinking(regenerating);
  const available = ideas.filter((idea) => !addedTexts.has(keyOf(idea.text)));
  const full = remainingSlots <= 0;

  // Live regions are Android-only; announce new failure notes on iOS too.
  useEffect(() => {
    if (visible && failureMessage) {
      AccessibilityInfo.announceForAccessibility(failureMessage);
    }
  }, [visible, failureMessage]);

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View
        className="flex-1"
        style={{
          backgroundColor: colors.background,
          paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12,
        }}
        testID="ideas-sheet"
      >
        <View className="flex-row items-center justify-between px-5">
          <Text
            accessibilityRole="header"
            className="text-2xl text-foreground"
            style={{ fontFamily: Fonts.rounded }}
          >
            {goalTitle ? `Ideas for ${goalTitle}` : "Ideas for today"}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close ideas"
            hitSlop={10}
            className="p-1"
          >
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 14 }}
        >
          <View className="flex-row items-center justify-between">
            <View
              className="flex-row items-center gap-1.5 rounded-full px-3 py-1"
              style={{ backgroundColor: source.personalized ? `${colors.primary}18` : colors.surface }}
            >
              <Ionicons
                name={source.personalized ? "sparkles" : "leaf-outline"}
                size={13}
                color={source.personalized ? colors.primary : colors.muted}
              />
              <Text
                className="text-xs font-semibold"
                style={{ color: source.personalized ? colors.primary : colors.muted }}
              >
                {source.label}
              </Text>
            </View>
            {canRegenerate && (
              <Pressable
                onPress={onRegenerate}
                disabled={regenerating}
                accessibilityRole="button"
                accessibilityLabel="Get new ideas"
                accessibilityState={{ busy: regenerating, disabled: regenerating }}
                hitSlop={12}
                className="flex-row items-center gap-1"
                style={{ opacity: regenerating ? 0.5 : 1 }}
              >
                <Ionicons name="refresh" size={16} color={colors.primary} />
                <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                  {regenerating ? "Refreshing…" : "New ideas"}
                </Text>
              </Pressable>
            )}
          </View>

          {stillThinking && (
            <Text className="text-xs" style={{ color: colors.muted }}>
              Still thinking… good ideas take a moment.
            </Text>
          )}

          {failureMessage && (
            <View
              className="flex-row items-start gap-2 rounded-2xl p-3"
              style={{ backgroundColor: colors.surface }}
              accessibilityLiveRegion="polite"
              testID="ideas-failure"
            >
              <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
              <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
                {failureMessage}
              </Text>
            </View>
          )}

          <Text className="text-base" style={{ color: colors.muted }}>
            {full
              ? "Today's three are picked. Nice."
              : suggestionsHint(Math.min(available.length, remainingSlots))}
          </Text>
          {adaptationReason && !full && (
            <Text className="text-xs" style={{ color: colors.muted }}>
              {adaptationReason}
            </Text>
          )}

          <View className="gap-2">
            {ideas.map((idea) => {
              const added = addedTexts.has(keyOf(idea.text));
              const disabled = added || full;
              return (
                <Pressable
                  key={idea.id}
                  onPress={() => onAdd(idea.text)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={added ? `${idea.text}, added` : `Add ${idea.text}`}
                  accessibilityState={{ disabled }}
                  className="rounded-2xl border p-4 flex-row items-center gap-3"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: added ? colors.success : colors.border,
                    opacity: disabled && !added ? 0.5 : 1,
                  }}
                >
                  <Ionicons
                    name={added ? "checkmark-circle" : "add-circle-outline"}
                    size={26}
                    color={added ? colors.success : colors.primary}
                  />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-base text-foreground" style={{ fontFamily: BodyFont.bold }}>
                      {idea.text}
                    </Text>
                    {typeof idea.estimatedMinutes === "number" && (
                      <Text className="text-sm" style={{ color: colors.muted }}>
                        {idea.estimatedMinutes} min
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {available.length > 1 && !full && (
            <Pressable
              onPress={() => onAddAll(available.slice(0, remainingSlots).map((idea) => idea.text))}
              accessibilityRole="button"
              accessibilityLabel={
                available.length > remainingSlots
                  ? `Add ${remainingSlots} of these ideas`
                  : "Add all ideas"
              }
              className="rounded-2xl py-4 items-center"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-lg" style={{ fontFamily: Fonts.rounded, color: "#fff" }}>
                {available.length > remainingSlots
                  ? `Add the first ${remainingSlots} ✨`
                  : "Add all ✨"}
              </Text>
            </Pressable>
          )}

          {full && (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              className="rounded-2xl py-4 items-center"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-lg" style={{ fontFamily: Fonts.rounded, color: "#fff" }}>
                Done
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** True once a refresh has been running longer than THINKING_HINT_DELAY_MS. */
function useStillThinking(regenerating: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!regenerating) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), THINKING_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [regenerating]);
  return slow && regenerating;
}
