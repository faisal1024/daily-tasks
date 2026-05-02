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

interface CompletionReflectionProps {
  value: string | null;
  onSave: (text: string) => void;
}

export function CompletionReflection({
  value,
  onSave,
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
            Finish note
          </Text>
          <Text className="text-sm" style={{ color: colors.muted }}>
            Optional: save one sentence about what helped you protect the day.
          </Text>
        </View>
      </View>

      {editing ? (
        <View className="gap-3">
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder="What helped you finish?"
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
