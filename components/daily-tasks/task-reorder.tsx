// Drag to reorder Today's open tasks (1.4).
//
// How it works: touch a row's handle and move up or down, and the row is
// picked up. A copy of the row (the "ghost") follows the finger while the real
// row stays where it is in the tree, invisible. The other rows make room by
// sliding (`translateY`, worked out on the UI thread from the rows' places at
// pick-up): nothing is re-rendered and no row changes its place in the tree
// while the finger is down. That matters: moving a row's native view to
// another index mid-touch makes iOS cancel the touch.
//
// On release the ghost settles onto where the row will be, then ONE render
// removes the ghost, shows the row, saves the order (the rows now really are
// in that order) and zeroes the slides, so nothing moves on screen. A moment
// later the "Up next" styling follows the new order, eased by a layout
// transition.
//
// The order itself (only open tasks move; done tasks keep their slots) is
// lib/daily-tasks/reorder.ts, shared with the store.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ComponentType } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Gesture, type GestureType } from "react-native-gesture-handler";
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useColors } from "@/hooks/use-colors";
import { dragTargetIndex, restackRows, rowShifts, type RowFrame } from "@/lib/daily-tasks/reorder";

/** The hairline between rows (each row after the first has one above it). */
export const ROW_GAP = 1;
/** The drop's settle, the other rows making room, and a reorder's layout pass. */
export const DRAG_SETTLE_MS = 180;
/** The finger's vertical travel on the handle that picks the row up. */
export const DRAG_ACTIVATE_PT = 6;
/** Sideways travel that makes it the row's swipe instead. */
export const DRAG_FAIL_X_PT = 12;
/**
 * The handle is 26 by 30: this makes its touch target 44 by 44. It is the
 * handle view's own `hitSlop` too (task-row.tsx): on iOS only that one widens
 * what a touch can land on; the gesture's is for Android.
 */
export const HANDLE_HIT_SLOP = { top: 7, bottom: 7, left: 6, right: 12 };
/** After a drop, how long the old "Up next" row keeps its look before the swap is eased in. */
export const DROP_SWAP_DELAY_MS = 50;
/** How much a touched or held row grows. */
const LIFT_SCALE = 0.02;
const LIFT_MS = 120;
/** The layout pass after a reorder, and a little air for it to finish. */
const TRANSITION_HOLD_MS = DRAG_SETTLE_MS + 150;

/** Where the rows are while a drag previews its drop. */
export interface RowShifts {
  /** Each row's `translateY` from its own place, by task id (none: 0). */
  offsets: Record<string, number>;
  /** Slide there, or just be there (Reduce Motion, and the drop's own render). */
  animate: boolean;
}

const AT_REST: RowShifts = { offsets: {}, animate: false };

interface DragState {
  id: string;
  /** The row's top among the rows when it was picked up. */
  top: number;
  height: number;
  /** The list as it was at pick-up: a change underneath cancels the drag. */
  listKey: string;
}

/** The rows' places, and the list they were measured for. */
interface Frames {
  key: string;
  rows: RowFrame[];
}

interface UseTaskReorderParams<T extends { id: string }> {
  tasks: T[];
  completedIds: string[];
  reduceMotion: boolean;
  /** The "Up next" task. Given back as `heroId`, held for a moment after a drop. */
  heroId?: string | null;
  /**
   * The page's scroll view (gesture-handler's): a drag on the handle wins over
   * scrolling. Without it the two race.
   */
  scrollRef?: RefObject<unknown>;
  /** The row lifted. */
  onPickUp: () => void;
  /** The held row is over another place. */
  onSlotChange?: () => void;
  /** The row was let go at `toIndex` (among open tasks); `fromIndex` is where it started. */
  onDrop: (taskId: string, toIndex: number, fromIndex: number) => void;
}

