import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";

import { BodyFont } from "@/constants/theme";
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
  /** Ask the AI to split this task into steps; hidden when not provided. */
  onBreakDown?: () => void;
  breakingDown?: boolean;
  onToggleStep?: (stepId: string) => void;
  onClearSteps?: () => void;
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
  onBreakDown,
  breakingDown = false,
  onToggleStep,
  onClearSteps,
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

  // A small bounce when a task is checked off (not on first render).
  const checkScale = useSharedValue(1);
  const wasCompleted = useRef(completed);
  useEffect(() => {
    if (completed && !wasCompleted.current) {
      checkScale.value = withSequence(withSpring(1.25, { damping: 6 }), withSpring(1));
    }
    wasCompleted.current = completed;
  }, [completed, checkScale]);
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));
  const position = typeof index === "number" ? `Task ${index + 1}: ` : "";

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) onEdit(trimmed);
    setIsEditing(false);
  };

  const accent = completed ? colors.success : colors.primary;
  return (
    <View
      className="rounded-3xl p-5 min-h-24 border"
      style={{
        backgroundColor: completed ? `${colors.success}12` : colors.surface,
        borderColor: completed ? `${colors.success}40` : colors.border,
        shadowColor: colors.primary,
        shadowOpacity: 0.1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 3,
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          backgroundColor: accent,
          borderTopLeftRadius: 24,
          borderBottomLeftRadius: 24,
        }}
      />
      <View className="flex-row items-center gap-4 pl-1.5">
        <Animated.View style={checkStyle}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: completed }}
            accessibilityLabel={`${position}${task.text}`}
            accessibilityHint={completed ? "Marks it not done" : "Marks it done"}
            onPress={onToggle}
            hitSlop={6}
            className="w-11 h-11 rounded-full items-center justify-center border-2"
            style={{
              borderColor: completed ? colors.success : colors.border,
              backgroundColor: completed ? colors.success : "transparent",
            }}
          >
            {completed && <Ionicons name="checkmark" size={26} color={colors.background} />}
          </Pressable>
        </Animated.View>

        <View className="flex-1 gap-1">
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
            <Pressable
              onPress={onToggle}
              hitSlop={4}
              className="gap-1"
              // The checkbox already announces this task and its state.
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text
                className="text-xl text-foreground"
                style={{
                  fontFamily: BodyFont.bold,
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

          {!isEditing && task.steps && task.steps.length > 0 && (
            <View className="gap-1.5 mt-2" testID={`steps-${task.id}`}>
              {task.steps.map((step, stepIndex) => (
                <Pressable
                  key={step.id}
                  onPress={() => onToggleStep?.(step.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: step.done }}
                  accessibilityLabel={`Step ${stepIndex + 1} of ${task.steps?.length}: ${step.text}`}
                  hitSlop={4}
                  className="flex-row items-center gap-2 py-1"
                >
                  <Ionicons
                    name={step.done ? "checkbox" : "square-outline"}
                    size={20}
                    color={step.done ? colors.success : colors.muted}
                  />
                  <Text
                    className="flex-1 text-sm text-foreground"
                    style={{
                      textDecorationLine: step.done ? "line-through" : "none",
                      opacity: step.done ? 0.6 : 1,
                    }}
                  >
                    {step.text}
                  </Text>
                </Pressable>
              ))}
              {onClearSteps && (
                <Pressable
                  onPress={onClearSteps}
                  accessibilityRole="button"
                  accessibilityLabel="Clear steps"
                  hitSlop={8}
                  className="self-start mt-1"
                >
                  <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
                    Clear steps
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {!isEditing && !completed && onBreakDown && !(task.steps && task.steps.length > 0) && (
            <Pressable
              onPress={onBreakDown}
              disabled={breakingDown}
              accessibilityRole="button"
              accessibilityLabel={`Break down ${task.text}`}
              accessibilityHint="Splits this task into a few tiny steps"
              accessibilityState={{ busy: breakingDown, disabled: breakingDown }}
              hitSlop={10}
              className="self-start flex-row items-center gap-1.5 mt-1.5"
            >
              {breakingDown ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
              )}
              <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                {breakingDown ? "Breaking it down…" : "Break it down"}
              </Text>
            </Pressable>
          )}
        </View>

        <View className="flex-row items-center gap-2">
          {canEdit && isEditing ? (
            <Pressable
              onPress={commit}
              accessibilityRole="button"
              accessibilityLabel="Save task"
              hitSlop={8}
              className="p-2"
            >
              <Ionicons name="checkmark" size={20} color={colors.primary} />
            </Pressable>
          ) : canEdit ? (
            <Pressable
              onPress={() => setIsEditing(true)}
              accessibilityRole="button"
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
              accessibilityRole="button"
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
