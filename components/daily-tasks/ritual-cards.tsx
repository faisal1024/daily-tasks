import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { BodyFont, Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
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
          <Ionicons name="sparkles" size={20} color="#fff" accessibilityElementsHidden />
          <Text style={{ color: "#fff", fontFamily: Fonts.rounded, fontSize: 22 }}>
            What&apos;s on your mind today?
          </Text>
        </View>
        <Text style={{ color: "rgba(255,255,255,0.88)", fontSize: 15 }}>
          Dump it all, by typing or talking. We&apos;ll pick your three and save the rest.
        </Text>
        <View
          className="self-start rounded-full px-4 py-2 mt-1"
          style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
        >
          <Text style={{ color: "#fff", fontFamily: BodyFont.bold, fontSize: 15 }}>
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

/** Last night's draft of today's three: use it in one tap, or change it. */
export function TomorrowDraftCard({
  draft,
  remainingSlots,
  onUse,
  onChange,
  onDismiss,
}: {
  draft: TomorrowDraft;
  remainingSlots: number;
  onUse: () => void;
  onChange: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const tasks = draft.tasks.slice(0, Math.max(0, remainingSlots));
  return (
    <View
      className="rounded-3xl border p-5 gap-3"
      style={{ borderColor: colors.primary, backgroundColor: `${colors.primary}0f` }}
      testID="tomorrow-draft"
    >
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontSize: 20 }}>
            {tasks.length >= 3 ? "Your three for today" : "Ready for today"}
          </Text>
          {draft.because ? (
            <Text className="text-sm" style={{ color: colors.muted }}>
              {draft.because}
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
      <View className="gap-2">
        {tasks.map((text) => (
          <View key={text} className="flex-row items-center gap-2">
            <Ionicons name="ellipse-outline" size={16} color={colors.primary} accessibilityElementsHidden />
            <Text className="flex-1 text-base text-foreground" style={{ fontFamily: BodyFont.semibold }}>
              {text}
            </Text>
          </View>
        ))}
      </View>
      <View className="flex-row gap-3 mt-1">
        <Pressable
          onPress={onUse}
          accessibilityRole="button"
          accessibilityLabel={tasks.length === 1 ? "Use this task" : `Use these ${tasks.length} tasks`}
          className="flex-1 rounded-2xl py-3 items-center"
          style={{ backgroundColor: colors.primary }}
          testID="tomorrow-draft-use"
        >
          <Text style={{ color: "#fff", fontFamily: BodyFont.bold, fontSize: 16 }}>
            {tasks.length === 1 ? "Use this" : "Use these"}
          </Text>
        </Pressable>
        <Pressable
          onPress={onChange}
          accessibilityRole="button"
          accessibilityLabel="Change: brain dump instead"
          className="flex-1 rounded-2xl py-3 items-center border"
          style={{ borderColor: colors.border }}
        >
          <Text style={{ color: colors.primary, fontFamily: BodyFont.bold, fontSize: 16 }}>Change</Text>
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
