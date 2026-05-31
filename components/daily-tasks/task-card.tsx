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
  index?: number;
}

export function TaskCard({
  task,
  completed,
  onToggle,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
  index,
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
    <View
      className="border rounded-3xl p-5 min-h-24"
      style={{
        backgroundColor: completed ? `${colors.success}14` : colors.surface,
        borderColor: completed ? `${colors.success}55` : colors.border,
      }}
    >
      <View className="flex-row items-center gap-4">
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={`Mark ${task.text} as ${completed ? "incomplete" : "complete"}`}
          onPress={onToggle}
          hitSlop={8}
          className="w-9 h-9 rounded-full items-center justify-center border-2"
          style={{
            borderColor: completed ? colors.success : colors.border,
            backgroundColor: completed ? colors.success : "transparent",
          }}
        >
          {completed && (
            <Ionicons name="checkmark" size={22} color={colors.background} />
          )}
        </Pressable>

        <View className="flex-1 gap-1">
          {typeof index === "number" && !isEditing && (
            <Text
              className="text-sm uppercase tracking-wide font-semibold"
              style={{ color: colors.primary }}
            >
              Focus {index + 1}
            </Text>
          )}
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
            <Pressable onPress={onToggle} hitSlop={4} className="gap-1">
              <Text
                className="text-lg font-semibold text-foreground"
                style={{
                  textDecorationLine: completed ? "line-through" : "none",
                  opacity: completed ? 0.62 : 1,
                }}
              >
                {task.text}
              </Text>
              {completed && (
                <Text className="text-sm font-medium" style={{ color: colors.success }}>
                  Finished
                </Text>
              )}
            </Pressable>
          )}

          {task.carriedOver && !completed && !isEditing && (
            <Text className="text-xs" style={{ color: colors.warning }}>
              Carried forward
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
