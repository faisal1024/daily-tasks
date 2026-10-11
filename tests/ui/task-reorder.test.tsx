// Reordering in the row and the drag (1.4, PR #90): what a TaskRow offers
// (menu, VoiceOver actions, the handle, its copy under the finger), and
// useTaskReorder's drag: the other rows slide (no re-render, no change of
// order) until the drop, which reports once; a list change underneath puts
// the row back without a move.
import { useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, StyleSheet, Text } from "react-native";
import { act, fireEvent, renderHook, screen } from "@testing-library/react-native";
import { Gesture, type GestureType } from "react-native-gesture-handler";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import {
  DRAG_ACTIVATE_PT,
  DRAG_FAIL_X_PT,
  DROP_SWAP_DELAY_MS,
  HANDLE_HIT_SLOP,
  ReorderRow,
  reorderRowKey,
  useTaskReorder,
  type RowShifts,
} from "@/components/daily-tasks/task-reorder";
import { TaskRow } from "@/components/daily-tasks/task-row";
import type { FocusSession } from "@/lib/daily-tasks/focus-session";
import { moveOpenTask } from "@/lib/daily-tasks/reorder";
import type { Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

// A drop's settle (withTiming) can be held open, to touch the handle again
// before it lands.
const mockTiming = { hold: false, held: [] as (() => void)[] };

// The library's mock hands out a new shared value on every render; the real
// one keeps it for the component's life, which the drag relies on (its gesture
// is made once and outlives every re-render). So: one that's kept.
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
  const { useRef } = require("react");
  return {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
    ...require("react-native-reanimated/mock"),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: <T,>(initial: T) => useRef({ value: initial }).current,
    withTiming: (toValue: number, _config?: unknown, callback?: (finished: boolean) => void) => {
      if (callback) {
        if (mockTiming.hold) mockTiming.held.push(() => callback(true));
        else callback(true);
      }
      return toValue;
    },
  };
});

const WALK: Task = { id: "walk", text: "Walk", createdAt: "", carriedOver: false };
const ALL = { canDoNext: true, canMoveUp: true, canMoveDown: true };

type RowProps = Partial<React.ComponentProps<typeof TaskRow>>;
const rowHandlers = () => ({
  onToggle: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onNotToday: jest.fn(),
  onDoNext: jest.fn(),
  onMove: jest.fn(),
});
async function renderRow(props: RowProps = {}) {
  const handlers = rowHandlers();
  await render(
    <TaskRow task={WALK} index={1} completed={false} editable {...handlers} {...(props as object)} />,
  );
  return handlers;
}

let sheet: jest.SpyInstance;
beforeEach(() => {
  sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  mockTiming.hold = false;
  mockTiming.held = [];
});
afterEach(() => {
  sheet.mockRestore();
  jest.useRealTimers();
});

const box = () => screen.getByRole("checkbox", { name: /Task 2: Walk/ });
const actionNames = () => (box().props.accessibilityActions as { name: string }[]).map((action) => action.name);
const reorderActions = () => actionNames().filter((name) => ["doNext", "moveUp", "moveDown"].includes(name));
const a11y = (actionName: string) => fireEvent(box(), "accessibilityAction", { nativeEvent: { actionName } });
// The words and the handle are hidden from VoiceOver (the checkbox has the actions).
const words = () => screen.getByTestId("task-words-walk", { includeHiddenElements: true });
const handle = () => screen.queryByTestId("task-drag-walk", { includeHiddenElements: true });
/** The sheet that's up: its labels and a way to pick one. */
function shownMenu() {
  if (sheet.mock.calls.length === 0) return { options: [] as string[], pick: async () => {} };
  const [{ options }, callback] = sheet.mock.calls[0] as [{ options: string[] }, (index: number) => void];
  return { options, pick: async (label: string) => act(async () => callback(options.indexOf(label))) };
}
/** Opens the row's menu from its words. */
async function openMenu() {
  sheet.mockClear();
  await fireEvent.press(words());
  return shownMenu();
}

