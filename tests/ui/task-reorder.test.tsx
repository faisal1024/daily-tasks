// Reordering in the row and the drag (1.4, PR #90): what a TaskRow offers
// (menu, VoiceOver actions, the handle), and useTaskReorder's drag: preview,
// drop, and a list change underneath putting the row back without a move.
import { ActionSheetIOS } from "react-native";
import { act, fireEvent, renderHook, screen } from "@testing-library/react-native";
import { Gesture, type GestureType } from "react-native-gesture-handler";

import { useTaskReorder } from "@/components/daily-tasks/task-reorder";
import { TaskRow } from "@/components/daily-tasks/task-row";
import type { Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

// The library's mock hands out a new shared value on every render; the real
// one keeps it for the component's life, which the drag relies on (its gesture
// is made once and outlives the preview's re-renders). So: one that's kept.
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
  const { useRef } = require("react");
  return {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
    ...require("react-native-reanimated/mock"),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: <T,>(initial: T) => useRef({ value: initial }).current,
  };
});

const WALK: Task = { id: "walk", text: "Walk", createdAt: "", carriedOver: false };
const ALL = { canDoNext: true, canMoveUp: true, canMoveDown: true };

type RowProps = Partial<Omit<React.ComponentProps<typeof TaskRow>, "session" | "controls">>;
async function renderRow(props: RowProps = {}) {
  const handlers = {
    onToggle: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onNotToday: jest.fn(),
    onDoNext: jest.fn(),
    onMove: jest.fn(),
  };
  await render(<TaskRow task={WALK} index={1} completed={false} editable {...handlers} {...props} />);
  return handlers;
}

let sheet: jest.SpyInstance;
beforeEach(() => {
  sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
});
afterEach(() => sheet.mockRestore());

