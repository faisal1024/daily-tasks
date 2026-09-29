import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInput as TextInputType,
  type TextInputSubmitEditingEventData,
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
  // Uncontrolled (1.3 polish): a controlled `value` re-rendered on every key
  // could drop characters typed fast, and a submit could read a stale state.
  // The field owns its text; this ref only mirrors it for submit and blur.
  const textRef = useRef("");
  // One add per edit, whichever of Return and blur comes first (and however
  // many times): reset each time the field opens.
  const submittedRef = useRef(false);
  const ref = useRef<TextInputType | null>(null);

  useEffect(() => {
    if (editing) {
      submittedRef.current = false;
      const t = setTimeout(() => ref.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [editing]);

  useEffect(() => {
    if (disabled) {
      setEditing(false);
      textRef.current = "";
    }
  }, [disabled]);

  if (remainingSlots <= 0) return null;

  // Return passes the field's own text (the latest, whatever has rendered);
  // blur reads the ref. Only the first of them adds (submittedRef).
  const submit = (event?: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const latest = typeof event?.nativeEvent?.text === "string" ? event.nativeEvent.text : textRef.current;
    textRef.current = "";
    if (disabled) {
      setEditing(false);
      return;
    }
    const trimmed = latest.trim();
    if (trimmed) onAdd(trimmed);
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
        <Text
          className="text-xs font-bold"
          style={{ color: disabled ? colors.muted : colors.primary }}
          maxFontSizeMultiplier={1.2}
        >
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
        defaultValue=""
        onChangeText={(value) => {
          textRef.current = value;
        }}
        onSubmitEditing={submit}
        onBlur={() => submit()}
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
