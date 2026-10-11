import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
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
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
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
import {
  RowCheckIn,
  RowSessionLine,
  RowTimerPill,
  toggleTimer,
  useRowSessionClock,
} from "@/components/daily-tasks/row-timer";
import { HANDLE_HIT_SLOP } from "@/components/daily-tasks/task-reorder";
import { useColors } from "@/hooks/use-colors";
import { remainingMs, sessionPhase, type FocusSession } from "@/lib/daily-tasks/focus-session";
import { REORDER_HANDLE_OPACITY } from "@/lib/daily-tasks/reorder";
import {
  TASK_ROW_ACTION_LABELS,
  LOCKED_CHANGE_NOTE,
  taskRowActions,
  type TaskRowAction,
} from "@/lib/daily-tasks/today-view";
import type { Task } from "@/lib/daily-tasks/types";

interface TaskRowBaseProps {
  task: Task;
  completed: boolean;
  /** The next task to do on a set day: bigger, with its secondary actions shown. */
  hero?: boolean;
  /** Adding, editing, deleting and Not today are paused once the day is set. */
  editable: boolean;
  index: number;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  /** Save it for later instead of doing it today (not on a set day). */
  onNotToday: () => void;
  /** A tap on the words of a set day's row with nothing left to offer: the screen says why. */
  onLockedPress?: () => void;
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
  /**
   * Reordering (1.4), for an open row: what it can do right now. "Do this
   * next" is in the row's menu; all three are VoiceOver actions, so dragging
   * is never needed.
   */
  reorder?: { canDoNext: boolean; canMoveUp: boolean; canMoveDown: boolean };
  /** Make this the next task (the first open one). */
  onDoNext?: () => void;
  /** One place up or down among the open tasks. */
  onMove?: (direction: "up" | "down") => void;
  /**
   * The drag handle's gesture (touch it and move up or down). The handle
   * shows only with it: the list passes one when there are two or more open
   * tasks and the row has room. A tap on the handle opens the row's menu.
   */
  dragGesture?: GestureType;
  /**
   * No room for the handle (a narrow window, large text): the menu offers
   * Move up / Move down beside "Do this next" instead.
   */
  moveInMenu?: boolean;
  /** A row is being dragged: an open swipe closes. */
  dragActive?: boolean;
  /** Changes when VoiceOver's focus should come back to this row (after a move). */
  focusTick?: number;
  /**
   * The dragged row's copy under the finger: looks the same (handle
   * included), does nothing. No swipe, no ticking clock, no testIDs (the real
   * row keeps them).
   */
  ghost?: boolean;
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
/** The checkbox's VoiceOver actions for reordering (1.4). */
const DO_NEXT_ACTION = "doNext";
const MOVE_UP_ACTION = "moveUp";
const MOVE_DOWN_ACTION = "moveDown";
export const DO_NEXT_LABEL = "Do this next";
export const MOVE_UP_LABEL = "Move up";
export const MOVE_DOWN_LABEL = "Move down";
/** The row's words start after the circle's column (30) and the gap (12). */
const TEXT_INSET = 42;

/**
 * One row of Today's card. Only the circle finishes a task. Tapping the words
 * opens the row's menu (Edit, Not today, Break it down, Delete, as allowed);
 * swiping left shows Not today / Delete; VoiceOver gets the same actions.
 * While the focus session is on this task, tapping the words opens the focus
 * screen instead and a long press opens the menu, led by the timer's own
 * choices (Open focus, Pause/Resume timer, Stop timer).
 * An open row that isn't first offers "Do this next" in that menu, and, with
 * two or more open tasks, a handle at its end: drag it up or down (1.4).
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
  onLockedPress,
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
  reorder,
  onDoNext,
  onMove,
  dragGesture,
  moveInMenu = false,
  dragActive = false,
  focusTick = 0,
  ghost = false,
}: TaskRowProps) {
  const colors = useColors();
  /** The real row's testIDs; its copy under the finger has none. */
  const tid = (id: string) => (ghost ? undefined : id);
  const dragHandle = (
    <View
      collapsable={false}
      // The 44 by 44 target. On iOS it's this (the view's own hit slop) that
      // widens what a touch lands on; the gestures carry the same slop so a
      // touch in that margin isn't failed as outside the view (and for Android).
      hitSlop={HANDLE_HIT_SLOP}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // Pulled into the row's gaps, so the words lose as little as possible.
      style={{ width: 26, height: 30, marginLeft: -6, marginRight: -4, alignItems: "center", justifyContent: "center" }}
      testID={tid(`task-drag-${task.id}`)}
    >
      <Ionicons
        name="reorder-three-outline"
        size={18}
        color={colors.muted}
        style={{ opacity: REORDER_HANDLE_OPACITY }}
      />
    </View>
  );
  const reduceMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const inputRef = useRef<TextInputType | null>(null);
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const timerRef = useRef<View | null>(null);
  const boxRef = useRef<View | null>(null);
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
  // e.g. the day was set meanwhile, or editing started, or a row is picked up.
  const swipeKey = swipeActions.join(",");
  useEffect(() => {
    swipeRef.current?.close();
  }, [swipeKey, editing, dragActive]);
  // After a move the rows change places and VoiceOver loses the row it was
  // on: bring its focus back, once the rows have settled.
  // (Only when it changes: a row mounted with an old tick, as after a drop or
  // as the dragged copy, has nothing to bring back.)
  const lastFocusTick = useRef(focusTick);
  useEffect(() => {
    if (focusTick === lastFocusTick.current) return;
    lastFocusTick.current = focusTick;
    if (!focusTick || ghost) return;
    const timer = setTimeout(() => {
      if (boxRef.current) AccessibilityInfo.sendAccessibilityEvent(boxRef.current, "focus");
    }, 300);
    return () => clearTimeout(timer);
  }, [focusTick, ghost]);

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

