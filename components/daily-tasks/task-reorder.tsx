// Drag to reorder Today's open tasks (1.4).
//
// How it works: press and hold a row's handle to pick the row up. A copy of
// the row (the "ghost") follows the finger while the real row stays in the
// list, invisible, and the list is shown in the order a drop would give (a
// preview: the store isn't touched until the drop). On release the ghost
// settles onto the real row's place, then one render removes the ghost, shows
// the row and saves the order. Nothing is repositioned by hand between frames,
// so there is no flicker to get wrong.
//
// The order itself (only open tasks move; done tasks keep their slots) is
// lib/daily-tasks/reorder.ts, shared with the store.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  dragTargetIndex,
  moveOpenTask,
  restackRows,
  type RowFrame,
} from "@/lib/daily-tasks/reorder";

/** The hairline between rows (each row after the first has one above it). */
export const ROW_GAP = 1;
/** How long the handle is held before the row lifts (a scroll starts sooner). */
export const DRAG_HOLD_MS = 180;
/** The drop's settle, and the other rows making room. */
export const DRAG_SETTLE_MS = 180;
/** The handle is 28x30: this makes its touch target 44x44. */
const HANDLE_HIT_SLOP = { top: 7, bottom: 7, left: 4, right: 12 };

interface DragState {
  id: string;
  /** The row's top in the card when it was picked up. */
  top: number;
  /** Where it would land, among the open tasks. */
  toIndex: number;
  /** The list as it was at pick-up: a change underneath cancels the drag. */
  listKey: string;
}

interface UseTaskReorderParams<T extends { id: string }> {
  tasks: T[];
  completedIds: string[];
  reduceMotion: boolean;
  /** The row lifted. */
  onPickUp: () => void;
  /** The row was let go at `toIndex` (among open tasks); `fromIndex` is where it started. */
  onDrop: (taskId: string, toIndex: number, fromIndex: number) => void;
}