export interface TaskReorder {
  /** The task being dragged (its real row is hidden under the ghost). */
  draggingId: string | null;
  /** Where the ghost starts (the picked-up row's top among the rows) and its height. */
  ghostTop: number;
  ghostHeight: number;
  /** The ghost's travel from `ghostTop`. */
  dragY: SharedValue<number>;
  /** 0 to 1: how lifted the touched row (and the ghost) is. */
  lift: SharedValue<number>;
  /** The row `lift` is about. */
  liftId: SharedValue<string | null>;
  /** The other rows making room. */
  shifts: SharedValue<RowShifts>;
  /** Each task's handle gesture, by task id. */
  gestures: Record<string, GestureType>;
  /** A row wrapper's onLayout (its frame among the rows, hairline included). */
  onRowLayout: (taskId: string, index: number, event: LayoutChangeEvent) => void;
  /** The wrappers' layout transition for the pass after a reorder (none otherwise). */
  rowTransition: LinearTransition | undefined;
  /** The "Up next" task to show: the given one, or the last one while a drop settles. */
  heroId: string | null;
  /**
   * Make a change to the order (Do this next, Move up/down) with the rows
   * easing into their new places. With Reduce Motion it just happens.
   */
  animateNext: (change: () => void) => void;
}

function frameOf(frames: RowFrame[], id: string): RowFrame | null {
  "worklet";
  for (let i = 0; i < frames.length; i += 1) if (frames[i].id === id) return frames[i];
  return null;
}

function openIndexOf(frames: RowFrame[], id: string): number {
  "worklet";
  let position = 0;
  for (let i = 0; i < frames.length; i += 1) {
    if (!frames[i].open) continue;
    if (frames[i].id === id) return position;
    position += 1;
  }
  return -1;
}