const box = () => screen.getByRole("checkbox", { name: /Task 2: Walk/ });
const actionNames = () => (box().props.accessibilityActions as { name: string }[]).map((action) => action.name);
const reorderActions = () => actionNames().filter((name) => ["doNext", "moveUp", "moveDown"].includes(name));
const a11y = (actionName: string) => fireEvent(box(), "accessibilityAction", { nativeEvent: { actionName } });
// The words and the handle are hidden from VoiceOver (the checkbox has the actions).
const words = () => screen.getByTestId("task-words-walk", { includeHiddenElements: true });
const handle = () => screen.queryByTestId("task-drag-walk", { includeHiddenElements: true });
/** Opens the row's menu from its words; gives its labels and a way to pick one. */
async function openMenu() {
  sheet.mockClear();
  await fireEvent.press(words());
  if (sheet.mock.calls.length === 0) return { options: [] as string[], pick: async () => {} };
  const [{ options }, callback] = sheet.mock.calls[0] as [{ options: string[] }, (index: number) => void];
  return { options, pick: async (label: string) => act(async () => callback(options.indexOf(label))) };
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
    // Moving one place is VoiceOver's (and the handle's), not the menu's.
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

  it("a done row offers nothing, whatever it is handed", async () => {
    const { onDoNext, onMove } = await renderRow({ completed: true, reorder: ALL, dragGesture: Gesture.Pan() });
    expect(reorderActions()).toEqual([]);
    expect((await openMenu()).options).not.toContain("Do this next");
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

    await renderRow({ reorder: ALL, onDoNext: undefined, onMove: undefined });
    expect(reorderActions()).toEqual([]);
  });

  it("works on a set day (not editable): Do this next sits beside Not today", async () => {
    const { onDoNext } = await renderRow({ editable: false, reorder: ALL });
    const menu = await openMenu();
    expect(menu.options).toEqual(["Do this next", "Not today", "Cancel"]);
    await menu.pick("Do this next");
    expect(onDoNext).toHaveBeenCalledTimes(1);
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

  it("goes while the row's text is being edited, and comes back after", async () => {
    await renderRow({ reorder: ALL, dragGesture: Gesture.Pan() });
    await (await openMenu()).pick("Edit");
    const input = screen.getByDisplayValue("Walk");
    expect(handle()).toBeNull();
    await fireEvent(input, "submitEditing");
    expect(handle()).not.toBeNull();
  });

  it("the dragged row's copy shows the handle without a gesture, but not on a done row", async () => {
    await renderRow({ dragHandleOnly: true });
    expect(handle()).not.toBeNull();
    await screen.unmount();
    await renderRow({ dragHandleOnly: true, completed: true });
    expect(handle()).toBeNull();
  });
});

// --- The drag itself (hook level) --------------------------------------------

const item = (id: string) => ({ id });
const LIST = [item("a"), item("b"), item("c")];

interface HookProps {
  tasks: { id: string }[];
  completedIds: string[];
  reduceMotion?: boolean;
}

async function renderReorder(initialProps: HookProps) {
  const onPickUp = jest.fn();
  const onDrop = jest.fn();
  const hook = await renderHook(
    ({ tasks, completedIds, reduceMotion = false }: HookProps) =>
      useTaskReorder({ tasks, completedIds, reduceMotion, onPickUp, onDrop }),
    { initialProps },
  );
  return { ...hook, onPickUp, onDrop };
}

type Reorder = { current: ReturnType<typeof useTaskReorder<{ id: string }>> };

/**
 * Lay the rows out as the card does: each wrapper holds the 1pt hairline above
 * its row (not the first), so the rows themselves are `heights` tall.
 */
async function layOut(result: Reorder, tasks: { id: string }[], heights: number[]) {
  let y = 0;
  await act(async () => {
    tasks.forEach((task, index) => {
      const height = heights[index] + (index > 0 ? 1 : 0);
      result.current.onRowLayout(task.id, index, { nativeEvent: { layout: { x: 0, y, width: 390, height } } } as never);
      y += height;
    });
  });
}

// The gesture's callbacks, called as the gesture handler would (the reanimated
// mock runs worklets and runOnJS inline).
const pickUp = (gesture: GestureType) => act(async () => gesture.handlers.onStart?.({ translationY: 0 } as never));
const dragBy = (gesture: GestureType, translationY: number) =>
  act(async () => gesture.handlers.onUpdate?.({ translationY } as never));
const letGo = (gesture: GestureType, success = true) =>
  act(async () => gesture.handlers.onFinalize?.({} as never, success));
const ids = (result: Reorder) => result.current.displayTasks.map((task) => task.id).join(" ");

describe("useTaskReorder: a drag", () => {
  // a 40 tall, b (done) 80 tall, c 60 tall: a's two resting places are tops 0 and 142.
  const HEIGHTS = [40, 80, 60];

  it("previews the drop while dragging (the store untouched), then drops once at the open index", async () => {
    const { result, onPickUp, onDrop } = await renderReorder({ tasks: LIST, completedIds: ["b"] });
    await layOut(result, LIST, HEIGHTS);
    expect(result.current.draggingId).toBeNull();
    expect(result.current.displayTasks).toBe(LIST);

    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    expect(onPickUp).toHaveBeenCalledTimes(1);
    expect(result.current.draggingId).toBe("a");
    expect(result.current.ghostTop).toBe(0);
    expect(ids(result)).toBe("a b c");

    // Not far enough yet (centre 90 of a 0..182 card; halfway is 91).
    await dragBy(gesture, 70);
    expect(ids(result)).toBe("a b c");
    // Past halfway: the preview swaps the open rows around the done one.
    await dragBy(gesture, 72);
    expect(ids(result)).toBe("c b a");
    expect(result.current.dragY.value).toBe(72);
    // The row stays inside the task rows however far the finger goes.
    await dragBy(gesture, 900);
    expect(result.current.dragY.value).toBe(142);
    await dragBy(gesture, -900);
    expect(result.current.dragY.value).toBe(0);
    expect(ids(result)).toBe("a b c");
    await dragBy(gesture, 140);
    expect(ids(result)).toBe("c b a");
    expect(onDrop).not.toHaveBeenCalled();

    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledTimes(1);
    // (task, to, from), both counted among the open tasks.
    expect(onDrop).toHaveBeenCalledWith("a", 1, 0);
    expect(result.current.draggingId).toBeNull();
    // The ghost settled on the row's new place.
    expect(result.current.dragY.value).toBe(142);
    // The saved order is the store's to change: the hook shows what it's given.
    expect(result.current.displayTasks).toBe(LIST);
    expect(onPickUp).toHaveBeenCalledTimes(1);
  });

  it("a drop back where it started, or an interrupted drag, asks for no change of place", async () => {
    const { result, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(result, LIST, [40, 40, 40]);
    const gesture = result.current.gestures.c;

    await pickUp(gesture);
    await dragBy(gesture, -80);
    expect(ids(result)).toBe("c a b");
    await dragBy(gesture, 0);
    expect(ids(result)).toBe("a b c");
    await letGo(gesture);
    expect(result.current.draggingId).toBeNull();

    // Interrupted mid-drag (a call, the app switcher): back where it was.
    await pickUp(gesture);
    await dragBy(gesture, -80);
    expect(ids(result)).toBe("c a b");
    await letGo(gesture, false);
    expect(result.current.draggingId).toBeNull();
    expect(ids(result)).toBe("a b c");

    // Whatever was reported, it never names a new place.
    for (const [, to, from] of onDrop.mock.calls) expect(to).toBe(from);
  });

  it("a done row, and a touch that never became a hold, pick nothing up", async () => {
    const { result, onPickUp, onDrop } = await renderReorder({ tasks: LIST, completedIds: ["b"] });
    await layOut(result, LIST, HEIGHTS);
    await pickUp(result.current.gestures.b);
    expect(result.current.draggingId).toBeNull();
    // A tap or a scroll on the handle: finalize without a start.
    await letGo(result.current.gestures.a, false);
    await letGo(result.current.gestures.a, true);
    expect(onPickUp).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("only one row is held at a time", async () => {
    const { result, onPickUp, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(result, LIST, [40, 40, 40]);
    await pickUp(result.current.gestures.a);
    await pickUp(result.current.gestures.c);
    expect(result.current.draggingId).toBe("a");
    expect(onPickUp).toHaveBeenCalledTimes(1);
    await dragBy(result.current.gestures.c, -80);
    await letGo(result.current.gestures.c);
    expect(ids(result)).toBe("a b c");
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("useTaskReorder: the list changes under a drag", () => {
  const HEIGHTS = [40, 40, 40];

  it("a tick from the widget puts the row back: no preview, no drop, and the next drag works", async () => {
    const { result, rerender, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(result, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 82);
    expect(ids(result)).toBe("b c a");

    // "c" is ticked in the widget while "a" is in the air.
    await rerender({ tasks: LIST, completedIds: ["c"] });
    expect(result.current.draggingId).toBeNull();
    expect(result.current.displayTasks).toBe(LIST);

    // The finger keeps moving, then lifts: nothing follows it and nothing is saved.
    await dragBy(gesture, 82);
    expect(result.current.displayTasks).toBe(LIST);
    await letGo(gesture);
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();

    // A new drag measures against the list as it is now: two open rows.
    await pickUp(gesture);
    expect(result.current.draggingId).toBe("a");
    await dragBy(gesture, 41);
    expect(ids(result)).toBe("b a c");
    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith("a", 1, 0);
  });

  it("the day rolling over (other tasks, or none) cancels it too", async () => {
    const { result, rerender, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(result, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 82);
    expect(result.current.draggingId).toBe("a");

    const tomorrow: { id: string }[] = [];
    await rerender({ tasks: tomorrow, completedIds: [] });
    expect(result.current.draggingId).toBeNull();
    expect(result.current.displayTasks).toBe(tomorrow);
    await letGo(gesture);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("a render that changes nothing about the list keeps the drag going", async () => {
    const { result, rerender, onDrop } = await renderReorder({ tasks: LIST, completedIds: [] });
    await layOut(result, LIST, HEIGHTS);
    const gesture = result.current.gestures.a;
    await pickUp(gesture);
    await dragBy(gesture, 82);
    // New arrays, same tasks in the same state (any other store change).
    await rerender({ tasks: [...LIST], completedIds: [] });
    expect(result.current.draggingId).toBe("a");
    expect(ids(result)).toBe("b c a");
    // The same gesture object still holds the touch.
    expect(result.current.gestures.a).toBe(gesture);
    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledWith("a", 2, 0);
  });

  it("with Reduce Motion the rows don't slide and the drop still lands", async () => {
    const { result, onDrop } = await renderReorder({ tasks: LIST, completedIds: [], reduceMotion: true });
    await layOut(result, LIST, HEIGHTS);
    const gesture = result.current.gestures.b;
    await pickUp(gesture);
    expect(result.current.rowTransition).toBeUndefined();
    await dragBy(gesture, -41);
    expect(ids(result)).toBe("b a c");
    await letGo(gesture);
    expect(onDrop).toHaveBeenCalledWith("b", 0, 1);
  });
});
