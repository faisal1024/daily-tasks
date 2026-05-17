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
  forceEditing?: boolean;
  onEditingHandled?: () => void;
}

export function AddTaskRow({
  onAdd,
  remainingSlots,
  disabled = false,
  slotNumber,
  forceEditing = false,
  onEditingHandled,
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

  useEffect(() => {
    if (!forceEditing || disabled) return;
    setEditing(true);
    onEditingHandled?.();
  }, [disabled, forceEditing, onEditingHandled]);

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

  if (!editing) {
    return (
      <Pressable
        onPress={() => {
          if (!disabled) setEditing(true);
        }}
        disabled={disabled}
        className="flex-row items-center gap-3 p-4 rounded-2xl border-2 border-dashed min-h-24"
        style={{ borderColor: colors.border, opacity: disabled ? 0.45 : 1 }}
      >
        <View
          className="w-10 h-10 rounded-2xl items-center justify-center"
          style={{
            backgroundColor: disabled ? colors.border : `${colors.primary}18`,
          }}
        >
          {slotNumber ? (
            <Text
              className="text-base font-bold"
              style={{ color: disabled ? colors.muted : colors.primary }}
            >
              {slotNumber}
            </Text>
          ) : (
            <Ionicons
              name="add"
              size={18}
              color={disabled ? colors.muted : colors.primary}
            />
          )}
        </View>
        <View className="flex-1 gap-1">
          <Text
            className="text-base font-semibold"
            style={{ color: disabled ? colors.muted : colors.foreground }}
          >
            {disabled ? "Left intentionally open" : "Choose this focus"}
          </Text>
          <Text className="text-sm" style={{ color: colors.muted }}>
            {disabled
              ? "Today's Three is already set."
              : "Add one meaningful thing for today."}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View className="flex-row items-center gap-3 p-4 rounded-2xl bg-surface border border-border min-h-24">
      <View
        className="w-10 h-10 rounded-2xl items-center justify-center"
        style={{ backgroundColor: `${colors.primary}18` }}
      >
        <Text className="text-base font-bold" style={{ color: colors.primary }}>
          {slotNumber ?? "+"}
        </Text>
      </View>
      <TextInput
        ref={ref}
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        onBlur={submit}
        placeholder="What deserves this focus slot?"
        placeholderTextColor={colors.muted}
        returnKeyType="done"
        maxLength={200}
        className="flex-1 text-base text-foreground py-1"
        style={{ color: colors.foreground }}
      />
    </View>
  );
}
