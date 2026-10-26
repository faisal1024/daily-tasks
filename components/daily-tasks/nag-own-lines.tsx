// Settings › Reminders › Nag (1.6 G, Plus): "In your own words", up to five
// short lines of the user's own, mixed into the day's nags (at most one in
// three, never two in a row; nag-own-lines.ts). Kept on the phone only:
// never sent to the AI service or to analytics.

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import {
  checkNagOwnLine,
  MAX_NAG_OWN_LINE_CHARS,
  MAX_NAG_OWN_LINES,
  NAG_OWN_LINE_COUNTER_FROM,
  nagOwnLineNamesTask,
  nagOwnLineProblemMessage,
} from "@/lib/daily-tasks/nag-own-lines";
import { useDailyTasks } from "@/lib/daily-tasks/store";

export const NAG_OWN_LINES_HELP =
  "Up to 5 lines of your own, in the voice you picked. About one nag in three uses your lines. They stay on this phone.";
/** 1.6 G review: what {task} does, and a nudge to use it (a line naming a task by hand goes quiet once that task is done). */
export const NAG_OWN_LINES_TASK_HELP =
  "{task} becomes the task's name, so the line always fits the nag. Use it instead of writing a task's name.";
export const NAG_OWN_LINES_HIDDEN_NOTE = "With task names hidden, lines with {task} aren't used.";
export const NAG_OWN_LINES_EMPTY = "None yet. Built-in lines are used.";
export const nagOwnLinesFullNote = (count: number) => `${count} of ${MAX_NAG_OWN_LINES} lines`;

export function NagOwnLines() {
  const colors = useColors();
  const { state, setNagOwnLines } = useDailyTasks();
  const lines = state.notifications.nagOwnLines ?? [];
  const hideNames = state.notifications.hideTaskNames === true;
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const full = lines.length >= MAX_NAG_OWN_LINES;

  const add = () => {
    const checked = checkNagOwnLine(draft, lines);
    if (checked.problem) {
      const message = nagOwnLineProblemMessage(checked.problem, draft);
      setProblem(message);
      announcePolitely(message);
      return;
    }
    setNagOwnLines([...lines, checked.text]);
    setDraft("");
    setProblem(null);
    announcePolitely("Line added");
  };

  const remove = (index: number) => {
    setNagOwnLines(lines.filter((_, at) => at !== index));
    announcePolitely("Line removed");
  };

  return (
    <View className="gap-2" testID="settings-nag-own-lines">
      <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">
        In your own words
      </Text>
      <Text className="text-xs" style={{ color: colors.muted }}>
        {NAG_OWN_LINES_HELP}
      </Text>
      <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-own-task-help">
        {NAG_OWN_LINES_TASK_HELP}
      </Text>
      {hideNames && lines.some(nagOwnLineNamesTask) ? (
        <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-own-hidden">
          {NAG_OWN_LINES_HIDDEN_NOTE}
        </Text>
      ) : null}
      {lines.length === 0 ? (
        <Text className="text-sm" style={{ color: colors.muted }} testID="settings-nag-own-empty">
          {NAG_OWN_LINES_EMPTY}
        </Text>
      ) : null}
      {lines.map((line, index) => (
        <View key={`${index}:${line}`} className="flex-row items-center gap-2" style={{ minHeight: 44 }}>
          <Text className="flex-1 text-sm text-foreground" testID={`settings-nag-own-line-${index}`}>
            {line}
          </Text>
          <Pressable
            onPress={() => remove(index)}
            accessibilityRole="button"
            accessibilityLabel={`Remove: ${line}`}
            hitSlop={8}
            className="items-center justify-center"
            style={{ minHeight: 44, minWidth: 44 }}
            testID={`settings-nag-own-remove-${index}`}
          >
            <Ionicons name="close-circle-outline" size={22} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      {full ? (
        <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-own-full">
          {nagOwnLinesFullNote(lines.length)}
        </Text>
      ) : (
        <View className="flex-row items-center gap-2">
          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (problem) setProblem(null);
            }}
            onSubmitEditing={add}
            placeholder="e.g. I'm not asking again. {task}."
            placeholderTextColor={colors.muted}
            accessibilityLabel="Your own nag line"
            returnKeyType="done"
            maxLength={MAX_NAG_OWN_LINE_CHARS}
            className="flex-1 text-sm text-foreground rounded-xl px-3 py-2.5"
            style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, minHeight: 44 }}
            testID="settings-nag-own-input"
          />
          <Pressable
            onPress={add}
            accessibilityRole="button"
            accessibilityLabel="Add line"
            className="rounded-full px-4 items-center justify-center"
            style={{ minHeight: 44, backgroundColor: `${colors.primary}16` }}
            testID="settings-nag-own-add"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Add
            </Text>
          </Pressable>
        </View>
      )}
      {!full && Array.from(draft).length >= NAG_OWN_LINE_COUNTER_FROM ? (
        <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-own-counter" accessibilityLiveRegion="polite">
          {`${Array.from(draft).length} of ${MAX_NAG_OWN_LINE_CHARS} characters`}
        </Text>
      ) : null}
      {problem ? (
        <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-own-problem">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}
