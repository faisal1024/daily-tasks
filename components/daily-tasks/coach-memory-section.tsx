import { useMemo, useState, type Ref } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { SectionLabel } from "@/components/daily-tasks/section-label";
import { useColors } from "@/hooks/use-colors";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { buildBasicMemory, MAX_COACH_MEMORY, memorySentences } from "@/lib/daily-tasks/coach-memory";
import { useDailyTasks } from "@/lib/daily-tasks/store";

export const CLEAR_MEMORY_TITLE = "Clear what your coach remembers?";
export const CLEAR_MEMORY_MESSAGE = "This forgets the patterns your coach noticed. Your history and streaks stay.";
export const CLEAR_MEMORY_MESSAGE_PLUS =
  "This deletes your coach's notes and forgets the patterns. Your history and streaks stay.";
export const MEMORY_CLEARED_NOTE = "Memory cleared.";
export const NO_COACH_NOTES = "Nothing yet. After an evening check-in, your coach writes what it learned here.";
export const COACH_MEMORY_INTRO =
  "Worked out on your phone from the last 30 days. A short summary goes with brain dumps and suggestions so picks fit you. Nothing else leaves your phone.";
export const PLUS_NOTES_LINE = "Plus adds notes your coach writes after each evening check-in.";

/**
 * "What your coach remembers" (1.5, Settings, everyone): the basic memory in
 * plain sentences (worked out on the phone from the last 30 days), and for
 * Plus the AI coach's own notes, which can be edited. "Clear memory" (with
 * a confirm) empties the notes and starts the basic memory again from
 * tomorrow; the history itself stays.
 */
export function CoachMemorySection({ headerRef }: { headerRef?: Ref<View> } = {}) {
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
        <SectionLabel icon="bulb-outline" label="What your coach remembers" viewRef={headerRef} />
        <Text className="text-sm mt-0.5" style={{ color: colors.muted }}>
          {COACH_MEMORY_INTRO}
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
                <Text className="text-xs" style={{ color: colors.muted }} testID="coach-memory-budget">
                  {`${Array.from(draft).length} of ${MAX_COACH_MEMORY} characters`}
                </Text>
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={save}
                    accessibilityRole="button"
                    accessibilityLabel="Save your coach's notes"
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
                    accessibilityLabel="Cancel editing your coach's notes"
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
        ) : (
          <Text className="text-sm" style={{ color: colors.muted }} testID="coach-memory-plus-line">
            {PLUS_NOTES_LINE}
          </Text>
        )}

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