describe("TaskRow: reorder choices", () => {
  it("a middle open row offers Do this next in its menu and all three VoiceOver actions, with their labels", async () => {
    const { onDoNext, onMove } = await renderRow({ reorder: ALL });
    const actions = box().props.accessibilityActions as { name: string; label: string }[];
    expect(actions.filter((action) => ["doNext", "moveUp", "moveDown"].includes(action.name))).toEqual([
      { name: "doNext", label: "Do this next" },
      { name: "moveUp", label: "Move up" },
      { name: "moveDown", label: "Move down" },
    ]);

    const menu = await openMenu();
    expect(menu.options).toContain("Do this next");
    // With the handle there, moving one place is VoiceOver's (and the handle's), not the menu's.
    expect(menu.options).not.toContain("Move up");
    expect(menu.options).not.toContain("Move down");
    await menu.pick("Do this next");
    expect(onDoNext).toHaveBeenCalledTimes(1);

    await a11y("doNext");
    expect(onDoNext).toHaveBeenCalledTimes(2);
    await a11y("moveUp");
    expect(onMove).toHaveBeenLastCalledWith("up");
    await a11y("moveDown");
    expect(onMove).toHaveBeenLastCalledWith("down");
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it("the first open row has no Do this next or Move up; the last has no Move down", async () => {
    const first = await renderRow({ reorder: { canDoNext: false, canMoveUp: false, canMoveDown: true } });
    expect(reorderActions()).toEqual(["moveDown"]);
    expect((await openMenu()).options).not.toContain("Do this next");
    // An action that isn't offered does nothing if it arrives anyway.
    await a11y("doNext");
    await a11y("moveUp");
    expect(first.onDoNext).not.toHaveBeenCalled();
    expect(first.onMove).not.toHaveBeenCalled();
    await screen.unmount();

    const last = await renderRow({ reorder: { canDoNext: true, canMoveUp: true, canMoveDown: false } });
    expect(reorderActions()).toEqual(["doNext", "moveUp"]);
    await a11y("moveDown");
    expect(last.onMove).not.toHaveBeenCalled();
  });

  it("the second open row offers Do this next but not Move up (they'd do the same)", async () => {
    // What the list hands the second of three open rows (reorderOptions).
    await renderRow({ reorder: { canDoNext: true, canMoveUp: false, canMoveDown: true } });
    expect(reorderActions()).toEqual(["doNext", "moveDown"]);
  });

  it("a done row offers nothing, whatever it is handed", async () => {
    const { onDoNext, onMove } = await renderRow({
      completed: true,
      reorder: ALL,
      dragGesture: Gesture.Pan(),
      moveInMenu: true,
    });
    expect(reorderActions()).toEqual([]);
    const menu = await openMenu();
    expect(menu.options).not.toContain("Do this next");
    expect(menu.options).not.toContain("Move up");
    expect(menu.options).not.toContain("Move down");
    for (const name of ["doNext", "moveUp", "moveDown"]) await a11y(name);
    expect(onDoNext).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(handle()).toBeNull();
  });

  it("without the reorder props (or their handlers) a row is as it was before 1.4", async () => {
    await renderRow();
    expect(reorderActions()).toEqual([]);
    expect((await openMenu()).options).not.toContain("Do this next");
    expect(handle()).toBeNull();
    await screen.unmount();

    await renderRow({ reorder: ALL, onDoNext: undefined, onMove: undefined, moveInMenu: true });
    expect(reorderActions()).toEqual([]);
    expect((await openMenu()).options).not.toContain("Move up");
  });

  it("works on a set day (not editable), where it is the menu's one choice", async () => {
    const { onDoNext } = await renderRow({ editable: false, reorder: ALL });
    const menu = await openMenu();
    expect(menu.options).toEqual(["Do this next", "Cancel"]);
    await menu.pick("Do this next");
    expect(onDoNext).toHaveBeenCalledTimes(1);
  });
});

describe("TaskRow: no room for the handle (narrow window, large text)", () => {
  it("the menu offers Move up and Move down beside Do this next, and they move the row", async () => {
    const { onMove, onDoNext } = await renderRow({ editable: false, reorder: ALL, moveInMenu: true });
    expect(handle()).toBeNull();
    let menu = await openMenu();
    expect(menu.options).toEqual(["Do this next", "Move up", "Move down", "Cancel"]);
    await menu.pick("Move up");
    expect(onMove).toHaveBeenLastCalledWith("up");
    menu = await openMenu();
    await menu.pick("Move down");
    expect(onMove).toHaveBeenLastCalledWith("down");
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onDoNext).not.toHaveBeenCalled();
  });

  it("only the moves that would do something are there", async () => {
    // Second of three: up is Do this next's job.
    await renderRow({ reorder: { canDoNext: true, canMoveUp: false, canMoveDown: true }, moveInMenu: true });
    let { options } = await openMenu();
    expect(options).toContain("Do this next");
    expect(options).not.toContain("Move up");
    expect(options).toContain("Move down");
    await screen.unmount();

    // First: only down.
    await renderRow({ reorder: { canDoNext: false, canMoveUp: false, canMoveDown: true }, moveInMenu: true });
    ({ options } = await openMenu());
    expect(options).not.toContain("Do this next");
    expect(options).not.toContain("Move up");
    expect(options).toContain("Move down");
  });
});

describe("TaskRow: the drag handle", () => {
  it("shows only when the list hands the row a gesture, and VoiceOver skips it", async () => {
    await renderRow({ reorder: ALL });
    expect(handle()).toBeNull();
    await screen.unmount();

    await renderRow({ reorder: ALL, dragGesture: Gesture.Pan() });
    expect(handle()).not.toBeNull();
    expect(screen.queryByTestId("task-drag-walk")).toBeNull();
    expect(handle()!.props.accessibilityElementsHidden).toBe(true);
    expect(handle()!.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  it("is a real 44 by 44 target: the view's own hit slop, not only the gesture's", async () => {
    await renderRow({ reorder: ALL, dragGesture: Gesture.Pan() });
    const view = handle()!;
    expect(view.props.hitSlop).toEqual(HANDLE_HIT_SLOP);
    const style = [view.props.style].flat(Infinity).reduce((all, part) => ({ ...all, ...part }), {});
    expect(style.width + HANDLE_HIT_SLOP.left + HANDLE_HIT_SLOP.right).toBeGreaterThanOrEqual(44);
    expect(style.height + HANDLE_HIT_SLOP.top + HANDLE_HIT_SLOP.bottom).toBeGreaterThanOrEqual(44);
    // The slop to the right stays inside the row (16 of padding, less the pull).
    expect(HANDLE_HIT_SLOP.right).toBeLessThanOrEqual(16 + style.marginRight);
  });

  it("a tap on it (no movement) opens the row's menu, so it is never a dead control", async () => {
    await renderRow({ reorder: ALL, dragGesture: Gesture.Pan() });
    const tap = getByGestureTestId("task-handle-tap-walk");
    // A touch that moved off, or was taken by the drag: nothing.
    await act(async () => tap.handlers.onEnd?.({} as never, false));
    expect(sheet).not.toHaveBeenCalled();
    await act(async () => tap.handlers.onEnd?.({} as never, true));
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(shownMenu().options).toContain("Do this next");
  });

  it("goes while the row's text is being edited, and comes back after", async () => {
    await renderRow({ reorder: ALL, dragGesture: Gesture.Pan() });
    await (await openMenu()).pick("Edit");
    const input = screen.getByDisplayValue("Walk");
    expect(handle()).toBeNull();
    await fireEvent(input, "submitEditing");
    expect(handle()).not.toBeNull();
  });

  it("after a move, VoiceOver's focus comes back to the row", async () => {
    jest.useFakeTimers();
    const focus = AccessibilityInfo.sendAccessibilityEvent as jest.Mock;
    focus.mockClear();
    const handlers = rowHandlers();
    const row = (tick: number) => (
      <TaskRow task={WALK} index={1} completed={false} editable reorder={ALL} focusTick={tick} {...handlers} />
    );
    const view = await render(row(0));
    await act(async () => jest.advanceTimersByTime(1000));
    expect(focus).not.toHaveBeenCalled();

    await view.rerender(row(1));
    expect(focus).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(400));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.calls[0][1]).toBe("focus");
    // Not again until the next move.
    await view.rerender(row(1));
    await act(async () => jest.advanceTimersByTime(400));
    expect(focus).toHaveBeenCalledTimes(1);
    await view.rerender(row(2));
    await act(async () => jest.advanceTimersByTime(400));
    expect(focus).toHaveBeenCalledTimes(2);
  });
});

describe("TaskRow: the dragged row's copy (ghost)", () => {
  const session: FocusSession = {
    id: "s1",
    taskId: "walk",
    taskText: "Walk",
    stepText: "Shoes on",
    date: "2026-10-10",
    kind: "timer",
    durationMs: 10 * 60_000,
    startedAt: Date.now(),
    endAt: Date.now() + 10 * 60_000,
    pausedRemainingMs: null,
    status: "running",
  };
  const controls = {
    pause: jest.fn(),
    resume: jest.fn(),
    stop: jest.fn(),
    takeBreak: jest.fn(),
    extend: jest.fn(),
    keepGoing: jest.fn(),
    done: jest.fn(),
  };
  const BUSY: Task = {
    ...WALK,
    carriedOver: true,
    routineId: "r1",
    steps: [{ id: "s", text: "Shoes on", done: false }],
  };
  const allTestIds = () =>
    screen
      .queryAllByTestId(/./, { includeHiddenElements: true })
      .map((node) => node.props.testID as string)
      .sort();

  it("shows the handle without a gesture, but not on a done row", async () => {
    await renderRow({ ghost: true });
    // The handle is drawn (its glyph), with no testID of its own.
    expect(handle()).toBeNull();
    expect(allTestIds()).toEqual([]);
    await screen.unmount();
    await renderRow({ ghost: true, completed: true });
    expect(allTestIds()).toEqual([]);
  });

  it("beside its real row (timed, with steps, carried over, a routine) no testID is there twice", async () => {
    const handlers = rowHandlers();
    const row = (ghost: boolean) => (
      <TaskRow
        task={BUSY}
        index={1}
        completed={false}
        editable
        hero
        reorder={ALL}
        dragGesture={ghost ? undefined : Gesture.Pan()}
        onTimer={jest.fn()}
        onBreakDown={jest.fn()}
        breakDownNeedsPlus
        session={session}
        controls={controls}
        ghost={ghost}
        {...handlers}
      />
    );
    await render(row(false));
    const real = allTestIds();
    expect(real).toEqual(expect.arrayContaining(["task-row-walk", "task-drag-walk", "task-timer-running-walk"]));
    expect(new Set(real).size).toBe(real.length);
    await screen.unmount();

    await render(
      <>
        {row(false)}
        {row(true)}
      </>,
    );
    // The copy adds nothing with a testID: the same ids as the real row alone.
    expect(allTestIds()).toEqual(real);
    // And it does look the same: the words are there twice.
    expect(screen.getAllByText(/Walk/, { includeHiddenElements: true }).length).toBeGreaterThanOrEqual(2);
  });

  it("has no swipe of its own and no ticking clock (it shows the time it was picked up at)", async () => {
    jest.useFakeTimers({ now: session.startedAt });
    await render(
      <TaskRow
        task={WALK}
        index={1}
        completed={false}
        editable
        session={session}
        controls={controls}
        ghost
        {...rowHandlers()}
      />,
    );
    expect(screen.getByText("10:00", { includeHiddenElements: true })).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(5000));
    // A live row would read 9:55 by now.
    expect(screen.getByText("10:00", { includeHiddenElements: true })).toBeTruthy();
    // No swipe actions were rendered for it.
    expect(screen.queryByTestId(/row-actions/, { includeHiddenElements: true })).toBeNull();
  });
});

// --- The drag itself (hook level) --------------------------------------------

const item = (id: string) => ({ id });
const LIST = [item("a"), item("b"), item("c")];

interface HookProps {
  tasks: { id: string }[];
  completedIds: string[];
  reduceMotion?: boolean;
  heroId?: string | null;
}

async function renderReorder(initialProps: HookProps, scrollRef?: { current: unknown }) {
  const onPickUp = jest.fn();
  const onSlotChange = jest.fn();
  const onDrop = jest.fn();
  const renders = { count: 0 };
  const hook = await renderHook(
    ({ tasks, completedIds, reduceMotion = false, heroId = null }: HookProps) => {
      renders.count += 1;
      return useTaskReorder({ tasks, completedIds, reduceMotion, heroId, scrollRef, onPickUp, onSlotChange, onDrop });
    },
    { initialProps },
  );
  return { ...hook, onPickUp, onSlotChange, onDrop, renders };
}

/** The hook with a list of its own that a drop reorders, as the store does. */
async function renderReorderWithStore(initial: { id: string }[], completedIds: string[] = []) {
  const onDrop = jest.fn();
  const hook = await renderHook(() => {
    const [tasks, setTasks] = useState(initial);
    // "Up next" is the first open task.
    const heroId = tasks.find((task) => !completedIds.includes(task.id))?.id ?? null;
    const reorder = useTaskReorder({
      tasks,
      completedIds,
      reduceMotion: false,
      heroId,
      onPickUp: () => {},
      onDrop: (id, to, from) => {
        onDrop(id, to, from);
        setTasks((current) => moveOpenTask(current, completedIds, id, to));
      },
    });
    return { reorder, tasks, heroId, moveNext: (id: string) => setTasks((c) => moveOpenTask(c, completedIds, id, 0)) };
  });
  return { ...hook, onDrop };
}

type Reorder = { current: ReturnType<typeof useTaskReorder> };

/**
 * Lay the rows out as the card does: each wrapper holds the 1pt hairline above
 * its row (not the first), so the rows themselves are `heights` tall.
 */
async function layOut(reorder: () => ReturnType<typeof useTaskReorder>, tasks: { id: string }[], heights: number[]) {
  let y = 0;
  await act(async () => {
    tasks.forEach((task, index) => {
      const height = heights[index] + (index > 0 ? 1 : 0);
      reorder().onRowLayout(task.id, index, { nativeEvent: { layout: { x: 0, y, width: 390, height } } } as never);
      y += height;
    });
  });
}

// The gesture's callbacks, called as the gesture handler would (the reanimated
// mock runs worklets and runOnJS inline). A pick-up is a touch (onBegin) that
// then moved up or down (onStart).
const touch = (gesture: GestureType) => act(async () => gesture.handlers.onBegin?.({} as never));
const pickUp = (gesture: GestureType, translationY = 0) =>
  act(async () => {
    gesture.handlers.onBegin?.({} as never);
    gesture.handlers.onStart?.({ translationY } as never);
  });
const dragBy = (gesture: GestureType, translationY: number) =>
  act(async () => gesture.handlers.onUpdate?.({ translationY } as never));
const letGo = (gesture: GestureType, success = true) =>
  act(async () => gesture.handlers.onFinalize?.({} as never, success));
/** Past a drop's afters: the "Up next" swap, then its layout transition (two timers, one after the other). */
async function settle() {
  await act(async () => jest.advanceTimersByTime(DROP_SWAP_DELAY_MS + 1));
  await act(async () => jest.advanceTimersByTime(2000));
}
const offsets = (result: Reorder) => result.current.shifts.value.offsets;
const NONE = { a: 0, b: 0, c: 0 };
const AT_REST = { epoch: -1, offsets: {}, animate: false };

describe("useTaskReorder: the handle's gesture", () => {
  it("picks up on the first vertical movement (no hold), and a sideways one is left to the row's swipe", async () => {
    const scrollRef = { current: { handlerTag: 77 } };
    const { result } = await renderReorder({ tasks: LIST, completedIds: [] }, scrollRef);
    const { config } = result.current.gestures.a;
    expect(config.activeOffsetYStart).toBe(-DRAG_ACTIVATE_PT);
    expect(config.activeOffsetYEnd).toBe(DRAG_ACTIVATE_PT);
    expect(config.failOffsetXStart).toBe(-DRAG_FAIL_X_PT);
    expect(config.failOffsetXEnd).toBe(DRAG_FAIL_X_PT);
    expect(config.activateAfterLongPress).toBeUndefined();
    expect(config.hitSlop).toEqual(HANDLE_HIT_SLOP);
    // The page's scroll waits for the drag: on the handle, the drag wins.
    expect(config.blocksHandlers).toEqual([scrollRef]);
  });

  it("is one gesture per task, the same object across renders", async () => {
    const { result, rerender } = await renderReorder({ tasks: LIST, completedIds: [] });
    const before = result.current.gestures;
    expect(Object.keys(before)).toEqual(["a", "b", "c"]);
    await rerender({ tasks: [...LIST], completedIds: ["b"] });
    expect(result.current.gestures.a).toBe(before.a);
    expect(result.current.gestures.c).toBe(before.c);
  });
});

describe("useTaskReorder: a drag", () => {
  // a 40 tall, b (done) 80 tall, c 60 tall: a's two resting places are tops 0 and 142.
  const HEIGHTS = [40, 80, 60];

  it("slides the other rows on the UI thread (no render, the order untouched), then drops once at the open index", async () => {
    const { result, onPickUp, onSlotChange, onDrop, renders } = await renderReorder({
      tasks: LIST,
      completedIds: ["b"],
    });
    await layOut(() => result.current, LIST, HEIGHTS);
    expect(result.current.draggingId).toBeNull();

    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    expect(onPickUp).toHaveBeenCalledTimes(1);
    expect(result.current.draggingId).toBe("a");
    expect(result.current.ghostTop).toBe(0);
    expect(result.current.ghostHeight).toBe(40);
    expect(result.current.lift.value).toBe(1);
    expect(result.current.liftId.value).toBe("a");
    expect(offsets(result)).toEqual({});
    const rendersHeld = renders.count;

    // Not far enough yet (centre 90 of a 0..182 card; halfway is 91).
    await dragBy(gesture, 70);
    expect(offsets(result)).toEqual({});
    expect(onSlotChange).not.toHaveBeenCalled();
    // Past halfway: the open rows trade places around the done one, each by
    // its own distance (a 40 tall and c 60 tall, so b sits 20 lower).
    await dragBy(gesture, 72);
    expect(offsets(result)).toEqual({ a: 142, b: 20, c: -122 });
    expect(result.current.shifts.value.animate).toBe(true);
    expect(result.current.dragY.value).toBe(72);
    expect(onSlotChange).toHaveBeenCalledTimes(1);
    // The row stays inside the task rows however far the finger goes.
    await dragBy(gesture, 900);
    expect(result.current.dragY.value).toBe(142);
    expect(onSlotChange).toHaveBeenCalledTimes(1);
    await dragBy(gesture, -900);
    expect(result.current.dragY.value).toBe(0);
    expect(offsets(result)).toEqual(NONE);
    await dragBy(gesture, 140);
    expect(offsets(result)).toEqual({ a: 142, b: 20, c: -122 });
    // One tick per place passed, and nothing else happened in React: no
    // render for any of it, and nothing dropped.
    expect(onSlotChange).toHaveBeenCalledTimes(3);
    expect(renders.count).toBe(rendersHeld);
    expect(onDrop).not.toHaveBeenCalled();

    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledTimes(1);
    // (task, to, from), both counted among the open tasks.
    expect(onDrop).toHaveBeenCalledWith("a", 1, 0);
    expect(result.current.draggingId).toBeNull();
    // The ghost settled on the row's new place, and is put down.
    expect(result.current.dragY.value).toBe(142);
    expect(result.current.lift.value).toBe(0);
    // In the drop's own render the slides are gone, without a slide back.
    expect(result.current.shifts.value).toEqual(AT_REST);
    expect(onPickUp).toHaveBeenCalledTimes(1);
  });

  it("follows the finger from where the row lifted, not from where the touch began", async () => {
    const { result } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, [40, 40, 40]);
    const gesture = result.current.gestures.a;
    // The finger had already travelled 6pt when the row lifted.
    await pickUp(gesture, DRAG_ACTIVATE_PT);
    expect(result.current.dragY.value).toBe(0);
    await dragBy(gesture, 16);
    expect(result.current.dragY.value).toBe(10);
  });

  it("a drop back where it started, or an interrupted drag, asks for no change of place", async () => {
    const { result, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, [40, 40, 40]);
    const gesture = result.current.gestures.c;

    await pickUp(gesture);
    await dragBy(gesture, -80);
    expect(offsets(result)).toEqual({ a: 41, b: 41, c: -82 });
    await dragBy(gesture, 0);
    expect(offsets(result)).toEqual(NONE);
    await letGo(gesture);
    expect(result.current.draggingId).toBeNull();
    expect(onDrop).toHaveBeenLastCalledWith("c", 2, 2);

    // Interrupted mid-drag (a call, the app switcher): back where it was.
    await pickUp(gesture);
    await dragBy(gesture, -80);
    expect(offsets(result)).toEqual({ a: 41, b: 41, c: -82 });
    await letGo(gesture, false);
    expect(result.current.draggingId).toBeNull();
    expect(result.current.dragY.value).toBe(0);
    expect(onDrop).toHaveBeenLastCalledWith("c", 2, 2);
    expect(onDrop).toHaveBeenCalledTimes(2);
  });

  it("a done row, and a touch that never moved (a tap, a swipe), pick nothing up", async () => {
    const { result, onPickUp, onDrop } = await renderReorder({ tasks: LIST, completedIds: ["b"] });
    await layOut(() => result.current, LIST, HEIGHTS);
    await pickUp(result.current.gestures.b);
    expect(result.current.draggingId).toBeNull();
    await letGo(result.current.gestures.b, false);

    // A touch lifts the row a little straight away; letting go puts it back.
    await touch(result.current.gestures.a);
    expect(result.current.liftId.value).toBe("a");
    expect(result.current.lift.value).toBe(1);
    await letGo(result.current.gestures.a, false);
    expect(result.current.lift.value).toBe(0);
    await letGo(result.current.gestures.a, true);
    expect(onPickUp).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();
  });

  it("only one row is held at a time", async () => {
    const { result, onPickUp, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, [40, 40, 40]);
    await pickUp(result.current.gestures.a);
    await pickUp(result.current.gestures.c);
    expect(result.current.draggingId).toBe("a");
    expect(result.current.liftId.value).toBe("a");
    expect(onPickUp).toHaveBeenCalledTimes(1);
    await dragBy(result.current.gestures.c, -80);
    await letGo(result.current.gestures.c);
    expect(offsets(result)).toEqual({});
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBe("a");
  });

  it("with Reduce Motion the rows don't slide (they are just there) and the drop still lands", async () => {
    const { result, onDrop } = await renderReorder({ tasks: LIST, completedIds: [], reduceMotion: true });
    await layOut(() => result.current, LIST, [40, 40, 40]);
    const gesture = result.current.gestures.b;
    await pickUp(gesture);
    expect(result.current.lift.value).toBe(1);
    expect(result.current.rowTransition).toBeUndefined();
    await dragBy(gesture, -41);
    expect(offsets(result)).toEqual({ a: 41, b: -41, c: 0 });
    expect(result.current.shifts.value.animate).toBe(false);
    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledWith("b", 0, 1);
    expect(result.current.rowTransition).toBeUndefined();
  });
});