  const canStartTimer = Boolean(onTimer) && !completed && !editing && !session;
  const startTimer = () => onTimer?.(timerRef.current ? findNodeHandle(timerRef.current) : null);
  // The timed task: its words open the focus screen (the detail view).
  const opensFocus = Boolean(session && onOpenTimer) && !completed;
  // One clock for the timed row's pill, line and check-in. The dragged copy
  // doesn't tick: it shows the time it was picked up at.
  const liveClock = useRowSessionClock(ghost ? null : session);
  const [pickedUpAt] = useState(() => Date.now());
  const clock =
    ghost && session
      ? { session, phase: sessionPhase(session, pickedUpAt), left: remainingMs(session, pickedUpAt) }
      : liveClock;
  const timed = clock && controls && !completed && !editing ? { clock, controls } : null;

  // Reordering is for open rows (a done task keeps its place).
  const canDoNext = Boolean(reorder?.canDoNext && onDoNext) && !completed;
  const canMoveUp = Boolean(reorder?.canMoveUp && onMove) && !completed;
  const canMoveDown = Boolean(reorder?.canMoveDown && onMove) && !completed;
  const doNext = () => {
    swipeRef.current?.close();
    onDoNext?.();
  };
  const move = (direction: "up" | "down") => {
    swipeRef.current?.close();
    onMove?.(direction);
  };

  // The row's menu (a tap on the words, or a long press while it's timed).
  // The timed task's own timer choices come first: Open focus, Pause or
  // Resume timer (not at time's up: the check-in answers that), Stop timer.
  const menuItems: { label: string; onPress: () => void; destructive?: boolean }[] = [
    ...(timed && opensFocus ? [{ label: "Open focus", onPress: () => onOpenTimer?.("words") }] : []),
    ...(timed && timed.clock.phase === "running"
      ? [{ label: "Pause timer", onPress: () => toggleTimer(timed.controls, "pause") }]
      : timed && timed.clock.phase === "paused"
        ? [{ label: "Resume timer", onPress: () => toggleTimer(timed.controls, "resume") }]
        : []),
    ...(timed ? [{ label: "Stop timer", onPress: () => timed.controls.stop() }] : []),
    ...(canDoNext ? [{ label: DO_NEXT_LABEL, onPress: doNext }] : []),
    // Without the handle (no room for it), one place at a time is here too.
    ...(moveInMenu && canMoveUp ? [{ label: MOVE_UP_LABEL, onPress: () => move("up") }] : []),
    ...(moveInMenu && canMoveDown ? [{ label: MOVE_DOWN_LABEL, onPress: () => move("down") }] : []),
    ...actions.map((action) => ({
      label: TASK_ROW_ACTION_LABELS[action],
      onPress: () => run(action),
      destructive: action === "delete",
    })),
  ];

