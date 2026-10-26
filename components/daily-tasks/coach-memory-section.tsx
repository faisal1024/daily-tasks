import { useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { SectionLabel } from "@/components/daily-tasks/section-label";
import { useColors } from "@/hooks/use-colors";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { buildBasicMemory, MAX_COACH_MEMORY, memorySentences } from "@/lib/daily-tasks/coach-memory";
import { useDailyTasks } from "@/lib/daily-tasks/store";

export const CLEAR_MEMORY_TITLE = "Clear what your coach remembers?";
export const CLEAR_MEMORY_MESSAGE =
  "Your coach starts noticing again from tomorrow. Your history and streaks stay.";
export const CLEAR_MEMORY_MESSAGE_PLUS =
  "Your coach's notes are deleted, and it starts noticing again from tomorrow. Your history and streaks stay.";
export const MEMORY_CLEARED_NOTE = "Memory cleared.";
export const NO_COACH_NOTES = "Nothing yet. After an evening check-in, your coach writes what it learned here.";

/**
 * "What your coach remembers" (1.5, Settings, everyone): the basic memory in
 * plain sentences (worked out on the phone from the last 30 days), and for
 * Plus the AI coach's own notes, which can be edited. "Clear memory" (with
 * a confirm) empties the notes and starts the basic memory again from
 * tomorrow; the history itself stays.
 */
export function CoachMemorySection() {
  const colors = useColors();
  const { state, today, hasPlus, setCoachMemory, clearCoachMemory } = useDailyTasks();
  const clearedAt = state.memoryClearedAt ?? null;
  const memory = useMemo(() => buildBasicMemory(state.history, today, clearedAt), [state.history, today, clearedAt]);
  const sentences = memorySentences(memory);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const notes = state.coachMemory;
  const hasSomething = memory.total > 0 || Boolean(notes);

  const startEditing = () => {
    setDraft(notes ?? "");
    setEditing(true);
  };
  const save = () => {
    setCoachMemory(draft);
    setEditing(false);
  };
  const confirmClear = () => {
    Alert.alert(CLEAR_MEMORY_TITLE, hasPlus ? CLEAR_MEMORY_MESSAGE_PLUS : CLEAR_MEMORY_MESSAGE, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          clearCoachMemory();
          setEditing(false);
          announcePolitely(MEMORY_CLEARED_NOTE);
        },
      },
    ]);
  };

  return (
    <View className="gap-3" testID="coach-memory-section">
      <View className="gap-1.5">
        <SectionLabel icon="bulb-outline" label="What your coach remembers" />
        <Text className="text-sm mt-0.5" style={{ color: colors.muted }}>
          Worked out on your phone from your last 30 days. A short summary goes with brain dumps and suggestions so your coach can use it.
        </Text>
      </View>
      <View className="bg-surface rounded-2xl p-4 border border-border gap-4">
        <View className="gap-2" testID="coach-memory-basic">
          {sentences.map((sentence) => (
            <Text key={sentence} className="text-sm text-foreground">
              {sentence}
            </Text>
          ))}
        </View>

        {hasPlus ? (
          <View className="gap-2" testID="coach-memory-notes">
            <Text className="text-base font-semibold text-foreground">Your coach&apos;s notes</Text>
            {editing ? (
              <>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  autoFocus
                  maxLength={MAX_COACH_MEMORY}
                  accessibilityLabel="Your coach's notes"
                  className="rounded-2xl border p-3 text-sm"
                  style={{
                    minHeight: 96,
                    textAlignVertical: "top",
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  }}
                />
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={save}
                    accessibilityRole="button"
                    className="rounded-full px-4 py-2"
                    style={{ backgroundColor: colors.primary, minHeight: 36 }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: colors.onPrimary }}>
                      Save
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditing(false)}
                    accessibilityRole="button"
                    className="rounded-full px-4 py-2"
                    style={{ backgroundColor: `${colors.primary}16`, minHeight: 36 }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                      Cancel
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text className="text-sm" style={{ color: notes ? colors.foreground : colors.muted }}>
                  {notes ?? NO_COACH_NOTES}
                </Text>
                <Pressable
                  onPress={startEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Edit your coach's notes"
                  className="self-start rounded-full px-4 py-2"
                  style={{ backgroundColor: `${colors.primary}16` }}
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    Edit
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}

        {hasSomething ? (
          <Pressable
            onPress={confirmClear}
            accessibilityRole="button"
            accessibilityLabel="Clear memory"
            accessibilityHint="Asks first. Your history and streaks stay."
            className="self-start py-1"
            hitSlop={8}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.error }}>
              Clear memory
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
