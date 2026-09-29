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
 * `onStart` shows a Start button (1.3: a 5-minute starter on `taskText`, the
 * next task). With `timerRunning` (that task's timer is on) it's Open instead:
 * it opens focus mode and never restarts the timer.
 */
export function CoachNote({
  text,
  kind,
  source,
  taskText,
  onStart,
  timerRunning = false,
}: {
  text: string;
  kind: CoachNoteValue["kind"];
  source: CoachNoteValue["source"];
  /** The task the note is about, for the Start button's label. */
  taskText?: string;
  onStart?: () => void;
  timerRunning?: boolean;
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
          accessibilityLabel={`${timerRunning ? "Open" : "Start"}${taskText ? `: ${taskText}` : ""}`}
          accessibilityHint={timerRunning ? "Opens focus" : "Starts a 5-minute timer"}
          hitSlop={8}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: colors.primary,
            opacity: pressed ? 0.8 : 1,
          })}
          testID="coach-note-start-button"
        >
          <Text className="text-sm font-semibold" style={{ color: colors.onPrimary }}>
            {timerRunning ? "Open" : "Start"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
