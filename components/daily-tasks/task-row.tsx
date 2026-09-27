import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type TextInput as TextInputType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";

import { BodyFont } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import type { Task } from "@/lib/daily-tasks/types";

interface TaskRowProps {
  task: Task;
  completed: boolean;
  /** The next task to do: bigger, with its secondary actions shown. */
  hero?: boolean;
  /** Adding, editing and removing are paused once the day is set. */
  editable: boolean;
  index: number;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  /** Save it for later instead of doing it today. */
  onNotToday: () => void;
  onBreakDown?: () => void;
  breakingDown?: boolean;
  breakDownDisabled?: boolean;
  breakDownNeedsPlus?: boolean;
  onToggleStep?: (stepId: string) => void;
  onClearSteps?: () => void;
}

const ACTION_WIDTH = 84;

/**
 * One row of Today's card. Tap the circle to finish it, tap the words to edit
 * (or, once the day is set, to finish it), swipe left for Not today / Delete.
 * VoiceOver gets the same actions from the rotor.
 */
export function TaskRow({
  task,
  completed,
  hero = false,
  editable,
  index,
  onToggle,
  onEdit,
  onDelete,
  onNotToday,
  onBreakDown,
  breakingDown = false,
  breakDownDisabled = false,
  breakDownNeedsPlus = false,
  onToggleStep,
  onClearSteps,
}: TaskRowProps) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const inputRef = useRef<TextInputType | null>(null);
  const swipeRef = useRef<SwipeableMethods | null>(null);

  useEffect(() => {
    if (!editable && editing) setEditing(false);
  }, [editable, editing]);
  useEffect(() => {
    if (!editing) setDraft(task.text);
  }, [editing, task.text]);
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editing]);

  // A small bounce when it's checked off (not on first render, not with Reduce Motion).
  const checkScale = useSharedValue(1);
  const wasCompleted = useRef(completed);
  useEffect(() => {
    if (completed && !wasCompleted.current && !reduceMotion) {
      checkScale.value = withSequence(withSpring(1.25, { damping: 6 }), withSpring(1));
    }
    wasCompleted.current = completed;
  }, [completed, checkScale, reduceMotion]);
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) onEdit(trimmed);
    setEditing(false);
  };

  const act = (fn: () => void) => {
    swipeRef.current?.close();
    fn();
  };

  const a11yActions = editable
    ? [
        { name: "edit", label: "Edit" },
        { name: "notToday", label: "Not today" },
        { name: "delete", label: "Delete" },
      ]
    : [];
  const onA11yAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "edit") setEditing(true);
    else if (event.nativeEvent.actionName === "notToday") onNotToday();
    else if (event.nativeEvent.actionName === "delete") onDelete();
  };

  const renderActions = () => (
    <View className="flex-row" testID={`row-actions-${task.id}`}>
      <Pressable
        onPress={() => act(onNotToday)}
        accessibilityRole="button"
        accessibilityLabel={`Not today: ${task.text}`}
        style={{ width: ACTION_WIDTH, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.primary }}
      >
        <Ionicons name="bookmark-outline" size={20} color="#fff" />
        <Text style={{ color: "#fff", fontFamily: BodyFont.bold, fontSize: 13 }}>Not today</Text>
      </Pressable>
      <Pressable
        onPress={() => act(onDelete)}
        accessibilityRole="button"
        accessibilityLabel={`Delete: ${task.text}`}
        style={{ width: ACTION_WIDTH, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.error }}
      >
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={{ color: "#fff", fontFamily: BodyFont.bold, fontSize: 13 }}>Delete</Text>
      </Pressable>
    </View>
  );

  const hasSteps = Boolean(task.steps && task.steps.length > 0);
  const textSize = hero ? 21 : completed ? 15 : 17;

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={editable && !editing}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderActions}
    >
      <View
        className="flex-row gap-3"
        style={{
          backgroundColor: colors.surface,
          paddingHorizontal: 16,
          paddingVertical: hero ? 18 : completed ? 10 : 14,
          alignItems: hero ? "flex-start" : "center",
        }}
        testID={`task-row-${task.id}`}
      >
        {/* Fixed-width column so the words line up whatever the circle's size. */}
        <Animated.View style={[{ width: 30, alignItems: "center" }, checkStyle, hero ? { marginTop: 18 } : null]}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: completed }}
            accessibilityLabel={`Task ${index + 1}: ${task.text}`}
            accessibilityHint={completed ? "Marks it not done" : "Marks it done"}
            accessibilityActions={a11yActions}
            onAccessibilityAction={onA11yAction}
            onPress={onToggle}
            hitSlop={8}
            style={{
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 99,
              width: completed ? 24 : 30,
              height: completed ? 24 : 30,
              borderWidth: 2,
              borderColor: completed ? colors.success : hero ? colors.primary : colors.border,
              backgroundColor: completed ? colors.success : "transparent",
            }}
          >
            {completed ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
          </Pressable>
        </Animated.View>

        <View className="flex-1 gap-1">
          {hero ? (
            <Text
              className="text-xs font-bold uppercase"
              style={{ color: colors.primary, letterSpacing: 0.6 }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              Up next
            </Text>
          ) : null}

          {editing ? (
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              onBlur={commit}
              onSubmitEditing={commit}
              returnKeyType="done"
              maxLength={80}
              accessibilityLabel={`Edit task ${index + 1}`}
              style={{ color: colors.foreground, fontFamily: BodyFont.semibold, fontSize: textSize, paddingVertical: 2 }}
            />
          ) : (
            <Pressable
              onPress={() => (editable && !completed ? setEditing(true) : onToggle())}
              hitSlop={4}
              // The checkbox already announces this task, its state and actions.
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text
                style={{
                  color: completed ? colors.muted : colors.foreground,
                  fontFamily: hero ? BodyFont.bold : BodyFont.semibold,
                  fontSize: textSize,
                  lineHeight: Math.round(textSize * 1.3),
                  textDecorationLine: completed ? "line-through" : "none",
                }}
                numberOfLines={completed ? 1 : undefined}
              >
                {task.text}
              </Text>
            </Pressable>
          )}

          {task.carriedOver && !completed && !editing ? (
            <Text className="text-xs" style={{ color: colors.warning }}>
              From yesterday
            </Text>
          ) : null}

          {!editing && !completed && hasSteps ? (
            <View className="gap-1.5 mt-1" testID={`steps-${task.id}`}>
              {task.steps?.map((step, stepIndex) => (
                <Pressable
                  key={step.id}
                  onPress={() => onToggleStep?.(step.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: step.done }}
                  accessibilityLabel={`Step ${stepIndex + 1} of ${task.steps?.length}: ${step.text}`}
                  hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34 }}
                >
                  <Ionicons
                    name={step.done ? "checkbox" : "square-outline"}
                    size={19}
                    color={step.done ? colors.success : colors.muted}
                  />
                  <Text
                    className="flex-1 text-sm text-foreground"
                    style={{ textDecorationLine: step.done ? "line-through" : "none", opacity: step.done ? 0.6 : 1 }}
                  >
                    {step.text}
                  </Text>
                </Pressable>
              ))}
              {onClearSteps ? (
                <Pressable
                  onPress={onClearSteps}
                  accessibilityRole="button"
                  accessibilityLabel="Clear steps"
                  hitSlop={12}
                  className="self-start"
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
                    Clear steps
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Secondary actions: only on the next task, kept small. */}
          {hero && !editing && !completed ? (
            <View className="flex-row items-center gap-4 mt-1.5">
              {onBreakDown && !hasSteps ? (
                <Pressable
                  onPress={onBreakDown}
                  disabled={breakingDown || breakDownDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Break down ${task.text}`}
                  accessibilityHint={
                    breakDownNeedsPlus ? "Plus feature. Shows Plus plans." : "Splits this task into a few tiny steps"
                  }
                  accessibilityState={{ busy: breakingDown, disabled: breakingDown || breakDownDisabled }}
                  hitSlop={10}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: breakDownDisabled ? 0.4 : 1 }}
                >
                  {breakingDown ? (
                    <ActivityIndicator size="small" color={colors.muted} />
                  ) : (
                    <Ionicons name="list-outline" size={14} color={colors.muted} />
                  )}
                  <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
                    {breakingDown ? "Breaking it down…" : "Break it down"}
                  </Text>
                  {breakDownNeedsPlus && !breakingDown ? (
                    <View
                      className="rounded-full px-1.5 flex-row items-center gap-0.5"
                      style={{ backgroundColor: `${colors.primary}1f` }}
                      testID="break-down-plus"
                    >
                      <Ionicons name="sparkles" size={10} color={colors.primary} />
                      <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                        Plus
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : null}
              {editable ? (
                <Pressable
                  onPress={onNotToday}
                  accessibilityRole="button"
                  accessibilityLabel={`Not today: ${task.text}`}
                  accessibilityHint="Saves it for later"
                  hitSlop={10}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Ionicons name="bookmark-outline" size={14} color={colors.muted} />
                  <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
                    Not today
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </ReanimatedSwipeable>
  );
}
