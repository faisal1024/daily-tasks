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
  // null until the user ticks or unticks something: until then the ticks
  // follow the first that fit (so more room ticks more). The card is keyed on
  // the draft's day, so a new draft starts untouched.
  const [touched, setTouched] = useState<string[] | null>(null);
  // After a toggle, room shrinking or the offered list changing only trims
  // (in draft order); nothing comes back ticked by itself.
  useEffect(() => {
    setTouched((current) => {
      if (!current) return current;
      const kept = draft.tasks.filter((text) => current.includes(text)).slice(0, room);
      return kept.length === current.length ? current : kept;
    });
  }, [draft.tasks, room]);

  // In the draft's order, whatever order they were ticked in; only what's offered.
  const picked = useMemo(
    () => (touched === null ? draft.tasks.slice(0, room) : draft.tasks.filter((text) => touched.includes(text)).slice(0, room)),
    [draft.tasks, room, touched],
  );
  const selectedSet = new Set(picked);
  const count = picked.length;
  const fits = Math.min(draft.tasks.length, room);
  const allTicked = count > 0 && count === fits;
  const skipped = draft.tasks.length - count;
  const because = draft.because ? morningPerspective(draft.because) : "";
  // One slot and a choice of rows: picking one swaps it in, so VoiceOver
  // hears them as radio buttons; otherwise checkboxes.
  const pickOne = room === 1 && draft.tasks.length > 1;
  // More drafted than there's room for: say so (above the list), and let them pick.
  const roomLine =
    draft.tasks.length > room ? (room === 1 ? "Room for one more today. Pick which." : `Room for ${room} more today. Pick which.`) : null;
  const otherWords = ["", "one", "two", "three"];
  const savedLine =
    pickOne && count === 1 && skipped > 0
      ? skipped === 1
        ? "The other one is saved for later."
        : `The other ${otherWords[skipped] ?? skipped} are saved for later.`
      : count === 0
      ? "Tick the ones you want, or tap Change to start over."
      : skipped > 0
        ? `${skipped === 1 ? "The unticked one is saved for later." : "Unticked ones are saved for later."}${count < room ? " Fill the rest after." : ""}`
        : null;


  const toggle = (text: string) => {
    let next: string[];
    if (selectedSet.has(text)) {
      // A radio button can't be unticked: re-tapping the picked one does nothing.
      if (pickOne) return;
      next = picked.filter((item) => item !== text);
    }
    // One slot: picking another swaps it in (like a radio button).
    else if (room === 1) next = [text];
    else if (count >= room) return;
    else next = draft.tasks.filter((item) => item === text || selectedSet.has(item));
    setTouched(next);
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
      {roomLine ? (
        <Text className="text-sm" style={{ color: colors.muted }} testID="tomorrow-draft-room">
          {roomLine}
        </Text>
      ) : null}
      <View
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: colors.border, backgroundColor: colors.background }}
        accessibilityRole={pickOne ? "radiogroup" : undefined}
        accessibilityLabel={pickOne ? "Pick one for today" : undefined}
        testID="tomorrow-draft-list"
      >
        {draft.tasks.map((text, index) => {
          const on = selectedSet.has(text);
          // With one slot, any row can be picked (it swaps); otherwise a full day greys the rest.
          const full = !on && room > 1 && count >= room;
          return (
            <View key={`${index}:${text}`}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 52 }} /> : null}
              <Pressable
                onPress={() => toggle(text)}
                disabled={full}
                accessibilityRole={pickOne ? "radio" : "checkbox"}
                accessibilityState={{ checked: on, disabled: full }}
                accessibilityLabel={text}
                accessibilityHint={full ? "Untick another one first." : pickOne && !on && count > 0 ? "Picks this one instead." : undefined}
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
                  // Pick one: radio buttons, so it reads as a choice, not a checklist.
                  name={pickOne ? (on ? "radio-button-on" : "radio-button-off") : on ? "checkmark-circle" : "ellipse-outline"}
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
      {savedLine ? (
        <Text className="text-sm" style={{ color: colors.muted }} testID="tomorrow-draft-hint">
          {savedLine}
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
