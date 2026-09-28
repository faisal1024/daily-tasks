import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { CoachNoteKind } from "@/lib/daily-tasks/coach-note";

/**
 * The Coach's note (1.2): one quiet line about the next open task, a tiny
 * first step in the morning or momentum later. VoiceOver reads it politely
 * when it changes (e.g. the AI line replacing the built-in one).
 *
 * `onStart` shows a Start button (focus mode on the next task, PR C); Today
 * doesn't pass it yet, so no button shows.
 */
export function CoachNote({
  text,
  kind,
  onStart,
}: {
  text: string;
  kind: CoachNoteKind;
  onStart?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      className="flex-row items-center gap-3 rounded-3xl border px-4 py-3"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      testID="coach-note"
    >
      <View
        className="flex-1 flex-row items-start gap-2"
        accessible
        accessibilityLabel={`Coach's note: ${text}`}
        accessibilityLiveRegion="polite"
      >
        <Ionicons
          name="sparkles"
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
