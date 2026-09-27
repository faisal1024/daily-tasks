// Phase 10a components: TaskRow (one row of Today's card) and the
// one-decision RolloverModal.
import { ActionSheetIOS, Alert, Platform } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";

import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import { TaskRow } from "@/components/daily-tasks/task-row";
import type { PendingRollover, Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const task = (text: string, extra: Partial<Task> = {}): Task => ({
  id: `id-${text}`,
  text,
  createdAt: "",
  carriedOver: false,
  ...extra,
});

async function renderRow(props: Partial<React.ComponentProps<typeof TaskRow>> = {}) {
  const handlers = {
    onToggle: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onNotToday: jest.fn(),
  };
  const utils = await render(
    <TaskRow task={task("Walk")} index={0} completed={false} editable {...handlers} {...props} />,
  );
  return { ...handlers, utils };
}

// The row itself, not the swipe actions (the gesture-handler mock renders those too).
const row = () => within(screen.getByTestId("task-row-id-Walk"));
// Hidden from VoiceOver (the checkbox carries the actions), so include hidden elements.
const words = () => screen.getByTestId("task-words-id-Walk", { includeHiddenElements: true });

const a11yAction = (actionName: string) => ({ nativeEvent: { actionName } });

type SheetOptions = { title?: string; options: string[]; cancelButtonIndex?: number; destructiveButtonIndex?: number };
let sheet: jest.SpyInstance;
beforeEach(() => {
  sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
});
afterEach(() => {
  sheet.mockRestore();
});
/** Opens the row menu from the words and picks the option with this label. */
async function pickFromMenu(label: string) {
  await fireEvent.press(words());
  const [options, callback] = sheet.mock.calls[sheet.mock.calls.length - 1] as [
    SheetOptions,
    (index: number) => void,
  ];
  const index = options.options.indexOf(label);
  expect(index).toBeGreaterThanOrEqual(0);
  await act(async () => callback(index));
}
const menuOptions = () => (sheet.mock.calls[sheet.mock.calls.length - 1][0] as SheetOptions).options;

describe("TaskRow", () => {
  it("labels its checkbox with position and text, and only the circle toggles", async () => {
    const { onToggle } = await renderRow({ index: 1 });
    const box = screen.getByRole("checkbox", { name: "Task 2: Walk" });
    expect(box).not.toBeChecked();
    await fireEvent.press(box);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // The words open the menu instead of toggling.
    await fireEvent.press(words());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(sheet).toHaveBeenCalledTimes(1);
  });

  it("tapping the words opens a menu of the row's actions (Delete destructive, Cancel last)", async () => {
    await renderRow({ onBreakDown: jest.fn() });
    await fireEvent.press(words());
    const [options] = sheet.mock.calls[0] as [SheetOptions];
    expect(options).toMatchObject({
      title: "Walk",
      options: ["Edit", "Not today", "Break it down", "Delete", "Cancel"],
      cancelButtonIndex: 4,
      destructiveButtonIndex: 3,
    });
  });

  it("long-pressing the words opens the same menu", async () => {
    await renderRow();
    await fireEvent(words(), "longPress");
    expect(menuOptions()).toEqual(["Edit", "Not today", "Delete", "Cancel"]);
  });

  it("runs the picked menu action, and Cancel does nothing", async () => {
    const onBreakDown = jest.fn();
    const { onNotToday, onDelete, onToggle } = await renderRow({ onBreakDown });
    await pickFromMenu("Not today");
    expect(onNotToday).toHaveBeenCalledTimes(1);
    await pickFromMenu("Break it down");
    expect(onBreakDown).toHaveBeenCalledTimes(1);
    await pickFromMenu("Delete");
    expect(onDelete).toHaveBeenCalledTimes(1);
    await pickFromMenu("Cancel");
    expect(onNotToday).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("Edit from the menu opens the field; the edit is trimmed and saved once", async () => {
    const { onEdit } = await renderRow();
    await pickFromMenu("Edit");
    const input = screen.getByLabelText("Edit task 1");
    await fireEvent.changeText(input, "  Walk the dog  ");
    await fireEvent(input, "submitEditing");
    await fireEvent(input, "blur");
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("Walk the dog");
    expect(screen.queryByLabelText("Edit task 1")).toBeNull();
  });

  it("doesn't save an empty or unchanged edit", async () => {
    const { onEdit } = await renderRow();
    await pickFromMenu("Edit");
    await fireEvent.changeText(screen.getByLabelText("Edit task 1"), "   ");
    await fireEvent(screen.getByLabelText("Edit task 1"), "submitEditing");
    await pickFromMenu("Edit");
    await fireEvent(screen.getByLabelText("Edit task 1"), "blur");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("tapping the circle while editing saves the edit first, then toggles", async () => {
    const { onEdit, onToggle } = await renderRow();
    await pickFromMenu("Edit");
    await fireEvent.changeText(screen.getByLabelText("Edit task 1"), "Run");
    await fireEvent.press(screen.getByRole("checkbox", { name: "Task 1: Walk" }));
    expect(onEdit).toHaveBeenCalledWith("Run");
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Edit task 1")).toBeNull();
  });

  it("on a set day offers only Not today (and Break it down), never Edit or Delete", async () => {
    const { onToggle } = await renderRow({ editable: false, onBreakDown: jest.fn() });
    await fireEvent.press(words());
    expect(menuOptions()).toEqual(["Not today", "Break it down", "Cancel"]);
    expect(onToggle).not.toHaveBeenCalled();
    const box = screen.getByRole("checkbox", { name: "Task 1: Walk" });
    expect(box.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      "notToday",
      "breakDown",
    ]);
    // Swipe keeps Not today only.
    const actions = within(screen.getByTestId("row-actions-id-Walk"));
    expect(actions.getByRole("button", { name: "Not today: Walk" })).toBeOnTheScreen();
    expect(actions.queryByRole("button", { name: "Delete: Walk" })).toBeNull();
  });

  it("a finished task on a set day has no menu, no VoiceOver actions and no swipe", async () => {
    const { onToggle } = await renderRow({ editable: false, completed: true });
    await fireEvent.press(words());
    expect(sheet).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" }).props.accessibilityActions).toEqual([]);
    expect(screen.queryByTestId("row-actions-id-Walk")).toBeNull();
  });

  it("a finished task on an open day offers only Delete", async () => {
    await renderRow({ completed: true });
    await fireEvent.press(words());
    expect(menuOptions()).toEqual(["Delete", "Cancel"]);
  });

  it("VoiceOver actions match the menu and run the same handlers", async () => {
    const { onNotToday, onDelete } = await renderRow();
    const box = screen.getByRole("checkbox", { name: "Task 1: Walk" });
    expect(box.props.accessibilityActions).toEqual([
      { name: "edit", label: "Edit" },
      { name: "notToday", label: "Not today" },
      { name: "delete", label: "Delete" },
    ]);
    await fireEvent(box, "accessibilityAction", a11yAction("notToday"));
    expect(onNotToday).toHaveBeenCalledTimes(1);
    await fireEvent(box, "accessibilityAction", a11yAction("delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    // Not offered here, so ignored.
    await fireEvent(box, "accessibilityAction", a11yAction("breakDown"));
    await fireEvent(box, "accessibilityAction", a11yAction("edit"));
    expect(screen.getByLabelText("Edit task 1")).toBeOnTheScreen();
  });

  it("swipe actions call Not today and Delete", async () => {
    const { onNotToday, onDelete } = await renderRow();
    const actions = within(screen.getByTestId("row-actions-id-Walk"));
    await fireEvent.press(actions.getByRole("button", { name: "Not today: Walk" }));
    expect(onNotToday).toHaveBeenCalledTimes(1);
    await fireEvent.press(actions.getByRole("button", { name: "Delete: Walk" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("the hero says Up next and shows Break it down and Not today inline", async () => {
    const onBreakDown = jest.fn();
    const { onNotToday, utils } = await renderRow({ onBreakDown });
    expect(screen.queryByText("Up next", { includeHiddenElements: true })).toBeNull();
    expect(row().queryByRole("button", { name: "Break down Walk" })).toBeNull();
    expect(row().queryByRole("button", { name: "Not today: Walk" })).toBeNull();

    await utils.rerender(
      <TaskRow
        task={task("Walk")}
        index={0}
        completed={false}
        editable={false}
        hero
        onToggle={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onNotToday={onNotToday}
        onBreakDown={onBreakDown}
      />,
    );
    expect(screen.getByText("Up next", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Up next. Task 1: Walk" })).toBeOnTheScreen();
    await fireEvent.press(row().getByRole("button", { name: "Break down Walk" }));
    expect(onBreakDown).toHaveBeenCalledTimes(1);
    await fireEvent.press(row().getByRole("button", { name: "Not today: Walk" }));
    expect(onNotToday).toHaveBeenCalledTimes(1);
  });

  it("the hero drops Break it down while one is running elsewhere, and shows progress while its own runs", async () => {
    const { utils } = await renderRow({ hero: true, onBreakDown: jest.fn(), breakDownDisabled: true });
    expect(row().queryByRole("button", { name: "Break down Walk" })).toBeNull();
    await utils.rerender(
      <TaskRow
        task={task("Walk")}
        index={0}
        completed={false}
        editable
        hero
        breakingDown
        onBreakDown={jest.fn()}
        onToggle={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onNotToday={jest.fn()}
      />,
    );
    expect(screen.getByText("Breaking it down…")).toBeOnTheScreen();
    expect(row().queryByRole("button", { name: "Break down Walk" })).toBeNull();
  });

  it("closes an open edit when the day gets set", async () => {
    const { utils } = await renderRow();
    await pickFromMenu("Edit");
    expect(screen.getByLabelText("Edit task 1")).toBeOnTheScreen();
    await utils.rerender(
      <TaskRow
        task={task("Walk")}
        index={0}
        completed={false}
        editable={false}
        onToggle={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onNotToday={jest.fn()}
      />,
    );
    expect(screen.queryByLabelText("Edit task 1")).toBeNull();
  });

  it("marks a carried-over task until it's done", async () => {
    await renderRow({ task: task("Walk", { carriedOver: true }) });
    expect(screen.getByText("Carried over")).toBeOnTheScreen();
  });

  describe("on Android", () => {
    const originalOS = Platform.OS;
    let alert: jest.SpyInstance;
    beforeEach(() => {
      Object.defineProperty(Platform, "OS", { configurable: true, get: () => "android" });
      alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    });
    afterEach(() => {
      Object.defineProperty(Platform, "OS", { configurable: true, get: () => originalOS });
      alert.mockRestore();
    });
    type Button = { text: string; style?: string; onPress?: () => void };
    const lastButtons = () => alert.mock.calls[alert.mock.calls.length - 1][2] as Button[];

    it("shows up to two actions directly", async () => {
      const { onNotToday } = await renderRow({ editable: false, onBreakDown: jest.fn() });
      await fireEvent.press(words());
      expect(sheet).not.toHaveBeenCalled();
      expect(lastButtons().map((b) => b.text)).toEqual(["Not today", "Break it down", "Cancel"]);
      await act(async () => lastButtons()[0].onPress?.());
      expect(onNotToday).toHaveBeenCalledTimes(1);
    });

    it("pages longer menus with More…, so every action stays reachable", async () => {
      const { onDelete } = await renderRow({ onBreakDown: jest.fn() });
      await fireEvent.press(words());
      expect(lastButtons().map((b) => b.text)).toEqual(["Edit", "More…", "Cancel"]);
      await act(async () => lastButtons()[1].onPress?.());
      expect(lastButtons().map((b) => b.text)).toEqual(["Not today", "More…", "Cancel"]);
      await act(async () => lastButtons()[1].onPress?.());
      const last = lastButtons();
      expect(last.map((b) => b.text)).toEqual(["Break it down", "Delete", "Cancel"]);
      expect(last[1].style).toBe("destructive");
      await act(async () => last[1].onPress?.());
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });
});

// --- RolloverModal -----------------------------------------------------------

const pending = (...texts: string[]): PendingRollover =>
  ({
    sourceDate: "2026-09-25",
    tasks: texts.map((text) => ({ ...task(text), completed: false, rolloverOutcome: "unresolved" })),
  }) as PendingRollover;

async function renderRollover(p: PendingRollover, remainingSlots: number) {
  const onApply = jest.fn();
  await render(
    <RolloverModal
      visible
      pending={p}
      remainingSlots={remainingSlots}
      onApply={onApply}
    />,
  );
  return onApply;
}

const applyButton = () => screen.getByTestId("rollover-apply");

describe("RolloverModal", () => {
  it("titles it 'From before' and says how much room there is", async () => {
    await renderRollover(pending("Walk", "Read"), 3);
    expect(screen.getByRole("header", { name: "From before" })).toBeOnTheScreen();
    expect(
      screen.getByText("These weren't finished. Room for 3 today: tick what still matters. The rest stay in your history."),
    ).toBeOnTheScreen();
  });

  it("uses one-task and one-slot copy", async () => {
    const { rerender } = await render(
      <RolloverModal visible pending={pending("Walk")} remainingSlots={2} onApply={jest.fn()} />,
    );
    expect(
      screen.getByText("This one wasn't finished. Bring it into today? If not, it stays in your history."),
    ).toBeOnTheScreen();
    await rerender(<RolloverModal visible pending={pending("Walk", "Read")} remainingSlots={1} onApply={jest.fn()} />);
    expect(
      screen.getByText(
        "These weren't finished. Room for 1 today: tick the one that matters most. The rest stay in your history.",
      ),
    ).toBeOnTheScreen();
  });

  it("preselects everything that fits and brings it in", async () => {
    const onApply = await renderRollover(pending("Walk", "Read"), 3);
    expect(screen.getByRole("checkbox", { name: "Walk" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Read" })).toBeChecked();
    expect(applyButton()).toHaveTextContent("Bring 2 into today");
    await fireEvent.press(applyButton());
    expect(onApply).toHaveBeenCalledWith(["id-Walk", "id-Read"]);
  });

  it("preselects only as many as there's room for, and can't exceed it", async () => {
    const onApply = await renderRollover(pending("Walk", "Read", "Call"), 2);
    expect(screen.getByRole("checkbox", { name: "Walk" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Read" })).toBeChecked();
    const call = screen.getByRole("checkbox", { name: "Call" });
    expect(call).not.toBeChecked();
    expect(call).toBeDisabled();
    await fireEvent.press(call);
    expect(screen.getByRole("checkbox", { name: "Call" })).not.toBeChecked();

    // Untick one, then the third can be picked instead.
    await fireEvent.press(screen.getByRole("checkbox", { name: "Walk" }));
    expect(applyButton()).toHaveTextContent("Bring 1 into today");
    await fireEvent.press(screen.getByRole("checkbox", { name: "Call" }));
    expect(screen.getByRole("checkbox", { name: "Call" })).toBeChecked();
    await fireEvent.press(applyButton());
    expect(onApply).toHaveBeenCalledWith(["id-Read", "id-Call"]);
  });

  it("offers a secondary Start fresh that brings nothing in", async () => {
    const onApply = await renderRollover(pending("Walk"), 3);
    await fireEvent.press(screen.getByTestId("rollover-fresh"));
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("turns the primary into Start fresh when nothing is ticked, with no second button", async () => {
    const onApply = await renderRollover(pending("Walk"), 3);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Walk" }));
    expect(applyButton()).toHaveTextContent("Start fresh");
    expect(screen.queryByTestId("rollover-fresh")).toBeNull();
    await fireEvent.press(applyButton());
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("with no room, says Got it and brings nothing in", async () => {
    const onApply = await renderRollover(pending("Walk", "Read"), 0);
    expect(applyButton()).toHaveTextContent("Got it");
    expect(screen.getByText("Today's three are already full, so these stay in your history.")).toBeOnTheScreen();
    expect(screen.queryByTestId("rollover-fresh")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Walk" })).toBeDisabled();
    await fireEvent.press(applyButton());
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("renders nothing without a pending rollover", async () => {
    await render(
      <RolloverModal visible pending={null} remainingSlots={3} onApply={jest.fn()} />,
    );
    expect(screen.queryByTestId("rollover-apply")).toBeNull();
  });
});