export function useTaskReorder<T extends { id: string }>({
  tasks,
  completedIds,
  reduceMotion,
  heroId = null,
  scrollRef,
  onPickUp,
  onSlotChange,
  onDrop,
}: UseTaskReorderParams<T>): TaskReorder {
  const [drag, setDrag] = useState<DragState | null>(null);
  // The drag as `begin` and `end` know it, set the moment they run: a drop can
  // arrive before the render that `begin` asked for.
  const activeDrag = useRef<{ id: string; listKey: string } | null>(null);
  // The UI thread's side of a drag is to be let go (after a drop or a cancel).
  const needsRelease = useRef(false);
  const [releaseTick, setReleaseTick] = useState(0);
  // Where the rows land after the last drop, until their layout says so itself.
  const landed = useRef<RowFrame[] | null>(null);
  const mounted = useRef(true);

  // The layout pass after a reorder is eased; `pending` are the changes
  // waiting for the transition to be in place.
  const [transition, setTransition] = useState({ on: false, tick: 0 });
  const pending = useRef<(() => void)[]>([]);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After a drop the old "Up next" row keeps its look for a moment.
  const [heroHeld, setHeroHeld] = useState(false);
  const heroTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownHero = useRef(heroId);
  if (!heroHeld) shownHero.current = heroId;

  // Rows' frames, in list order, for the UI thread.
  const frames = useSharedValue<Frames>({ key: "", rows: [] });
  // The same, frozen at pick-up: the drag measures against a still picture.
  const startFrames = useSharedValue<RowFrame[]>([]);
  const activeId = useSharedValue<string | null>(null);
  // The drop is settling: the gesture that made it is over.
  const settling = useSharedValue(false);
  // No new pick-up for now (a drop or a reorder is still easing into place).
  const busy = useSharedValue(false);
  const originIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);
  // The finger's travel when the row lifted (it had to move to lift it).
  const startTravel = useSharedValue(0);
  const dragY = useSharedValue(0);
  const lift = useSharedValue(0);
  const liftId = useSharedValue<string | null>(null);
  const shifts = useSharedValue<RowShifts>(AT_REST);

  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const completedRef = useRef(completedIds);
  completedRef.current = completedIds;
  const callbacks = useRef({ onPickUp, onSlotChange, onDrop });
  callbacks.current = { onPickUp, onSlotChange, onDrop };
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const listKey = tasks.map((task) => `${task.id}${completedIds.includes(task.id) ? "+" : "-"}`).join("|");
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      if (heroTimer.current) clearTimeout(heroTimer.current);
    };
  }, []);

  const syncFrames = useCallback(() => {
    // Mid-drag the picture is frozen (startFrames); the next sync, after the
    // drop, puts this right.
    if (activeDrag.current) return;
    const rows: RowFrame[] = [];
    for (const task of tasksRef.current) {
      const layout = layouts.current.get(task.id);
      if (!layout) continue;
      rows.push({ id: task.id, y: layout.y, height: layout.height, open: !completedRef.current.includes(task.id) });
    }
    frames.value = { key: listKeyRef.current, rows };
  }, [frames]);

  const onRowLayout = useCallback(
    (taskId: string, index: number, event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      // The wrapper holds the hairline above the row: the frame is the row's own.
      const gap = index > 0 ? ROW_GAP : 0;
      layouts.current.set(taskId, { y: y + gap, height: Math.max(0, height - gap) });
      syncFrames();
    },
    [syncFrames],
  );

  // The list changed under a drag (a widget tick, the day rolling over): the
  // picture it measures against is stale. Put the row down where it was.
  useLayoutEffect(() => {
    if (!drag || drag.listKey === listKey) return;
    activeDrag.current = null;
    needsRelease.current = true;
    setDrag(null);
  }, [drag, listKey]);

  // Every render that follows a list change, a drop or a cancel: the rows'
  // frames for the UI thread and, when a drag is over, letting go of it. The
  // drop's own render is the one that puts the rows in their new order, so
  // the slides are zeroed here, in the same commit: nothing jumps.
  useLayoutEffect(() => {
    if (drag) return;
    const ids = new Set(tasksRef.current.map((task) => task.id));
    for (const id of [...layouts.current.keys()]) if (!ids.has(id)) layouts.current.delete(id);
    // The rows are where the drop put them (their own layout events follow).
    const places = landed.current;
    landed.current = null;
    if (places && places.map((row) => row.id).join("|") === tasksRef.current.map((task) => task.id).join("|")) {
      for (const row of places) layouts.current.set(row.id, { y: row.y, height: row.height });
    }
    syncFrames();
    if (!needsRelease.current) return;
    needsRelease.current = false;
    shifts.value = AT_REST;
    activeId.value = null;
    settling.value = false;
  }, [drag, listKey, releaseTick, syncFrames, shifts, activeId, settling]);

  // Pick-ups are allowed again once nothing is easing into place.
  useEffect(() => {
    if (drag || heroHeld || transition.on || needsRelease.current) return;
    busy.value = false;
  }, [drag, heroHeld, transition.on, releaseTick, busy]);

  const animateNext = useCallback(
    (change: () => void) => {
      if (reduceMotionRef.current || activeDrag.current || !mounted.current) {
        change();
        return;
      }
      // First a render that turns the transition on, then the change: the
      // rows' transition is in place before the layout pass it's for.
      pending.current.push(change);
      busy.value = true;
      setTransition((current) => ({ on: true, tick: current.tick + 1 }));
    },
    [busy],
  );

  useEffect(() => {
    if (!transition.on) return;
    const changes = pending.current;
    pending.current = [];
    for (const change of changes) change();
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      transitionTimer.current = null;
      if (mounted.current) setTransition((current) => ({ on: false, tick: current.tick }));
    }, TRANSITION_HOLD_MS);
  }, [transition]);

  const begin = useCallback((taskId: string, top: number, height: number, framesKey: string) => {
    if (!mounted.current) return;
    if (framesKey !== listKeyRef.current) {
      // The list changed between the touch and here: nothing to hold.
      needsRelease.current = true;
      setReleaseTick((tick) => tick + 1);
      return;
    }
    activeDrag.current = { id: taskId, listKey: framesKey };
    setDrag({ id: taskId, top, height, listKey: framesKey });
    callbacks.current.onPickUp();
  }, []);

  const slotChanged = useCallback(() => {
    if (!mounted.current || !activeDrag.current) return;
    callbacks.current.onSlotChange?.();
  }, []);

  const end = useCallback(
    (taskId: string, toIndex: number, fromIndex: number, places: RowFrame[]) => {
      if (!mounted.current) return;
      const active = activeDrag.current;
      // Cancelled meanwhile (the list changed): it was let go of then.
      if (!active || active.id !== taskId) return;
      activeDrag.current = null;
      needsRelease.current = true;
      // One render: the ghost goes, the row shows, the order is saved and the
      // slides are zeroed (always a render, even if `begin`'s never happened).
      setDrag(null);
      setReleaseTick((tick) => tick + 1);
      // The list changed in this very moment: no drop onto a stale picture.
      if (active.listKey !== listKeyRef.current) return;
      if (toIndex !== fromIndex) {
        landed.current = places;
        if (!reduceMotionRef.current) {
          // The "Up next" look changes rows' heights: not in the render that
          // must not move anything. It follows, eased.
          setHeroHeld(true);
          if (heroTimer.current) clearTimeout(heroTimer.current);
          heroTimer.current = setTimeout(() => {
            heroTimer.current = null;
            if (!mounted.current) return;
            animateNext(() => setHeroHeld(false));
          }, DROP_SWAP_DELAY_MS);
        }
      }
      callbacks.current.onDrop(taskId, toIndex, fromIndex);
    },
    [animateNext],
  );

  const gestureFor = useCallback(
    (taskId: string): GestureType => {
      const gesture = Gesture.Pan()
        // Picked up by moving up or down, straight away (no hold); a sideways
        // move is the row's swipe. A touch that doesn't move is a tap: the
        // handle opens the row's menu (task-row.tsx).
        .activeOffsetY([-DRAG_ACTIVATE_PT, DRAG_ACTIVATE_PT])
        .failOffsetX([-DRAG_FAIL_X_PT, DRAG_FAIL_X_PT])
        .maxPointers(1)
        .hitSlop(HANDLE_HIT_SLOP)
        .onBegin(() => {
          "worklet";
          // Touched: the row lifts a little before it moves.
          if (activeId.value !== null || busy.value) return;
          liftId.value = taskId;
          lift.value = reduceMotion ? 1 : withTiming(1, { duration: LIFT_MS });
        })
        .onStart((event) => {
          "worklet";
          // One row at a time (the last drop may still be settling).
          if (activeId.value !== null || busy.value) return;
          const snapshot = frames.value;
          const frame = frameOf(snapshot.rows, taskId);
          const from = openIndexOf(snapshot.rows, taskId);
          if (!frame || from < 0) return;
          startFrames.value = snapshot.rows;
          activeId.value = taskId;
          settling.value = false;
          originIndex.value = from;
          targetIndex.value = from;
          startTravel.value = event.translationY;
          dragY.value = 0;
          shifts.value = { offsets: {}, animate: !reduceMotion };
          liftId.value = taskId;
          lift.value = reduceMotion ? 1 : withTiming(1, { duration: LIFT_MS });
          runOnJS(begin)(taskId, frame.y, frame.height, snapshot.key);
        })
        .onUpdate((event) => {
          "worklet";
          if (activeId.value !== taskId || settling.value) return;
          const snapshot = startFrames.value;
          const frame = frameOf(snapshot, taskId);
          if (!frame || snapshot.length === 0) return;
          // The row stays inside the task rows.
          const last = snapshot[snapshot.length - 1];
          const min = snapshot[0].y - frame.y;
          const max = last.y + last.height - frame.height - frame.y;
          const y = Math.max(min, Math.min(event.translationY - startTravel.value, max));
          dragY.value = y;
          const over = dragTargetIndex(snapshot, taskId, frame.y + y, ROW_GAP);
          if (over >= 0 && over !== targetIndex.value) {
            targetIndex.value = over;
            // The other rows make room, here on the UI thread: no render.
            shifts.value = {
              offsets: rowShifts(snapshot, originIndex.value, over, ROW_GAP),
              animate: !reduceMotion,
            };
            runOnJS(slotChanged)();
          }
        })
        .onFinalize((_event, success) => {
          "worklet";
          if (activeId.value !== taskId) {
            // A tap, a swipe, or a touch while another row is busy: put the lift back.
            if (liftId.value === taskId) lift.value = reduceMotion ? 0 : withTiming(0, { duration: LIFT_MS });
            return;
          }
          // Already dropped: a touch during the settle changes nothing.
          if (settling.value) return;
          settling.value = true;
          busy.value = true;
          const snapshot = startFrames.value;
          const frame = frameOf(snapshot, taskId);
          const from = originIndex.value;
          // Interrupted (a call, the app switcher): back where it was.
          const to = success ? targetIndex.value : from;
          if (to !== targetIndex.value) {
            targetIndex.value = to;
            shifts.value = { offsets: rowShifts(snapshot, from, to, ROW_GAP), animate: !reduceMotion };
          }
          const places = restackRows(snapshot, from, to, ROW_GAP);
          const place = frame ? frameOf(places, taskId) : null;
          const rest = frame && place ? place.y - frame.y : 0;
          if (reduceMotion) {
            lift.value = 0;
            dragY.value = rest;
            runOnJS(end)(taskId, to, from, places);
            return;
          }
          lift.value = withTiming(0, { duration: DRAG_SETTLE_MS });
          dragY.value = withTiming(rest, { duration: DRAG_SETTLE_MS }, () => {
            "worklet";
            runOnJS(end)(taskId, to, from, places);
          });
        });
      // The page's scroll waits for this to fail, so the drag wins on the handle.
      // (Its ref carries the scroll's handler tag once mounted; the detector
      // reads it after mount.)
      return scrollRef
        ? gesture.blocksExternalGesture(scrollRef as RefObject<ComponentType | undefined>)
        : gesture;
    },
    [
      activeId,
      begin,
      busy,
      dragY,
      end,
      frames,
      lift,
      liftId,
      originIndex,
      reduceMotion,
      scrollRef,
      settling,
      shifts,
      slotChanged,
      startFrames,
      startTravel,
      targetIndex,
    ],
  );

  // One gesture per task, kept across renders (the handle's detector keeps
  // its touch whatever the screen re-renders meanwhile).
  const idsKey = tasks.map((task) => task.id).join("|");
  const gestures = useMemo(() => {
    const byId: Record<string, GestureType> = {};
    for (const id of idsKey ? idsKey.split("|") : []) byId[id] = gestureFor(id);
    return byId;
  }, [idsKey, gestureFor]);

  const linear = useMemo(() => LinearTransition.duration(DRAG_SETTLE_MS), []);
  // Never while a row is held or in the drop's own render: those don't move.
  const rowTransition = transition.on && !drag && !reduceMotion ? linear : undefined;

  return {
    draggingId: drag?.id ?? null,
    ghostTop: drag?.top ?? 0,
    ghostHeight: drag?.height ?? 0,
    dragY,
    lift,
    liftId,
    shifts,
    gestures,
    onRowLayout,
    rowTransition,
    heroId: shownHero.current,
    animateNext,
  };
}

