import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { useColors } from "@/hooks/use-colors";
import { MAX_BRAIN_DUMP_CHARS, type SortedBrainDump } from "@/lib/daily-tasks/ai-helpers";

type Stage = "write" | "sorting" | "review";

interface BrainDumpSheetProps {
  visible: boolean;
  onClose: () => void;
  openSlots: number;
  /** Sort the dump (AI with offline fallback). */
  onSort: (text: string) => Promise<SortedBrainDump>;
  /**
   * Add `picks` to today and save `parked` for later. Also called with no picks
   * when the user saves everything or closes the review, so nothing is lost.
   */
  onConfirm: (picks: string[], parked: string[]) => void;
  /**
   * Set when AI sorting needs Plus: the write step offers an upgrade. What was
   * typed is kept, so it's still there after upgrading.
   */
  onUpgrade?: () => void;
  /** Free AI sorts left for a free user (null when unknown or not applicable). */
  freeAiLeft?: number | null;
}

export function BrainDumpSheet({
  visible,
  onClose,
  openSlots,
  onSort,
  onConfirm,
  onUpgrade,
  freeAiLeft = null,
}: BrainDumpSheetProps) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>("write");
  const [text, setText] = useState("");
  const [sorted, setSorted] = useState<SortedBrainDump | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // Bumped on every open/close: a sort that finishes after the sheet closed
  // (or reopened) belongs to an old session and is ignored.
  const session = useRef(0);

  useEffect(() => {
    session.current += 1;
    if (visible) {
      setStage("write");
      setSorted(null);
      setChosen(new Set());
    }
  }, [visible]);

  // Every sorted item, today's suggestions first; any of them can be chosen.
  const items = sorted ? [...sorted.result.picks, ...sorted.result.parked] : [];
  const chosenItems = items.filter((item) => chosen.has(item));
  const full = chosenItems.length >= openSlots;

  const sort = async () => {
    if (!text.trim()) return;
    const mine = session.current;
    setStage("sorting");
    const result = await onSort(text);
    if (mine !== session.current) return;
    setSorted(result);
    setChosen(new Set(result.result.picks.slice(0, openSlots)));
    setStage("review");
  };

  const confirm = () => {
    if (!sorted) return;
    onConfirm(
      chosenItems,
      items.filter((item) => !chosen.has(item)),
    );
    setText("");
  };

  // Closing during review saves everything instead of throwing it away.
  const close = () => {
    if (stage === "review" && sorted) {
      onConfirm([], items);
      setText("");
      return;
    }
    onClose();
  };

  const toggle = (item: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(item)) next.delete(item);
      else if (next.size < openSlots) next.add(item);
      return next;
    });
  };

  const slotWord = openSlots === 1 ? "1 thing" : `up to ${openSlots}`;

  return (
    <Modal
      visible={visible}
      onRequestClose={close}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        testID="brain-dump-sheet"
      >
        <View
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
        >
          <Text accessibilityRole="header" className="text-2xl text-foreground" style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}>
            Brain dump
          </Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={stage === "review" ? "Close and save everything for later" : "Close brain dump"}
            hitSlop={10}
          >
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 14 }}
        >
          {stage === "write" && (
            <>
              <Text className="text-base" style={{ color: colors.muted }}>
                Get it all out of your head: errands, worries, ideas. We'll suggest {slotWord} for
                today and save the rest.
              </Text>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                autoFocus
                scrollEnabled
                maxLength={MAX_BRAIN_DUMP_CHARS}
                placeholder={"Call the dentist\nFinish the report\nBuy running shoes…"}
                placeholderTextColor={colors.muted}
                accessibilityLabel="Brain dump text"
                accessibilityHint="Type or dictate everything on your mind. One per line is fine."
                className="rounded-2xl border p-4 text-base"
                style={{
                  // Fixed range so long dictation scrolls inside the box.
                  minHeight: 180,
                  maxHeight: 320,
                  textAlignVertical: "top",
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  fontWeight: "600",
                }}
              />
              <Pressable
                onPress={() => void sort()}
                disabled={!text.trim()}
                accessibilityRole="button"
                accessibilityState={{ disabled: !text.trim() }}
                className="rounded-2xl py-4 items-center"
                style={{ backgroundColor: text.trim() ? colors.primary : colors.border }}
              >
                <Text
                  className="text-lg"
                  style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: text.trim() ? colors.onPrimary : colors.muted }}
                >
                  Sort it for me
                </Text>
              </Pressable>
              {/* Wait for the free-sort count before saying anything. */}
              {onUpgrade && freeAiLeft !== null && (
                <View
                  className="flex-row items-center gap-2 rounded-2xl p-3"
                  style={{ backgroundColor: colors.surface }}
                  testID="brain-dump-upgrade"
                >
                  <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                  <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
                    {freeAiLeft !== null && freeAiLeft > 0
                      ? freeAiLeft >= 3
                        ? "AI will sort this one. You have 3 free AI sorts to try."
                        : `AI will sort this one. ${freeAiLeft} free AI ${freeAiLeft === 1 ? "sort" : "sorts"} left.`
                      : "Free AI sorts used up, so this will be a simple split. Plus turns your notes into clear tasks."}
                  </Text>
                  {/* No upsell during the free taste. */}
                  {freeAiLeft !== null && freeAiLeft > 0 ? null : (
                    <Pressable
                      onPress={onUpgrade}
                      accessibilityRole="button"
                      accessibilityLabel="Get Plus for AI sorting"
                      accessibilityHint="Opens Plus plans. What you wrote is kept."
                      hitSlop={12}
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                        Get Plus
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </>
          )}

          {stage === "sorting" && (
            <View className="items-center gap-3 py-16" accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} />
              <Text className="text-base" style={{ color: colors.muted }}>
                Sorting through it…
              </Text>
            </View>
          )}

          {stage === "review" && sorted && (
            <>
              {sorted.notice && (
                <View
                  className="flex-row items-start gap-2 rounded-2xl p-3"
                  style={{ backgroundColor: colors.surface }}
                  testID="brain-dump-notice"
                  accessibilityLiveRegion="polite"
                >
                  <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
                  <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
                    {sorted.notice}
                  </Text>
                  {/* What was typed is kept, so it can be sorted again after upgrading. */}
                  {sorted.freeLimit && onUpgrade && (
                    <Pressable
                      onPress={onUpgrade}
                      accessibilityRole="button"
                      accessibilityLabel="Get Plus for AI sorting"
                      accessibilityHint="Opens Plus plans. What you wrote is kept."
                      hitSlop={12}
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                        Get Plus
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
              <Text className="text-base" style={{ color: colors.muted }}>
                Tick {openSlots === 1 ? "1" : `up to ${openSlots}`} for today. Everything else is
                saved in Ideas for another day.
              </Text>
              {items.map((item) => {
                const on = chosen.has(item);
                const blocked = !on && full;
                return (
                  <Pressable
                    key={item}
                    onPress={() => toggle(item)}
                    disabled={blocked}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: blocked }}
                    accessibilityLabel={item}
                    accessibilityHint={on ? "Double-tap to save for later instead" : "Double-tap to add to today"}
                    className="rounded-2xl border p-4 flex-row items-center gap-3"
                    style={{
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: colors.surface,
                      opacity: blocked ? 0.5 : 1,
                    }}
                  >
                    <Ionicons
                      name={on ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={on ? colors.primary : colors.muted}
                    />
                    <Text className="flex-1 text-base text-foreground" style={{ fontWeight: "700" }}>
                      {item}
                    </Text>
                    {!on && (
                      <Text className="text-xs" style={{ color: colors.muted }}>
                        Later
                      </Text>
                    )}
                  </Pressable>
                );
              })}

              <Pressable
                onPress={confirm}
                accessibilityRole="button"
                className="rounded-2xl py-4 items-center mt-2"
                style={{ backgroundColor: colors.primary }}
              >
                <Text className="text-lg" style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: colors.onPrimary }}>
                  {chosenItems.length === 0 ? "Save all for later" : `Add ${chosenItems.length} to today`}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setStage("write")}
                accessibilityRole="button"
                accessibilityLabel="Edit what I wrote"
                hitSlop={8}
                className="items-center py-2"
              >
                <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                  Edit what I wrote
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
