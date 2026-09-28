import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { CoachNote as CoachNoteValue } from "@/lib/daily-tasks/coach-note";

/**
 * The Coach's note (1.2): one quiet line about the next open task, a tiny
 * first step until the first tick, momentum after. A surface fill without a
 * border, so it sits quieter than the task card. It's read in place by
 * VoiceOver, never announced (a line swapping in shouldn't interrupt).
 *
 * `onStart` shows a Start button (focus mode on the next task, PR C); Today
 * doesn't pass it yet, so no button shows.
 */
export function CoachNote({
  text,
  kind,
  source,
  onStart,
}: {
  text: string;
  kind: CoachNoteValue["kind"];
  source: CoachNoteValue["source"];
  onStart?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      className="flex-row items-center gap-3 rounded-3xl px-4 py-3"
      style={{ backgroundColor: colors.surface }}
      testID="coach-note"
    >
      <View
        className="flex-1 flex-row items-start gap-2"
        accessible
        accessibilityLabel={`Coach's note: ${text}`}
      >
        <Ionicons
          // Sparkles for the AI line; a leaf for the built-in one.
          name={source === "ai" ? "sparkles" : "leaf-outline"}
          size={16}
          color={colors.primary}
          style={{ marginTop: 2 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text className="flex-1 text-base text-foreground" testID={`coach-note-${kind}`}>
          {text}
        </Text>
      </View>
      {onStart && (
        <Pressable
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel="Start"
          accessibilityHint="Opens focus mode for the next task"
          hitSlop={8}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: colors.primary,
            opacity: pressed ? 0.8 : 1,
          })}
          testID="coach-note-start"
        >
          <Text className="text-sm font-semibold" style={{ color: "#fff" }}>
            Start
          </Text>
        </Pressable>
      )}
    </View>
  );
}