/**
 * One task row's place in the card. It stays put in the tree for a whole
 * drag: while another row is held it slides out of the way (`shifts`), and
 * when its own handle is touched it lifts a little (`lift`).
 */
export function ReorderRow({
  id,
  reorder,
  index,
  children,
}: {
  id: string;
  reorder: Pick<TaskReorder, "draggingId" | "shifts" | "lift" | "liftId" | "onRowLayout" | "rowTransition">;
  /** Its place in the list (the first row has no hairline above it). */
  index: number;
  children: ReactNode;
}) {
  const { shifts, lift, liftId, onRowLayout } = reorder;
  const slide = useAnimatedStyle(() => {
    const state = shifts.value;
    const y = state.offsets[id] ?? 0;
    return { transform: [{ translateY: state.animate ? withTiming(y, { duration: DRAG_SETTLE_MS }) : y }] };
  });
  // Its own view, so a lift never restarts a slide.
  const lifted = useAnimatedStyle(() => ({
    transform: [{ scale: liftId.value === id ? 1 + LIFT_SCALE * lift.value : 1 }],
  }));
  return (
    <Animated.View
      layout={reorder.rowTransition}
      onLayout={(event) => onRowLayout(id, index, event)}
      // Under the finger it's the ghost that shows.
      style={[slide, reorder.draggingId === id ? { opacity: 0 } : null]}
    >
      <Animated.View style={lifted}>{children}</Animated.View>
    </Animated.View>
  );
}

/**
 * The picked-up row's copy: over the rows, following the finger. For looking
 * at only (no touches, and hidden from VoiceOver, which reorders with the
 * row's actions instead).
 */
export function ReorderGhost({
  top,
  height,
  dragY,
  lift,
  children,
}: {
  top: number;
  /** The row's own height: the copy covers at least that. */
  height: number;
  dragY: SharedValue<number>;
  lift: SharedValue<number>;
  children: ReactNode;
}) {
  const colors = useColors();
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }, { scale: 1 + LIFT_SCALE * lift.value }],
    // Lifted: a soft shadow that goes as it lands (the card clips it at its edges).
    shadowOpacity: 0.16 * lift.value,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="task-drag-ghost"
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          top,
          // The borders (1 each) are outside the row's own height.
          minHeight: height + 2,
          zIndex: 10,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
          shadowColor: "#000",
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
          // The borders mustn't move the row's content.
          marginTop: -1,
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