describe("useTaskReorder: races", () => {
  const HEIGHTS = [40, 40, 40];

  it("a drop that arrives before the render the pick-up asked for still drops, and nothing stays held", async () => {
    jest.useFakeTimers();
    const { result, onPickUp, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    // Lifted, moved and let go, all before React rendered once.
    await act(async () => {
      gesture.handlers.onBegin?.({} as never);
      gesture.handlers.onStart?.({ translationY: 0 } as never);
      gesture.handlers.onUpdate?.({ translationY: 82 } as never);
      gesture.handlers.onFinalize?.({} as never, true);
    });
    expect(onPickUp).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith("a", 2, 0);
    expect(result.current.draggingId).toBeNull();
    expect(result.current.shifts.value).toEqual(AT_REST);

    // Not stuck: once the drop has settled, the next drag picks up and drops as usual.
    await settle();
    const again = result.current.gestures.c;
    await pickUp(again);
    expect(result.current.draggingId).toBe("c");
    await letGo(again);
    expect(result.current.draggingId).toBeNull();
    expect(onDrop).toHaveBeenCalledTimes(2);
  });

  it("a touch on the handle while the drop settles doesn't drop a second time", async () => {
    const { result, onDrop, onPickUp } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 41);
    mockTiming.hold = true;
    await letGo(gesture);
    // Still settling: the ghost is up and nothing was dropped yet.
    expect(mockTiming.held).toHaveLength(1);
    expect(result.current.draggingId).toBe("a");
    expect(onDrop).not.toHaveBeenCalled();

    // A tap on the same handle, and one on another row's.
    await touch(gesture);
    await letGo(gesture, false);
    await pickUp(result.current.gestures.c);
    await letGo(result.current.gestures.c, true);
    expect(mockTiming.held).toHaveLength(1);
    expect(onPickUp).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();

    mockTiming.hold = false;
    await act(async () => mockTiming.held.splice(0).forEach((land) => land()));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith("a", 1, 0);
    expect(result.current.draggingId).toBeNull();
  });

  it("after the screen is gone, a late pick-up or drop does nothing", async () => {
    const { result, unmount, onPickUp, onDrop, onSlotChange } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, HEIGHTS);
    const { a, c } = result.current.gestures;
    await pickUp(a);
    await dragBy(a, 41);
    mockTiming.hold = true;
    await letGo(a);
    await unmount();
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    // The settle lands, and another handle is touched, after the unmount.
    await act(async () => mockTiming.held.splice(0).forEach((land) => land()));
    mockTiming.hold = false;
    await pickUp(c);
    await dragBy(c, -82);
    await letGo(c);
    expect(onDrop).not.toHaveBeenCalled();
    expect(onPickUp).toHaveBeenCalledTimes(1);
    expect(onSlotChange).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("useTaskReorder: the list changes under a drag", () => {
  const HEIGHTS = [40, 40, 40];

  it("a tick from the widget puts the row back: no slide left over, no drop, and the next drag works", async () => {
    const { result, rerender, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 82);
    expect(offsets(result)).toEqual({ a: 82, b: -41, c: -41 });

    // "c" is ticked in the widget while "a" is in the air.
    await rerender({ tasks: LIST, completedIds: ["c"] });
    expect(result.current.draggingId).toBeNull();
    expect(result.current.shifts.value).toEqual(AT_REST);

    // The finger keeps moving, then lifts: nothing follows it and nothing is saved.
    await dragBy(gesture, 82);
    expect(offsets(result)).toEqual({});
    await letGo(gesture);
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();

    // A new drag measures against the list as it is now: two open rows.
    await pickUp(gesture);
    expect(result.current.draggingId).toBe("a");
    await dragBy(gesture, 41);
    expect(offsets(result)).toEqual({ a: 41, b: -41, c: 0 });
    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith("a", 1, 0);
  });

  it("the day rolling over (other tasks, or none) cancels it too", async () => {
    const { result, rerender, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 82);
    expect(result.current.draggingId).toBe("a");

    await rerender({ tasks: [], completedIds: [] });
    expect(result.current.draggingId).toBeNull();
    await letGo(gesture);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("a render that changes nothing about the list keeps the drag going", async () => {
    const { result, rerender, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(() => result.current, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 82);
    // New arrays, same tasks in the same state (any other store change).
    await rerender({ tasks: [...LIST], completedIds: [] });
    expect(result.current.draggingId).toBe("a");
    expect(offsets(result)).toEqual({ a: 82, b: -41, c: -41 });
    // The same gesture object still holds the touch.
    expect(result.current.gestures.a).toBe(gesture);
    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledWith("a", 2, 0);
  });
});

describe("the drop's own render moves nothing", () => {
  // The slides are on the UI thread and get re-applied to every React commit,
  // so they can't be zeroed "at the same time" as the new order from here.
  // Instead the drop mounts the rows anew, and a slide only counts for the
  // rows of the drag it was made in.
  const slot = (id: string) => screen.getByTestId(`task-slot-${id}`, { includeHiddenElements: true });
  const translateY = (id: string) =>
    (StyleSheet.flatten(slot(id).props.style).transform as { translateY?: number }[]).find(
      (part) => part.translateY !== undefined,
    )?.translateY;
  const rowFor = (epoch: number, shifts: RowShifts, draggingId: string | null = null) => (
    <ReorderRow
      id="a"
      index={0}
      reorder={{
        draggingId,
        shifts: { value: shifts } as never,
        epoch,
        lift: { value: 0 } as never,
        liftId: { value: null } as never,
        onRowLayout: () => {},
        rowTransition: undefined,
      }}
    >
      <Text>Row</Text>
    </ReorderRow>
  );

  it("a row slides only for the drag it was mounted in: one mounted by the drop starts at rest", async () => {
    const sliding: RowShifts = { epoch: 3, offsets: { a: 61, b: -61 }, animate: true };
    await render(rowFor(3, sliding));
    expect(translateY("a")).toBe(61);
    await screen.unmount();
    // The same slides, still there on the UI thread, when the drop's render mounts the row.
    await render(rowFor(4, sliding));
    expect(translateY("a")).toBe(0);
    await screen.unmount();
    // At rest, and a row that isn't moving.
    await render(rowFor(4, { epoch: -1, offsets: {}, animate: false }));
    expect(translateY("a")).toBe(0);
    await screen.unmount();
    await render(rowFor(4, { epoch: 4, offsets: { b: 12 }, animate: true }));
    expect(translateY("a")).toBe(0);
  });

  it("the held row's own place is invisible (the ghost shows), and comes back", async () => {
    const at: RowShifts = { epoch: 0, offsets: {}, animate: false };
    await render(rowFor(0, at, "a"));
    expect(StyleSheet.flatten(slot("a").props.style).opacity).toBe(0);
    await screen.unmount();
    await render(rowFor(0, at, "b"));
    expect(StyleSheet.flatten(slot("a").props.style).opacity).toBeUndefined();
  });

  it("a drop that changed the order gives the rows new keys; one that didn't, a cancel and a plain reorder don't", async () => {
    jest.useFakeTimers();
    const { result } = await renderReorderWithStore(LIST);
    await layOut(() => result.current.reorder, LIST, [40, 40, 40]);
    const gesture = result.current.reorder.gestures.a;
    expect(result.current.reorder.epoch).toBe(0);
    expect(reorderRowKey("a", 0)).not.toBe(reorderRowKey("a", 1));

    // Held, and slid over a place: the rows keep their keys the whole time.
    await pickUp(gesture);
    await dragBy(gesture, 41);
    expect(result.current.reorder.epoch).toBe(0);
    expect(result.current.reorder.shifts.value.epoch).toBe(0);
    await dragBy(gesture, 0);
    await letGo(gesture);
    // Dropped back where it started.
    expect(result.current.reorder.epoch).toBe(0);
    await settle();

    // "Do this next": the saved order changes, the rows stay mounted.
    await act(async () => result.current.moveNext("c"));
    expect(result.current.tasks.map((task) => task.id)).toEqual(["c", "a", "b"]);
    expect(result.current.reorder.epoch).toBe(0);

    // A real drop: new keys in the very render that has the new order.
    await layOut(() => result.current.reorder, result.current.tasks, [40, 40, 40]);
    const held = result.current.reorder.gestures.b;
    await pickUp(held);
    await dragBy(held, -82);
    await letGo(held);
    expect(result.current.tasks.map((task) => task.id)).toEqual(["b", "c", "a"]);
    expect(result.current.reorder.epoch).toBe(1);
    // And the next drag's slides are for the rows as they are now.
    await settle();
    await pickUp(held);
    expect(result.current.reorder.shifts.value.epoch).toBe(1);
  });
});

describe("useTaskReorder: after the drop", () => {
  it("the rows are known to be where the drop put them, before their layout says so", async () => {
    jest.useFakeTimers();
    const { result, onDrop } = await renderReorderWithStore(LIST);
    await layOut(() => result.current.reorder, LIST, [40, 80, 60]);
    const gesture = result.current.reorder.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 200);
    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledWith("a", 2, 0);
    expect(result.current.tasks.map((task) => task.id)).toEqual(["b", "c", "a"]);
    expect(result.current.reorder.shifts.value).toEqual(AT_REST);

    // No layout events since. A drag once things have settled starts from a's
    // new place: under b (80) and c (60) and their hairlines.
    await settle();
    await pickUp(gesture);
    expect(result.current.reorder.draggingId).toBe("a");
    expect(result.current.reorder.ghostTop).toBe(142);
  });

  it("'Up next' keeps its old row for the drop's own render, then follows, eased by a layout transition", async () => {
    jest.useFakeTimers();
    const { result } = await renderReorderWithStore(LIST);
    await layOut(() => result.current.reorder, LIST, [40, 40, 40]);
    expect(result.current.reorder.heroId).toBe("a");
    expect(result.current.reorder.rowTransition).toBeUndefined();

    const gesture = result.current.reorder.gestures.c;
    await pickUp(gesture);
    // Nothing is eased by layout while a row is held: the rows slide.
    expect(result.current.reorder.rowTransition).toBeUndefined();
    await dragBy(gesture, -82);
    await letGo(gesture);
    // The order is saved, and nothing about the rows' heights changed with it.
    expect(result.current.tasks.map((task) => task.id)).toEqual(["c", "a", "b"]);
    expect(result.current.heroId).toBe("c");
    expect(result.current.reorder.heroId).toBe("a");
    expect(result.current.reorder.rowTransition).toBeUndefined();

    // No pick-up meanwhile.
    await pickUp(result.current.reorder.gestures.a);
    expect(result.current.reorder.draggingId).toBeNull();
    await letGo(result.current.reorder.gestures.a, false);

    await act(async () => jest.advanceTimersByTime(DROP_SWAP_DELAY_MS + 1));
    expect(result.current.reorder.heroId).toBe("c");
    expect(result.current.reorder.rowTransition).toBeDefined();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.reorder.rowTransition).toBeUndefined();

    // And then rows can be picked up again.
    await pickUp(result.current.reorder.gestures.a);
    expect(result.current.reorder.draggingId).toBe("a");
  });
});

describe("useTaskReorder: a reorder that isn't a drag (Do this next, Move up/down)", () => {
  it("turns the rows' layout transition on first, then makes the change, then turns it off", async () => {
    jest.useFakeTimers();
    // What happened, in order: each render (is the transition on the rows?) and the change.
    const seen: string[] = [];
    const { result } = await renderHook(() => {
      const reorder = useTaskReorder({
        tasks: LIST,
        completedIds: [],
        reduceMotion: false,
        onPickUp: () => {},
        onDrop: () => {},
      });
      seen.push(reorder.rowTransition ? "render: eased" : "render: plain");
      return reorder;
    });
    seen.length = 0;
    await act(async () => {
      result.current.animateNext(() => seen.push("change"));
      // Not yet: the transition has to be on the rows first.
      seen.push("asked");
    });
    expect(seen.slice(0, 3)).toEqual(["asked", "render: eased", "change"]);
    expect(seen).not.toContain("render: plain");
    expect(result.current.rowTransition).toBeDefined();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.rowTransition).toBeUndefined();
  });

  it("with Reduce Motion it just happens: no transition at all", async () => {
    const { result } = await renderReorder({ tasks: LIST, completedIds: [], reduceMotion: true });
    const change = jest.fn();
    await act(async () => {
      result.current.animateNext(change);
      expect(change).toHaveBeenCalledTimes(1);
    });
    expect(result.current.rowTransition).toBeUndefined();
  });
});
