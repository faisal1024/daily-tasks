import { useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  findNodeHandle,
  Platform,
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

import type { FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { RowCheckIn, RowSessionLine, RowTimerPill, useRowSessionClock } from "@/components/daily-tasks/row-timer";
import { useColors } from "@/hooks/use-colors";
import type { FocusSession } from "@/lib/daily-tasks/focus-session";
import {
  TASK_ROW_ACTION_LABELS,
  taskRowActions,
  type TaskRowAction,
} from "@/lib/daily-tasks/today-view";
import type { Task } from "@/lib/daily-tasks/types";

interface TaskRowBaseProps {
  task: Task;
  completed: boolean;
  /** The next task to do on a set day: bigger, with its secondary actions shown. */
  hero?: boolean;
  /** Adding, editing and deleting are paused once the day is set. */
  editable: boolean;
  index: number;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  /** Save it for later instead of doing it today (allowed on a set day). */
  onNotToday: () => void;
  onBreakDown?: () => void;
  breakingDown?: boolean;
  breakDownDisabled?: boolean;
  breakDownNeedsPlus?: boolean;
  onToggleStep?: (stepId: string) => void;
  onClearSteps?: () => void;
  /**
   * An open row's timer button: choose a length (1.3). `anchor` is the
   * button's node, for the action sheet's popover on iPad.
   */
  onTimer?: (anchor: number | null) => void;
  /**
   * Opens the focus screen: `"words"` for a tap on the timed task's words
   * (their menu moves to a long press meanwhile) or VoiceOver's Open focus,
   * `"timer"` for the pill at time's up.
   */
  onOpenTimer?: (via: "words" | "timer") => void;
}

/**
 * The focus session, when it's on this task (1.3, "one timer, on the task"):
 * its pill (ring, ⏸/▶ and time left) replaces ▶, and at zero the check-in
 * shows under the row. A session always comes with its controls.
 */
type TaskRowSessionProps =
  | { session?: null; controls?: FocusSessionControls }
  | { session: FocusSession | null; controls: FocusSessionControls };

type TaskRowProps = TaskRowBaseProps & TaskRowSessionProps;

const ACTION_WIDTH = 84;
/** The checkbox's VoiceOver action for the timer button. */
const START_TIMER_ACTION = "startTimer";
/** The checkbox's VoiceOver action for the timed task's focus screen. */
const OPEN_FOCUS_ACTION = "openFocus";
/** The row's words start after the circle's column (30) and the gap (12). */
const TEXT_INSET = 42;

/**
 * One row of Today's card. Only the circle finishes a task. Tapping the words
 * opens the row's menu (Edit, Not today, Break it down, Delete, as allowed);
 * swiping left shows Not today / Delete; VoiceOver gets the same actions.
 * While the focus session is on this task, tapping the words opens the focus
 * screen instead and a long press opens the menu.
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
  onTimer,
  session = null,
  controls,
  onOpenTimer,
}: TaskRowProps) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const inputRef = useRef<TextInputType | null>(null);
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const timerRef = useRef<View | null>(null);
  const committed = useRef(false);

  const hasSteps = Boolean(task.steps && task.steps.length > 0);
  const actions = taskRowActions({
    editable,
    completed,
    canBreakDown: Boolean(onBreakDown) && !hasSteps && !breakDownDisabled && !breakingDown,
  });
  const swipeActions = actions.filter((action) => action === "notToday" || action === "delete");

  useEffect(() => {
    if (!editable && editing) setEditing(false);
  }, [editable, editing]);
  useEffect(() => {
    if (!editing) setDraft(task.text);
  }, [editing, task.text]);
  useEffect(() => {
    if (!editing) return;
    committed.current = false;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editing]);
  // An open row mustn't stay open (and tappable) once its actions change,
  // e.g. the day was set meanwhile, or editing started.
  const swipeKey = swipeActions.join(",");
  useEffect(() => {
    swipeRef.current?.close();
  }, [swipeKey, editing]);

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

  // Submit and blur both land here: commit once.
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) onEdit(trimmed);
    setEditing(false);
  };

  const run = (action: TaskRowAction) => {
    swipeRef.current?.close();
    if (action === "edit") setEditing(true);
    else if (action === "notToday") onNotToday();
    else if (action === "breakDown") onBreakDown?.();
    else onDelete();
  };

  const openMenu = () => {
    if (actions.length === 0) return;
    const labels = actions.map((action) => TASK_ROW_ACTION_LABELS[action]);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: task.text,
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
          destructiveButtonIndex: actions.indexOf("delete") >= 0 ? actions.indexOf("delete") : undefined,
        },
        (picked) => {
          if (picked < actions.length) run(actions[picked]);
        },
      );
      return;
    }
    // Android shows at most three buttons: page through with "More…".
    const page = (list: TaskRowAction[]) => {
      const button = (action: TaskRowAction) => ({
        text: TASK_ROW_ACTION_LABELS[action],
        style: action === "delete" ? ("destructive" as const) : ("default" as const),
        onPress: () => run(action),
      });
      const shown = list.length <= 2 ? list.map(button) : [button(list[0]), { text: "More…", onPress: () => page(list.slice(1)) }];
      Alert.alert(task.text, undefined, [...shown, { text: "Cancel", style: "cancel" as const }]);
    };
    page(actions);
  };

  const canStartTimer = Boolean(onTimer) && !completed && !editing && !session;
  const startTimer = () => onTimer?.(timerRef.current ? findNodeHandle(timerRef.current) : null);
  // The timed task: its words open the focus screen (the detail view).
  const opensFocus = Boolean(session && onOpenTimer) && !completed;
  // One clock for the timed row's pill, line and check-in.
  const clock = useRowSessionClock(session);
  const timed = clock && controls && !completed && !editing ? { clock, controls } : null;

  const onA11yAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === START_TIMER_ACTION) {
      if (canStartTimer) startTimer();
      return;
    }
    if (event.nativeEvent.actionName === OPEN_FOCUS_ACTION) {
      if (opensFocus) onOpenTimer?.("words");
      return;
    }
    const name = event.nativeEvent.actionName as TaskRowAction;
    if (actions.includes(name)) run(name);
  };

  const renderActions = () => (
    <View className="flex-row" testID={`row-actions-${task.id}`}>
      {swipeActions.map((action) => {
        const [fill, onFill] =
          action === "delete" ? [colors.error, colors.onError] : [colors.primary, colors.onPrimary];
        return (
          <Pressable
            key={action}
            onPress={() => run(action)}
            accessibilityRole="button"
            accessibilityLabel={`${TASK_ROW_ACTION_LABELS[action]}: ${task.text}`}
            style={{
              width: ACTION_WIDTH,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              backgroundColor: fill,
            }}
          >
            <Ionicons
              name={action === "delete" ? "trash-outline" : "bookmark-outline"}
              size={20}
              color={onFill}
            />
            <Text
              style={{ color: onFill, fontWeight: "700", fontSize: 13 }}
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {TASK_ROW_ACTION_LABELS[action]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const textSize = hero ? 21 : completed ? 15 : 17;

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={swipeActions.length > 0 && !editing}
      enableTrackpadTwoFingerGesture
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={swipeActions.length > 0 ? renderActions : undefined}
    >
      <View
        style={{
          backgroundColor: colors.surface,
          paddingHorizontal: 16,
          paddingVertical: hero ? 16 : completed ? 10 : 14,
        }}
        testID={`task-row-${task.id}`}
      >
        {hero ? (
          <Text
            className="text-xs font-bold uppercase"
            style={{ color: colors.primary, letterSpacing: 0.6, marginLeft: TEXT_INSET, marginBottom: 4 }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            Up next
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          {/* Fixed-width column so the words line up whatever the circle's size. */}
          <Animated.View style={[{ width: 30, alignItems: "center", paddingTop: completed ? 1 : 0 }, checkStyle]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: completed }}
              accessibilityLabel={`${hero ? "Up next. " : ""}Task ${index + 1}: ${task.text}`}
              accessibilityHint={completed ? "Marks it not done" : "Marks it done"}
              accessibilityActions={[
                ...actions.map((action) => ({ name: action, label: TASK_ROW_ACTION_LABELS[action] })),
                ...(canStartTimer ? [{ name: START_TIMER_ACTION, label: "Start timer" }] : []),
                ...(opensFocus ? [{ name: OPEN_FOCUS_ACTION, label: "Open focus" }] : []),
              ]}
              onAccessibilityAction={onA11yAction}
              onPress={() => {
                // Finish an edit before ticking, so the field doesn't stay open.
                if (editing) commit();
                onToggle();
              }}
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

          <View className="flex-1 gap-1" style={{ minHeight: completed ? 24 : 30, justifyContent: "center" }}>
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
                style={{ color: colors.foreground, fontWeight: "600", fontSize: textSize, paddingVertical: 2 }}
              />
            ) : (
              <Pressable
                onPress={opensFocus ? () => onOpenTimer?.("words") : openMenu}
                onLongPress={openMenu}
                disabled={actions.length === 0 && !opensFocus}
                hitSlop={4}
                testID={`task-words-${task.id}`}
                // The checkbox already announces this task, its state and actions.
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Text
                  style={{
                    color: completed ? colors.muted : colors.foreground,
                    fontWeight: hero ? "700" : "600",
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

            {timed ? <RowSessionLine clock={timed.clock} /> : null}

            {task.carriedOver && !completed && !editing ? (
              <Text className="text-xs" style={{ color: colors.warning }}>
                Carried over
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

            {breakingDown ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={colors.muted} />
                <Text className="text-sm" style={{ color: colors.muted }}>
                  Breaking it down…
                </Text>
              </View>
            ) : null}

            {/* The next task shows its secondary actions; the rest use the menu.
                Not while it's timed: the check-in, focus screen and long-press
                menu have them, and the row stays calm. */}
            {hero && !editing && !completed && !breakingDown && !session ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 6 }}>
                {actions.includes("breakDown") ? (
                  <Pressable
                    onPress={() => run("breakDown")}
                    accessibilityRole="button"
                    accessibilityLabel={`Break down ${task.text}`}
                    accessibilityHint={
                      breakDownNeedsPlus ? "Plus feature. Shows Plus plans." : "Splits this task into a few tiny steps"
                    }
                    hitSlop={10}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                  >
                    <Ionicons name="list-outline" size={14} color={colors.muted} />
                    <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
                      Break it down
                    </Text>
                    {breakDownNeedsPlus ? (
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
                {actions.includes("notToday") ? (
                  <Pressable
                    onPress={() => run("notToday")}
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

          {/* The timer (1.3): the day's one timer, as a pill no taller than
              the circle, so it never grows the row. Its 44pt target comes
              from the hit slop. */}
          {timed ? (
            <RowTimerPill
              clock={timed.clock}
              taskText={task.text}
              controls={timed.controls}
              onOpen={onOpenTimer ? () => onOpenTimer("timer") : undefined}
            />
          ) : canStartTimer ? (
            <Pressable
              ref={timerRef}
              onPress={startTimer}
              accessibilityRole="button"
              accessibilityLabel={`Start a timer: ${task.text}`}
              accessibilityHint="Choose a length and start a timer"
              hitSlop={{ top: 7, bottom: 7 }}
              style={({ pressed }) => ({
                width: 44,
                height: 30,
                marginRight: -8,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
              testID={`task-timer-${task.id}`}
            >
              <Ionicons name="timer-outline" size={23} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Time's up: the check-in, right under its task, in line with the words. */}
        {timed ? <RowCheckIn clock={timed.clock} controls={timed.controls} inset={TEXT_INSET} /> : null}
      </View>
    </ReanimatedSwipeable>
  );
}