export interface TaskReorder<T> {
  /** The list to show: the saved order, or the drag's preview. */
  displayTasks: T[];
  /** The task being dragged (its real row is hidden under the ghost). */
  draggingId: string | null;
  /** Where the ghost starts (the picked-up row's top in the card). */
  ghostTop: number;
  /** The ghost's travel from `ghostTop`. */
  dragY: SharedValue<number>;
  /** Each task's handle gesture, by task id. */
  gestures: Record<string, GestureType>;
  /** A row wrapper's onLayout (its frame in the card, hairline included). */
  onRowLayout: (taskId: string, index: number, event: LayoutChangeEvent) => void;
  /** The wrappers' layout transition while rows make room (none otherwise). */
  rowTransition: LinearTransition | undefined;
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
  onPickUp,
  onDrop,
}: UseTaskReorderParams<T>): TaskReorder<T> {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // Rows' frames in the card, in list order, for the UI thread.
  const frames = useSharedValue<RowFrame[]>([]);
  // The same, frozen at pick-up: the drag measures against a still picture.
  const startFrames = useSharedValue<RowFrame[]>([]);
  const activeId = useSharedValue<string | null>(null);
  const originIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);

  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const completedRef = useRef(completedIds);
  completedRef.current = completedIds;
  const callbacks = useRef({ onPickUp, onDrop });
  callbacks.current = { onPickUp, onDrop };

  const listKey = tasks.map((task) => `${task.id}${completedIds.includes(task.id) ? "+" : "-"}`).join("|");
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;

  const syncFrames = useCallback(() => {
    // Mid-drag the measured places are the preview's: the next sync (after the
    // drop, when the saved order matches them again) puts this right.
    if (dragRef.current) return;
    const next: RowFrame[] = [];
    for (const task of tasksRef.current) {
      const layout = layouts.current.get(task.id);
      if (!layout) continue;
      next.push({ id: task.id, y: layout.y, height: layout.height, open: !completedRef.current.includes(task.id) });
    }
    frames.value = next;
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

  // The list changed (a tick, a new task, the saved order after a drop).
  useEffect(() => {
    const ids = new Set(tasksRef.current.map((task) => task.id));
    for (const id of [...layouts.current.keys()]) if (!ids.has(id)) layouts.current.delete(id);
    syncFrames();
  }, [listKey, drag, syncFrames]);

  // The list changed under a drag (a widget tick, the day rolling over): the
  // picture it measures against is stale. Put the row down where it was.
  useEffect(() => {
    if (!drag || drag.listKey === listKey) return;
    activeId.value = null;
    setDrag(null);
  }, [drag, listKey, activeId]);

  const begin = useCallback((taskId: string, top: number, fromIndex: number) => {
    setDrag({ id: taskId, top, toIndex: fromIndex, listKey: listKeyRef.current });
    callbacks.current.onPickUp();
  }, []);

  const preview = useCallback((taskId: string, toIndex: number) => {
    setDrag((current) => (current && current.id === taskId && current.toIndex !== toIndex ? { ...current, toIndex } : current));
  }, []);

  const end = useCallback(
    (taskId: string, toIndex: number, fromIndex: number) => {
      activeId.value = null;
      // Cancelled meanwhile (the list changed): nothing to drop.
      if (dragRef.current?.id !== taskId) return;
      // One render: the ghost goes, the row shows, the order is saved.
      setDrag(null);
      callbacks.current.onDrop(taskId, toIndex, fromIndex);
    },
    [activeId],
  );

  const gestureFor = useCallback(
    (taskId: string): GestureType =>
      Gesture.Pan()
        // A hold, so a scroll that starts on the handle is still a scroll.
        .activateAfterLongPress(DRAG_HOLD_MS)
        .hitSlop(HANDLE_HIT_SLOP)
        .onStart(() => {
          "worklet";
          // One row at a time (the last drop may still be settling).
          if (activeId.value !== null) return;
          const snapshot = frames.value;
          const frame = frameOf(snapshot, taskId);
          const from = openIndexOf(snapshot, taskId);
          if (!frame || from < 0) return;
          startFrames.value = snapshot;
          activeId.value = taskId;
          originIndex.value = from;
          targetIndex.value = from;
          dragY.value = 0;
          runOnJS(begin)(taskId, frame.y, from);
        })
        .onUpdate((event) => {
          "worklet";
          if (activeId.value !== taskId) return;
          const snapshot = startFrames.value;
          const frame = frameOf(snapshot, taskId);
          if (!frame || snapshot.length === 0) return;
          // The row stays inside the task rows.
          const last = snapshot[snapshot.length - 1];
          const min = snapshot[0].y - frame.y;
          const max = last.y + last.height - frame.height - frame.y;
          const y = Math.max(min, Math.min(event.translationY, max));
          dragY.value = y;
          const over = dragTargetIndex(snapshot, taskId, frame.y + y, ROW_GAP);
          if (over >= 0 && over !== targetIndex.value) {
            targetIndex.value = over;
            runOnJS(preview)(taskId, over);
          }
        })
        .onFinalize((_event, success) => {
          "worklet";
          // A tap or a scroll never picked it up.
          if (activeId.value !== taskId) return;
          const snapshot = startFrames.value;
          const frame = frameOf(snapshot, taskId);
          const from = originIndex.value;
          // Interrupted (a call, the app switcher): back where it was.
          const to = success ? targetIndex.value : from;
          if (to !== targetIndex.value) {
            targetIndex.value = to;
            runOnJS(preview)(taskId, to);
          }
          const landed = frame ? frameOf(restackRows(snapshot, from, to, ROW_GAP), taskId) : null;
          const rest = frame && landed ? landed.y - frame.y : 0;
          if (reduceMotion) {
            dragY.value = rest;
            runOnJS(end)(taskId, to, from);
            return;
          }
          dragY.value = withTiming(rest, { duration: DRAG_SETTLE_MS }, () => {
            runOnJS(end)(taskId, to, from);
          });
        }),
    [activeId, begin, dragY, end, frames, originIndex, preview, reduceMotion, startFrames, targetIndex],
  );

  // One gesture per task, kept across renders (the handle's detector keeps
  // its touch while the preview re-renders the list).
  const idsKey = tasks.map((task) => task.id).join("|");
  const gestures = useMemo(() => {
    const byId: Record<string, GestureType> = {};
    for (const id of idsKey ? idsKey.split("|") : []) byId[id] = gestureFor(id);
    return byId;
  }, [idsKey, gestureFor]);

  const displayTasks = useMemo(
    () => (drag ? moveOpenTask(tasks, completedIds, drag.id, drag.toIndex) : tasks),
    [drag, tasks, completedIds],
  );
  const rowTransition = useMemo(
    () => (drag && !reduceMotion ? LinearTransition.duration(DRAG_SETTLE_MS) : undefined),
    [drag, reduceMotion],
  );

  return {
    displayTasks,
    draggingId: drag?.id ?? null,
    ghostTop: drag?.top ?? 0,
    dragY,
    gestures,
    onRowLayout,
    rowTransition,
  };
}

/**
 * The picked-up row's copy: over the card, following the finger. For looking
 * at only (no touches, and hidden from VoiceOver, which reorders with the
 * row's actions instead).
 */
export function ReorderGhost({ top, dragY, children }: { top: number; dragY: SharedValue<number>; children: ReactNode }) {
  const colors = useColors();
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));
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
          zIndex: 10,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
          // Lifted: a soft shadow (the card clips it at its edges).
          shadowColor: "#000",
          shadowOpacity: 0.16,
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
