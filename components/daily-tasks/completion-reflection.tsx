import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { ReflectionResult } from "@/lib/daily-tasks/types";

interface CompletionReflectionProps {
  value: string | null;
  result: ReflectionResult | null;
  /** Also passes a note typed but not saved yet, so the close can use it. */
  onSelectResult: (result: ReflectionResult, typedNote?: string | null) => void;
  onSave: (text: string) => void;
  /** Offer "Didn't get to it" (not on a day where everything got done). */
  allowMissed?: boolean;
}

export function CompletionReflection({
  value,
  result,
  onSelectResult,
  onSave,
  allowMissed = false,
}: CompletionReflectionProps) {
  const colors = useColors();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<TextInputType | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editing]);

  const save = () => {
    onSave(draft);
    setEditing(false);
  };

  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
      <View className="flex-row items-start gap-3">
        <View
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: `${colors.success}18` }}
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={18}
            color={colors.success}
          />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold text-foreground">
            How did today feel?
          </Text>
          <Text className="text-sm" style={{ color: colors.muted }}>
            One tap and your coach drafts tomorrow&apos;s three. A note is optional.
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {(allowMissed ? [...REFLECTION_CHOICES, MISSED_CHOICE] : REFLECTION_CHOICES).map((choice) => {
          const selected = result === choice.value;
          return (
            <Pressable
              key={choice.value}
              onPress={() => {
                // A note being typed counts: save it, and pass it along.
                if (editing) save();
                onSelectResult(choice.value, editing ? draft : null);
              }}
              className="rounded-full px-3 py-2 border"
              style={{
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? `${colors.primary}16` : colors.background,
              }}
              accessibilityRole="button"
              accessibilityLabel={choice.a11y}
              accessibilityState={{ selected }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: selected ? colors.primary : colors.foreground }}
              >
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {editing ? (
        <View className="gap-3">
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder={allowMissed ? "Anything worth remembering about today?" : "What helped you finish?"}
            placeholderTextColor={colors.muted}
            multiline
            maxLength={160}
            className="rounded-2xl border border-border bg-background p-3 text-base text-foreground min-h-20"
            style={{ color: colors.foreground, textAlignVertical: "top" }}
          />
          <View className="flex-row gap-3">
            <Pressable
              onPress={save}
              className="rounded-full px-4 py-2"
              style={{ backgroundColor: colors.primary }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.background }}
              >
                Save note
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              className="rounded-full px-4 py-2 border border-border"
            >
              <Text className="text-sm font-semibold text-foreground">
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setEditing(true)}
          className="rounded-2xl border border-border bg-background p-3"
        >
          <Text className="text-base text-foreground">
            {value ? value : "Add a short reflection"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const REFLECTION_CHOICES: { value: ReflectionResult; label: string; a11y: string }[] = [
  { value: "easy", label: "Easy", a11y: "Today felt easy" },
  { value: "good", label: "Good", a11y: "Today felt good" },
  { value: "hard", label: "Hard", a11y: "Today felt hard" },
];

// Only offered when something is still open (never on a finished day).
const MISSED_CHOICE: { value: ReflectionResult; label: string; a11y: string } = {
  value: "missed",
  label: "Didn't get to it today",
  a11y: "I didn't get to it today",
};
