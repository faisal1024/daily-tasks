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

import { Fonts } from "@/constants/theme";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
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
  /** Opened from "Saved for later": show only the saved items, first. */
  savedOnly?: boolean;
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
  /** Brain-dump leftovers saved for later. */
  parked?: { id: string; text: string }[];
  onAddParked?: (id: string) => void;
  onRemoveParked?: (id: string) => void;
  /** Offered in the "full" state so the next step is one tap away. */
  onLock?: () => void;
  /** Routines due today and not on today's list yet (1.3). Nothing shows when empty. */
  routines?: { id: string; text: string }[];
  onAddRoutine?: (id: string) => void;
  /** Today is set: nothing can be added until it's changed. */
  locked?: boolean;
  /** The user has routines (due today or not); without any, a quiet footer offers one. */
  hasRoutines?: boolean;
  /** Opens the routines sheet (the footer's "Make it a routine"). */
  onManageRoutines?: () => void;
}

const keyOf = (text: string) => text.trim().toLowerCase();

export function IdeasSheet({
  visible,
  savedOnly = false,
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
  parked = [],
  onAddParked,
  onRemoveParked,
  onLock,
  routines = [],
  onAddRoutine,
  locked = false,
  hasRoutines = true,
  onManageRoutines,
}: IdeasSheetProps) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  const insets = useSafeAreaInsets();
  const stillThinking = useStillThinking(regenerating);
  // The saved-only view is just the saved items: no routines there.
  const shownRoutines = savedOnly ? [] : routines;
  // An idea with the same words as a routine due today is listed once, as the routine.
  const routineKeys = new Set(shownRoutines.map((routine) => keyOf(routine.text)));
  const shownIdeas = routineKeys.size > 0 ? ideas.filter((idea) => !routineKeys.has(keyOf(idea.text))) : ideas;
  const available = shownIdeas.filter((idea) => !addedTexts.has(keyOf(idea.text)));
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
      animationType={sheetAnimation}
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
            style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
          >
            {savedOnly ? "Saved for later" : goalTitle ? `Ideas for ${goalTitle}` : "Ideas for today"}
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
          {shownRoutines.length > 0 && (
            <TodaysRoutines
              routines={shownRoutines}
              onAdd={onAddRoutine}
              blockedReason={
                locked
                  ? "Today is set. Change it on Today to add one."
                  : full
                    ? "Today's three are picked. Free a slot to add one."
                    : null
              }
            />
          )}

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
            {canRegenerate && !savedOnly && (
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
            {savedOnly
              ? "Your day is full. Free a slot to swap one of these in."
              : full
                ? "Today's three are picked. Nice."
                : suggestionsHint(Math.min(available.length, remainingSlots))}
          </Text>
          {adaptationReason && !full && (
            <Text className="text-xs" style={{ color: colors.muted }}>
              {adaptationReason}
            </Text>
          )}

          {!savedOnly && (
          <View className="gap-2">
            {shownIdeas.map((idea) => {
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
                    <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
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
          )}

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
              <Text className="text-lg" style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: colors.onPrimary }}>
                {available.length > remainingSlots
                  ? `Add the first ${remainingSlots}`
                  : "Add all"}
              </Text>
            </Pressable>
          )}

          {parked.length > 0 && (
            <View className="gap-2 mt-2" testID="parked-ideas">
              {/* The saved-only sheet's title already says it. */}
              {!savedOnly && (
                <Text
                  className="text-sm font-semibold uppercase tracking-wide"
                  style={{ color: colors.muted }}
                >
                  Saved for later
                </Text>
              )}
              {parked.map((item) => (
                <View
                  key={item.id}
                  className="rounded-2xl border p-3 flex-row items-center gap-3"
                  style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                >
                  <Pressable
                    onPress={() => onAddParked?.(item.id)}
                    disabled={full}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${item.text}`}
                    accessibilityState={{ disabled: full }}
                    hitSlop={6}
                    className="flex-1 flex-row items-center gap-3"
                    style={{ opacity: full ? 0.5 : 1 }}
                  >
                    <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                    <Text className="flex-1 text-base text-foreground">{item.text}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onRemoveParked?.(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.text} from saved`}
                    hitSlop={10}
                  >
                    <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {full && !savedOnly && (
            <View className="gap-2">
              {onLock && (
                <Pressable
                  onPress={onLock}
                  accessibilityRole="button"
                  accessibilityLabel="Set these three"
                  className="rounded-2xl py-4 items-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-lg" style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: colors.onPrimary }}>
                    Set these three
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                className="rounded-2xl py-4 items-center"
                style={
                  onLock
                    ? { borderWidth: 1, borderColor: colors.border }
                    : { backgroundColor: colors.primary }
                }
              >
                <Text
                  className="text-lg"
                  style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: onLock ? colors.primary : colors.onPrimary }}
                >
                  Done
                </Text>
              </Pressable>
            </View>
          )}

          {!savedOnly && !hasRoutines && onManageRoutines && (
            <Pressable
              onPress={onManageRoutines}
              accessibilityRole="button"
              accessibilityHint="Opens routines"
              className="flex-row items-center justify-center gap-1.5 mt-2"
              style={{ minHeight: 44 }}
              testID="ideas-make-routine"
            >
              <Ionicons name="repeat" size={14} color={colors.muted} />
              <Text className="text-sm" style={{ color: colors.muted }}>
                Do something on repeat?{" "}
                <Text style={{ color: colors.primary, fontWeight: "600" }}>Make it a routine.</Text>
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * Routines due today, at the top of the sheet. Same one-tap add as an idea;
 * when today is full or set, the rows are disabled and say why. A routine
 * that isn't added simply isn't: nothing is marked missed.
 */
function TodaysRoutines({
  routines,
  onAdd,
  blockedReason,
}: {
  routines: { id: string; text: string }[];
  onAdd?: (id: string) => void;
  blockedReason: string | null;
}) {
  const colors = useColors();
  const disabled = blockedReason !== null;
  return (
    <View className="gap-2" testID="todays-routines">
      <Text
        accessibilityRole="header"
        className="text-sm font-semibold uppercase tracking-wide"
        style={{ color: colors.muted }}
      >
        Today&apos;s routines
      </Text>
      {blockedReason && (
        <Text className="text-sm" style={{ color: colors.muted }} testID="todays-routines-blocked">
          {blockedReason}
        </Text>
      )}
      {routines.map((routine) => (
        <Pressable
          key={routine.id}
          onPress={() => onAdd?.(routine.id)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Add ${routine.text}`}
          accessibilityHint={blockedReason ?? "Adds this routine to today's three"}
          accessibilityState={{ disabled }}
          className="rounded-2xl border p-4 flex-row items-center gap-3"
          style={{
            minHeight: 44,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: disabled ? 0.5 : 1,
          }}
          testID={`routine-suggestion-${routine.id}`}
        >
          <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
          <Text className="flex-1 text-base text-foreground" style={{ fontWeight: "700" }}>
            {routine.text}
          </Text>
          <Ionicons name="repeat" size={16} color={colors.muted} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      ))}
    </View>
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
