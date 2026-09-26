import { useEffect, useState } from "react";
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

import { BodyFont, Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { MAX_BRAIN_DUMP_CHARS, type SortedBrainDump } from "@/lib/daily-tasks/ai-helpers";

type Stage = "write" | "sorting" | "review";

interface BrainDumpSheetProps {
  visible: boolean;
  onClose: () => void;
  openSlots: number;
  /** Sort the dump (AI with offline fallback). */
  onSort: (text: string) => Promise<SortedBrainDump>;
  /** Add the chosen picks to today and park the rest. */
  onConfirm: (picks: string[], parked: string[]) => void;
}

export function BrainDumpSheet({ visible, onClose, openSlots, onSort, onConfirm }: BrainDumpSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>("write");
  const [text, setText] = useState("");
  const [sorted, setSorted] = useState<SortedBrainDump | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  // Each opening starts fresh.
  useEffect(() => {
    if (visible) {
      setStage("write");
      setSorted(null);
      setChosen(new Set());
    }
  }, [visible]);

  const sort = async () => {
    if (!text.trim()) return;
    setStage("sorting");
    const result = await onSort(text);
    setSorted(result);
    setChosen(new Set(result.result.picks));
    setStage("review");
  };

  const confirm = () => {
    if (!sorted) return;
    const picks = sorted.result.picks.filter((p) => chosen.has(p)).slice(0, openSlots);
    // Unticked picks aren't thrown away; they're parked with the rest.
    const parked = [...sorted.result.picks.filter((p) => !picks.includes(p)), ...sorted.result.parked];
    onConfirm(picks, parked);
    setText("");
  };

  const toggle = (pick: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(pick)) next.delete(pick);
      else next.add(pick);
      return next;
    });
  };

  const chosenCount = sorted ? sorted.result.picks.filter((p) => chosen.has(p)).length : 0;

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
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
          <Text accessibilityRole="header" className="text-2xl text-foreground" style={{ fontFamily: Fonts.rounded }}>
            Brain dump
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close brain dump" hitSlop={10}>
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 14 }}
        >
          {stage === "write" && (
            <>
              <Text className="text-base" style={{ color: colors.muted }}>
                Get it all out of your head: errands, worries, ideas. We'll pick up to {openSlots}{" "}
                for today and keep the rest for later.
              </Text>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                autoFocus
                maxLength={MAX_BRAIN_DUMP_CHARS}
                placeholder={"Call the dentist\nFinish the report\nBuy running shoes…"}
                placeholderTextColor={colors.muted}
                accessibilityLabel="Brain dump text"
                accessibilityHint="Type or dictate everything on your mind. One per line is fine."
                className="rounded-2xl border p-4 text-base"
                style={{
                  minHeight: 200,
                  textAlignVertical: "top",
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  fontFamily: BodyFont.semibold,
                }}
              />
              <Pressable
                onPress={() => void sort()}
                disabled={!text.trim()}
                accessibilityRole="button"
                accessibilityState={{ disabled: !text.trim() }}
                className="rounded-2xl py-4 items-center"
                style={{ backgroundColor: colors.primary, opacity: text.trim() ? 1 : 0.5 }}
              >
                <Text className="text-lg" style={{ fontFamily: Fonts.rounded, color: "#fff" }}>
                  {openSlots === 1 ? "Pick my one" : `Pick my ${openSlots === 2 ? "two" : "three"}`}
                </Text>
              </Pressable>
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
                >
                  <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
                  <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
                    {sorted.notice}
                  </Text>
                </View>
              )}
              <Text className="text-sm font-semibold uppercase tracking-wide" style={{ color: colors.muted }}>
                For today
              </Text>
              {sorted.result.picks.map((pick) => {
                const on = chosen.has(pick);
                return (
                  <Pressable
                    key={pick}
                    onPress={() => toggle(pick)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={pick}
                    className="rounded-2xl border p-4 flex-row items-center gap-3"
                    style={{ borderColor: on ? colors.primary : colors.border, backgroundColor: colors.surface }}
                  >
                    <Ionicons
                      name={on ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={on ? colors.primary : colors.muted}
                    />
                    <Text className="flex-1 text-base text-foreground" style={{ fontFamily: BodyFont.bold }}>
                      {pick}
                    </Text>
                  </Pressable>
                );
              })}

              {sorted.result.parked.length > 0 && (
                <View className="gap-2 mt-2">
                  <Text className="text-sm font-semibold uppercase tracking-wide" style={{ color: colors.muted }}>
                    Parked for later ({sorted.result.parked.length})
                  </Text>
                  <Text className="text-sm" style={{ color: colors.muted }}>
                    You'll find these under Ideas when you have room.
                  </Text>
                  {sorted.result.parked.map((item) => (
                    <Text key={item} className="text-base" style={{ color: colors.foreground }}>
                      • {item}
                    </Text>
                  ))}
                </View>
              )}

              <Pressable
                onPress={confirm}
                disabled={chosenCount === 0}
                accessibilityRole="button"
                accessibilityState={{ disabled: chosenCount === 0 }}
                className="rounded-2xl py-4 items-center mt-2"
                style={{ backgroundColor: colors.primary, opacity: chosenCount === 0 ? 0.5 : 1 }}
              >
                <Text className="text-lg" style={{ fontFamily: Fonts.rounded, color: "#fff" }}>
                  {chosenCount === 0 ? "Pick at least one" : `Add ${chosenCount} to today`}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setStage("write")}
                accessibilityRole="button"
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
