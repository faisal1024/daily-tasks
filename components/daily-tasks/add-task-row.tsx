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

interface AddTaskRowProps {
  onAdd: (text: string) => void;
  remainingSlots: number;
}

export function AddTaskRow({ onAdd, remainingSlots }: AddTaskRowProps) {
  const colors = useColors();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<TextInputType | null>(null);

  useEffect(() => {
    if (editing) {
      const t = setTimeout(() => ref.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [editing]);

  if (remainingSlots <= 0) return null;

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) onAdd(trimmed);
    setText("");
    setEditing(false);
  };

  if (!editing) {
    return (
      <Pressable
        onPress={() => setEditing(true)}
        className="flex-row items-center gap-3 p-4 rounded-2xl border-2 border-dashed"
        style={{ borderColor: colors.border }}
      >
        <View
          className="w-7 h-7 rounded-full items-center justify-center"
          style={{ backgroundColor: colors.primary }}
        >
          <Ionicons name="add" size={18} color={colors.background} />
        </View>
        <Text className="text-base" style={{ color: colors.muted }}>
          Add a task
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      className="flex-row items-center gap-3 p-4 rounded-2xl bg-surface border border-border"
    >
      <View
        className="w-7 h-7 rounded-full items-center justify-center"
        style={{ backgroundColor: colors.primary }}
      >
        <Ionicons name="add" size={18} color={colors.background} />
      </View>
      <TextInput
        ref={ref}
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        onBlur={submit}
        placeholder="What's important today?"
        placeholderTextColor={colors.muted}
        returnKeyType="done"
        maxLength={80}
        className="flex-1 text-base text-foreground py-1"
        style={{ color: colors.foreground }}
      />
    </View>
  );
}
