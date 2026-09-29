import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { morningPerspective } from "@/lib/daily-tasks/evening";
import type { TomorrowDraft } from "@/lib/daily-tasks/types";

/**
 * The morning entry on an empty day: one big, calm prompt that opens the brain
 * dump. The whole ritual starts here ("dump it all, we'll pick three").
 */
export function MorningHero({
  onDump,
  onBrowseIdeas,
}: {
  onDump: () => void;
  onBrowseIdeas: () => void;
}) {
  const colors = useColors();
  return (
    <View className="gap-3" testID="morning-hero">
      <Pressable
        onPress={onDump}
        accessibilityRole="button"
        accessibilityLabel="What's on your mind today? Dump it all and get today's three"
        className="rounded-3xl p-5 gap-2"
        style={{ backgroundColor: colors.primary }}
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name="sparkles" size={20} color={colors.onPrimary} accessibilityElementsHidden />
          <Text style={{ color: colors.onPrimary, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 22 }}>
            What&apos;s on your mind today?
          </Text>
        </View>
        <Text style={{ color: `${colors.onPrimary}E0`, fontSize: 15 }}>
          Dump it all, by typing or talking. We&apos;ll pick your three and save the rest.
        </Text>
        <View
          className="self-start rounded-full px-4 py-2 mt-1"
          style={{ backgroundColor: colors.onPrimary }}
        >
          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 15 }}>
            Start my day
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onBrowseIdeas}
        accessibilityRole="button"
        accessibilityLabel="Or pick from ideas"
        hitSlop={8}
        className="self-center py-1"
        testID="morning-hero-ideas"
      >
        <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
          Or pick from ideas
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Last night's draft of today's three: tick the ones to use (the first that
 * fit are ticked), use them in one tap, or change it. Unticked ones are saved
 * for later, and any empty slots are filled the usual way afterwards.
 */
export function TomorrowDraftCard({
  draft,
  remainingSlots,
  onUse,
  onChange,
  onDismiss,
}: {
  draft: TomorrowDraft;
  remainingSlots: number;
  /** The ticked tasks, in the draft's order. */
  onUse: (tasks: string[]) => void;
  onChange: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const room = Math.max(0, remainingSlots);
  const [selected, setSelected] = useState<string[]>(() => draft.tasks.slice(0, room));

  // A new draft (or a different set offered): start from the first that fit.
  // Only then: an edit elsewhere on Today mustn't wipe what the user ticked.
  const draftKey = `${draft.forDate}:${draft.tasks.join("\n")}`;
  useEffect(() => {
    setSelected(draft.tasks.slice(0, room));
    // Keyed on the draft only (see above); room is handled just below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  // Room shrank (a task was added): keep the user's picks, trimmed to fit.
  useEffect(() => {
    setSelected((current) => (current.length > room ? current.slice(0, room) : current));
  }, [room]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // In the draft's order, whatever order they were ticked in.
  const picked = draft.tasks.filter((text) => selectedSet.has(text));
  const count = picked.length;
  const fits = Math.min(draft.tasks.length, room);
  const allTicked = count > 0 && count === fits;
  const skipped = draft.tasks.length - count;
  const because = draft.because ? morningPerspective(draft.because) : "";

  const toggle = (text: string) => {
    setSelected((current) => {
      if (current.includes(text)) return current.filter((item) => item !== text);
      if (current.length >= room) return current;
      return [...current, text];
    });
  };

  const useLabel = allTicked ? (count === 1 ? "Use this" : "Use these") : `Add ${count}`;

  return (
    <View
      className="rounded-3xl border p-5 gap-3"
      style={{ borderColor: colors.primary, backgroundColor: `${colors.primary}0f` }}
      testID="tomorrow-draft"
    >
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 20 }}>
            {fits >= 3 ? "Your three for today" : "Ready for today"}
          </Text>
          {because ? (
            <Text className="text-sm" style={{ color: colors.muted }}>
              {because}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          accessibilityHint="Hides last night's plan"
          hitSlop={10}
        >
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <View
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: colors.border, backgroundColor: colors.background }}
      >
        {draft.tasks.map((text, index) => {
          const on = selectedSet.has(text);
          const full = !on && count >= room;
          return (
            <View key={text}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 52 }} /> : null}
              <Pressable
                onPress={() => toggle(text)}
                disabled={full}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: full }}
                accessibilityLabel={text}
                accessibilityHint={full ? "Today is full. Untick another one first." : undefined}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 44,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  opacity: full ? 0.5 : 1,
                }}
                testID="tomorrow-draft-task"
              >
                <Ionicons
                  name={on ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={on ? colors.primary : colors.muted}
                  accessibilityElementsHidden
                />
                <Text className="flex-1 text-base text-foreground" style={{ fontWeight: "600" }}>
                  {text}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      {count === 0 ? (
        <Text className="text-sm" style={{ color: colors.muted }} testID="tomorrow-draft-hint">
          Tick the ones you want, or tap Change to start over.
        </Text>
      ) : skipped > 0 ? (
        <Text className="text-sm" style={{ color: colors.muted }} testID="tomorrow-draft-hint">
          {skipped === 1 ? "The unticked one is saved for later." : "Unticked ones are saved for later."}
        </Text>
      ) : null}
      <View className="flex-row gap-3 mt-1">
        <Pressable
          onPress={() => onUse(picked)}
          disabled={count === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: count === 0 }}
          accessibilityLabel={
            count === 0
              ? "Use these"
              : allTicked
                ? count === 1
                  ? "Use this task"
                  : `Use these ${count} tasks`
                : count === 1
                  ? "Add 1 task"
                  : `Add ${count} tasks`
          }
          accessibilityHint={count === 0 ? "Tick at least one task first" : undefined}
          className="flex-1 rounded-2xl py-3 items-center"
          style={{ backgroundColor: colors.primary, opacity: count === 0 ? 0.5 : 1 }}
          testID="tomorrow-draft-use"
        >
          <Text style={{ color: colors.onPrimary, fontWeight: "700", fontSize: 16 }}>
            {count === 0 ? "Use these" : useLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={onChange}
          accessibilityRole="button"
          accessibilityLabel="Change: brain dump instead"
          className="flex-1 rounded-2xl py-3 items-center border"
          style={{ borderColor: colors.border }}
        >
          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 16 }}>Change</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** After the evening check-in: the coach's note and tomorrow's draft. */
export function EveningResult({
  closing,
  note,
  draft,
}: {
  closing: boolean;
  note: string | null;
  draft: TomorrowDraft | null;
}) {
  const colors = useColors();
  if (closing) {
    return (
      <View className="flex-row items-center gap-2 py-2" accessibilityLiveRegion="polite" testID="evening-closing">
        <ActivityIndicator color={colors.primary} />
        <Text className="text-sm" style={{ color: colors.muted }}>
          Drafting tomorrow…
        </Text>
      </View>
    );
  }
  if (!note && !draft) return null;
  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-2" testID="evening-result">
      {note ? <Text className="text-base text-foreground">{note}</Text> : null}
      {draft ? (
        <View className="gap-1 mt-1">
          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
            Tomorrow&apos;s three are ready
          </Text>
          {draft.tasks.map((text) => (
            <Text key={text} className="text-sm" style={{ color: colors.muted }}>
              · {text}
            </Text>
          ))}
        </View>
      ) : (
        <Text className="text-sm" style={{ color: colors.muted }}>
          Tomorrow starts fresh. Pick three when you&apos;re ready.
        </Text>
      )}
    </View>
  );
}
