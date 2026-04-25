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
import type { Task } from "@/lib/daily-tasks/types";

interface TaskCardProps {
  task: Task;
  completed: boolean;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function TaskCard({
  task,
  completed,
  onToggle,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: TaskCardProps) {
  const colors = useColors();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const inputRef = useRef<TextInputType | null>(null);

  useEffect(() => {
    if (!canEdit && isEditing) {
      setIsEditing(false);
    }
  }, [canEdit, isEditing]);

  useEffect(() => {
    if (!isEditing) setDraft(task.text);
  }, [isEditing, task.text]);

  useEffect(() => {
    if (isEditing) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isEditing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) onEdit(trimmed);
    setIsEditing(false);
  };

  return (
    <View className="bg-surface border border-border rounded-2xl p-4">
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={`Mark ${task.text} as ${completed ? "incomplete" : "complete"}`}
          onPress={onToggle}
          hitSlop={8}
          className="w-7 h-7 rounded-full items-center justify-center border-2"
          style={{
            borderColor: completed ? colors.success : colors.border,
            backgroundColor: completed ? colors.success : "transparent",
          }}
        >
          {completed && <Ionicons name="checkmark" size={18} color={colors.background} />}
        </Pressable>

        <View className="flex-1">
          {isEditing ? (
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              onBlur={commit}
              onSubmitEditing={commit}
              returnKeyType="done"
              maxLength={80}
              className="text-base text-foreground py-1"
              style={{ color: colors.foreground }}
            />
          ) : (
            <Pressable onPress={onToggle} hitSlop={4}>
              <Text
                className="text-base text-foreground"
                style={{
                  textDecorationLine: completed ? "line-through" : "none",
                  opacity: completed ? 0.55 : 1,
                }}
              >
                {task.text}
              </Text>
            </Pressable>
          )}

          {task.carriedOver && !completed && !isEditing && (
            <Text className="text-xs mt-1" style={{ color: colors.warning }}>
              Carried over
            </Text>
          )}
        </View>

        <View className="flex-row items-center gap-2">
          {canEdit && isEditing ? (
            <Pressable
              onPress={commit}
              accessibilityLabel="Save task"
              hitSlop={8}
              className="p-2"
            >
              <Ionicons name="checkmark" size={20} color={colors.primary} />
            </Pressable>
          ) : canEdit ? (
            <Pressable
              onPress={() => setIsEditing(true)}
              accessibilityLabel="Edit task"
              hitSlop={8}
              className="p-2"
            >
              <Ionicons name="pencil" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
          {canDelete ? (
            <Pressable
              onPress={onDelete}
              accessibilityLabel="Delete task"
              hitSlop={8}
              className="p-2"
            >
              <Ionicons name="trash-outline" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