  // A set day's menu has no Edit, Not today or Delete: it says why (1.4).
  const menuNote = editable ? undefined : LOCKED_CHANGE_NOTE;
  const openMenu = () => {
    if (menuItems.length === 0) {
      if (!editable) onLockedPress?.();
      return;
    }
    const labels = menuItems.map((item) => item.label);
    if (Platform.OS === "ios") {
      const destructive = menuItems.findIndex((item) => item.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: task.text,
          message: menuNote,
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
          destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
          tintColor: colors.primary,
        },
        (picked) => {
          if (picked < menuItems.length) menuItems[picked].onPress();
        },
      );
      return;
    }
    // Android shows at most three buttons: page through with "More…".
    const page = (list: typeof menuItems) => {
      const button = (item: (typeof menuItems)[number]) => ({
        text: item.label,
        style: item.destructive ? ("destructive" as const) : ("default" as const),
        onPress: item.onPress,
      });
      const shown = list.length <= 2 ? list.map(button) : [button(list[0]), { text: "More…", onPress: () => page(list.slice(1)) }];
      Alert.alert(task.text, menuNote, [...shown, { text: "Cancel", style: "cancel" as const }]);
    };
    page(menuItems);
  };

  const onA11yAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === START_TIMER_ACTION) {
      if (canStartTimer) startTimer();
      return;
    }
    if (event.nativeEvent.actionName === OPEN_FOCUS_ACTION) {
      if (opensFocus) onOpenTimer?.("words");
      return;
    }
    if (event.nativeEvent.actionName === DO_NEXT_ACTION) {
      if (canDoNext) doNext();
      return;
    }
    if (event.nativeEvent.actionName === MOVE_UP_ACTION) {
      if (canMoveUp) move("up");
      return;
    }
    if (event.nativeEvent.actionName === MOVE_DOWN_ACTION) {
      if (canMoveDown) move("down");
      return;
    }
    const name = event.nativeEvent.actionName as TaskRowAction;
    if (actions.includes(name)) run(name);
  };

  // The handle: dragging it moves the row; a tap that never moved opens the
  // row's menu, so the control is never dead. Whichever happens first wins.
  const openMenuRef = useRef(openMenu);
  useEffect(() => {
    openMenuRef.current = openMenu;
  });
  const handleGesture = useMemo(
    () =>
      dragGesture
        ? Gesture.Race(
            dragGesture,
            Gesture.Tap()
              .withTestId(`task-handle-tap-${task.id}`)
              .runOnJS(true)
              .hitSlop(HANDLE_HIT_SLOP)
              .maxDistance(10)
              .onEnd((_event, success) => {
                if (success) openMenuRef.current();
              }),
          )
        : null,
    [dragGesture, task.id],
  );

  const renderActions = () => (
    <View className="flex-row" testID={tid(`row-actions-${task.id}`)}>
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

  const row = (
      <View
        style={{
          backgroundColor: colors.surface,
          paddingHorizontal: 16,
          paddingVertical: hero ? 16 : completed ? 10 : 14,
          // The check-in's last line is a 44pt link: its own air is enough.
          ...(timed && timed.clock.phase === "ended" ? { paddingBottom: 8 } : {}),
        }}
        testID={tid(`task-row-${task.id}`)}
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
              ref={boxRef}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: completed }}
              accessibilityLabel={`${hero ? "Up next. " : ""}Task ${index + 1}: ${task.text}${task.routineId ? ", routine" : ""}`}
              accessibilityHint={completed ? "Marks it not done" : "Marks it done"}
              accessibilityActions={[
                ...actions.map((action) => ({ name: action, label: TASK_ROW_ACTION_LABELS[action] })),
                ...(canStartTimer ? [{ name: START_TIMER_ACTION, label: "Start timer" }] : []),
                ...(opensFocus ? [{ name: OPEN_FOCUS_ACTION, label: "Open focus" }] : []),
                ...(canDoNext ? [{ name: DO_NEXT_ACTION, label: DO_NEXT_LABEL }] : []),
                ...(canMoveUp ? [{ name: MOVE_UP_ACTION, label: MOVE_UP_LABEL }] : []),
                ...(canMoveDown ? [{ name: MOVE_DOWN_ACTION, label: MOVE_DOWN_LABEL }] : []),
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
                disabled={menuItems.length === 0 && !opensFocus && !(onLockedPress && !editable)}
                hitSlop={4}
                testID={tid(`task-words-${task.id}`)}
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
                  {task.routineId ? (
                    // A small repeat glyph after the words, as on Today's routines and in Ideas.
                    // Never struck through with a completed title (it's a marker, not words).
                    <Text style={{ fontWeight: "400", textDecorationLine: "none" }} testID={tid(`task-routine-${task.id}`)}>
                      {" "}
                      <Ionicons name="repeat" size={Math.round(textSize * 0.8)} color={colors.muted} />
                    </Text>
                  ) : null}
                </Text>
              </Pressable>
            )}

            {timed ? <RowSessionLine clock={timed.clock} bare={ghost} /> : null}

            {task.carriedOver && !completed && !editing ? (
              // Quiet, not a warning: muted (AA) with a small "carried" arrow.
              <View className="flex-row items-center gap-1" testID={tid(`task-carried-${task.id}`)}>
                <Ionicons name="arrow-redo-outline" size={12} color={colors.muted} />
                <Text className="text-xs" style={{ color: colors.muted }}>
                  Carried over
                </Text>
              </View>
            ) : null}

            {!editing && !completed && hasSteps ? (
              <View className="gap-1.5 mt-1" testID={tid(`steps-${task.id}`)}>
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
                {/* Not on the timed row: it stays calm (the focus screen has the steps). */}
                {onClearSteps && !session ? (
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
            {hero &&
            !editing &&
            !completed &&
            !breakingDown &&
            !session &&
            // Nothing to show (a set day's row that can't be broken down): no empty line under the words.
            (actions.includes("breakDown") || actions.includes("notToday")) ? (
              // Wraps at the larger text sizes rather than running off the card.
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 4, marginTop: 6 }}>
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
                        testID={tid("break-down-plus")}
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
              bare={ghost}
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
              testID={tid(`task-timer-${task.id}`)}
            >
              <Ionicons name="timer-outline" size={23} color={colors.muted} />
            </Pressable>
          ) : null}

          {/* Reorder (1.4): drag the handle up or down; a tap opens the menu.
              The row's last thing, no taller than the circle, with a 44pt
              target (its hit slop). VoiceOver skips it: the checkbox has
              Do this next / Move up / Move down. */}
          {completed || editing ? null : ghost ? (
            dragHandle
          ) : handleGesture ? (
            <GestureDetector gesture={handleGesture}>{dragHandle}</GestureDetector>
          ) : null}
        </View>

        {/* Time's up: the check-in, right under its task, in line with the
            words. Not in the dragged copy (which is as tall as its row anyway). */}
        {timed && !ghost ? <RowCheckIn clock={timed.clock} controls={timed.controls} inset={TEXT_INSET} /> : null}
      </View>
  );

  // The dragged copy is for looking at: no swipe of its own.
  if (ghost) return row;

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
      {row}
    </ReanimatedSwipeable>
  );
}
