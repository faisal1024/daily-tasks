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
  disabled?: boolean;
  slotNumber?: number;
}

export function AddTaskRow({
  onAdd,
  remainingSlots,
  disabled = false,
  slotNumber,
}: AddTaskRowProps) {
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

  useEffect(() => {
    if (disabled) {
      setEditing(false);
      setText("");
    }
  }, [disabled]);

  if (remainingSlots <= 0) return null;

  const submit = () => {
    if (disabled) {
      setEditing(false);
      return;
    }
    const trimmed = text.trim();
    if (trimmed) onAdd(trimmed);
    setText("");
    setEditing(false);
  };

  // A row inside Today's card: an empty circle where the checkbox will be.
  const circle = (
    <View
      className="items-center justify-center rounded-full"
      style={{
        width: 30,
        height: 30,
        borderWidth: 2,
        borderStyle: "dashed",
        borderColor: disabled ? colors.border : `${colors.primary}80`,
      }}
    >
      {slotNumber ? (
        <Text className="text-xs font-bold" style={{ color: disabled ? colors.muted : colors.primary }}>
          {slotNumber}
        </Text>
      ) : (
        <Ionicons name="add" size={16} color={disabled ? colors.muted : colors.primary} />
      )}
    </View>
  );

  if (!editing) {
    return (
      <Pressable
        onPress={() => {
          if (!disabled) setEditing(true);
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={disabled ? "Left open on purpose" : `Add a task${slotNumber ? `, slot ${slotNumber}` : ""}`}
        accessibilityState={{ disabled }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: colors.surface,
        }}
      >
        {circle}
        <Text className="flex-1 text-base" style={{ color: colors.muted }}>
          {disabled ? "Left open on purpose" : "Add a task"}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      className="flex-row items-center gap-3"
      style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.surface }}
    >
      {circle}
      <TextInput
        ref={ref}
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        onBlur={submit}
        placeholder="What's one thing for today?"
        placeholderTextColor={colors.muted}
        returnKeyType="done"
        maxLength={80}
        accessibilityLabel="New task"
        className="flex-1 text-base text-foreground py-1"
        style={{ color: colors.foreground }}
      />
    </View>
  );
}
