// Phase 3 components: BrainDumpSheet, the parked section + Lock them in of the
// IdeasSheet, and TaskCard's step checklist / Break it down link.
import { act, fireEvent, screen } from "@testing-library/react-native";

import { BrainDumpSheet } from "@/components/daily-tasks/brain-dump-sheet";
import { IdeasSheet, type IdeaItem } from "@/components/daily-tasks/ideas-sheet";
import { TaskCard } from "@/components/daily-tasks/task-card";
import type { SortedBrainDump } from "@/lib/daily-tasks/ai-helpers";
import type { Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

function sorted(picks: string[], parked: string[], notice: string | null = null): SortedBrainDump {
  return { result: { picks, parked, source: notice ? "local" : "ai" }, notice };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("BrainDumpSheet", () => {
  const props = (overrides: Partial<Parameters<typeof BrainDumpSheet>[0]> = {}) => ({
    visible: true,
    onClose: jest.fn(),
    openSlots: 3,
    onSort: jest.fn(async () => sorted(["Finish report", "Call mum"], ["Buy shoes"])),
    onConfirm: jest.fn(),
    ...overrides,
  });

  async function writeAndSort(text = "finish report\ncall mum\nbuy shoes") {
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), text);
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
  }

  it("starts on the write stage with the slot count, and can't sort an empty dump", async () => {
    const p = props({ openSlots: 2 });
    await render(<BrainDumpSheet {...p} />);
    expect(screen.getByText(/We'll suggest up to 2 for today/)).toBeOnTheScreen();
    const sort = screen.getByRole("button", { name: "Sort it for me" });
    expect(sort).toBeDisabled();
    await fireEvent.press(sort);
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), "   \n ");
    expect(screen.getByRole("button", { name: "Sort it for me" })).toBeDisabled();
    expect(p.onSort).not.toHaveBeenCalled();
  });

  it("shows a sorting state while waiting, then the review", async () => {
    const pending = deferred<SortedBrainDump>();
    const p = props({ onSort: jest.fn(() => pending.promise) });
    await render(<BrainDumpSheet {...p} />);
    await writeAndSort("a\nb");
    expect(p.onSort).toHaveBeenCalledWith("a\nb");
    expect(screen.getByText("Sorting through it…")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Brain dump text")).toBeNull();

    await act(async () => pending.resolve(sorted(["A"], ["B"])));
    expect(screen.queryByText("Sorting through it…")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
  });

  it("reviews one list: suggested picks ticked, saved items unticked", async () => {
    await render(<BrainDumpSheet {...props()} />);
    await writeAndSort();
    expect(screen.getByRole("checkbox", { name: "Finish report" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Call mum" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Buy shoes" })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Add 2 to today" })).toBeEnabled();
    expect(screen.queryByTestId("brain-dump-notice")).toBeNull();
  });

  it("an unticked pick is saved for later with the rest; a saved item can be picked instead", async () => {
    const p = props();
    await render(<BrainDumpSheet {...p} />);
    await writeAndSort();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Finish report" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Buy shoes" }));
    await fireEvent.press(screen.getByRole("button", { name: "Add 2 to today" }));
    expect(p.onConfirm).toHaveBeenCalledWith(["Call mum", "Buy shoes"], ["Finish report"]);
  });

  it("caps ticks at the open slots: other rows are disabled until one is unticked", async () => {
    const p = props({ openSlots: 1, onSort: jest.fn(async () => sorted(["A", "B"], ["C"])) });
    await render(<BrainDumpSheet {...p} />);
    await writeAndSort();
    // Only the first suggestion is pre-ticked when there's one slot.
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "C" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("checkbox", { name: "C" }));
    expect(screen.getByRole("checkbox", { name: "C" })).not.toBeChecked();

    await fireEvent.press(screen.getByRole("checkbox", { name: "A" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "C" }));
    expect(screen.getByRole("checkbox", { name: "A" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Add 1 to today" }));
    expect(p.onConfirm).toHaveBeenCalledWith(["C"], ["A", "B"]);
  });

  it("saves everything for later when nothing is ticked", async () => {
    const p = props();
    await render(<BrainDumpSheet {...p} />);
    await writeAndSort();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Finish report" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Call mum" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save all for later" }));
    expect(p.onConfirm).toHaveBeenCalledWith([], ["Finish report", "Call mum", "Buy shoes"]);
  });

  it("closing at review saves everything instead of throwing it away", async () => {
    const p = props();
    await render(<BrainDumpSheet {...p} />);
    await writeAndSort();
    await fireEvent.press(
      screen.getByRole("button", { name: "Close and save everything for later" }),
    );
    expect(p.onConfirm).toHaveBeenCalledWith([], ["Finish report", "Call mum", "Buy shoes"]);
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("shows the fallback notice when sorting fell back to the simple split", async () => {
    const notice = "Couldn't reach smart sorting, so here's a simple split you can adjust.";
    await render(
      <BrainDumpSheet {...props({ onSort: jest.fn(async () => sorted(["A"], ["B"], notice)) })} />,
    );
    await writeAndSort();
    expect(screen.getByTestId("brain-dump-notice")).toBeOnTheScreen();
    expect(screen.getByText(notice)).toBeOnTheScreen();
  });

  it("ignores a sort that finishes after the sheet was closed and reopened", async () => {
    const pending = deferred<SortedBrainDump>();
    const p = props({ onSort: jest.fn(() => pending.promise) });
    const { rerender } = await render(<BrainDumpSheet {...p} />);
    await writeAndSort("old dump");
    await rerender(<BrainDumpSheet {...p} visible={false} />);
    await rerender(<BrainDumpSheet {...p} visible />);
    await act(async () => pending.resolve(sorted(["Old pick"], ["Old saved"])));
    expect(screen.queryByRole("checkbox", { name: "Old pick" })).toBeNull();
    expect(screen.getByLabelText("Brain dump text")).toBeOnTheScreen();
  });

  it("goes back to edit with the text kept", async () => {
    await render(<BrainDumpSheet {...props()} />);
    await writeAndSort("my words");
    await fireEvent.press(screen.getByRole("button", { name: "Edit what I wrote" }));
    expect(screen.getByLabelText("Brain dump text")).toHaveDisplayValue("my words");
  });

  it("starts fresh on the write stage each time it opens, and clears the text after confirming", async () => {
    const p = props();
    const { rerender } = await render(<BrainDumpSheet {...p} />);
    await writeAndSort("x\ny");
    await fireEvent.press(screen.getByRole("button", { name: "Add 2 to today" }));
    await rerender(<BrainDumpSheet {...p} visible={false} />);
    await rerender(<BrainDumpSheet {...p} visible />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByLabelText("Brain dump text")).toHaveDisplayValue("");
  });

  it("closes from the close button on the write stage", async () => {
    const p = props();
    await render(<BrainDumpSheet {...p} />);
    await fireEvent.press(screen.getByRole("button", { name: "Close brain dump" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it("renders nothing while hidden", async () => {
    await render(<BrainDumpSheet {...props({ visible: false })} />);
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
  });
});

describe("IdeasSheet: saved from your brain dump", () => {
  const ideas: IdeaItem[] = [{ id: "a", text: "Walk 20 minutes", estimatedMinutes: 20 }];
  const parked = [
    { id: "p1", text: "Buy shoes" },
    { id: "p2", text: "Water plants" },
  ];
  const props = () => ({
    visible: true,
    onClose: jest.fn(),
    goalTitle: "Run a 5K",
    source: { personalized: false, label: "Starter ideas" },
    ideas,
    addedTexts: new Set<string>(),
    remainingSlots: 2,
    adaptationReason: null,
    canRegenerate: true,
    regenerating: false,
    failureMessage: null,
    onAdd: jest.fn(),
    onAddAll: jest.fn(),
    onRegenerate: jest.fn(),
    onAddParked: jest.fn(),
    onRemoveParked: jest.fn(),
  });

  it("hides the section when nothing is parked", async () => {
    await render(<IdeasSheet {...props()} />);
    expect(screen.queryByTestId("parked-ideas")).toBeNull();
    expect(screen.queryByText("Saved from your brain dump")).toBeNull();
  });

  it("lists parked items with add and remove", async () => {
    const p = props();
    await render(<IdeasSheet {...p} parked={parked} />);
    expect(screen.getByText("Saved from your brain dump")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Add Water plants" }));
    expect(p.onAddParked).toHaveBeenCalledWith("p2");
    await fireEvent.press(screen.getByRole("button", { name: "Remove Buy shoes from saved" }));
    expect(p.onRemoveParked).toHaveBeenCalledWith("p1");
    expect(p.onAdd).not.toHaveBeenCalled();
  });

  it("disables adding parked items when today is full, but still allows removing", async () => {
    const p = props();
    await render(<IdeasSheet {...p} parked={parked} remainingSlots={0} />);
    const add = screen.getByRole("button", { name: "Add Buy shoes" });
    expect(add).toBeDisabled();
    await fireEvent.press(add);
    expect(p.onAddParked).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Remove Buy shoes from saved" }));
    expect(p.onRemoveParked).toHaveBeenCalledWith("p1");
  });

  it("offers Lock them in when full (with Done still available)", async () => {
    const p = props();
    const onLock = jest.fn();
    await render(<IdeasSheet {...p} remainingSlots={0} onLock={onLock} />);
    await fireEvent.press(screen.getByRole("button", { name: "Lock them in" }));
    expect(onLock).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("doesn't offer Lock them in without a handler or while there's room", async () => {
    const { rerender } = await render(<IdeasSheet {...props()} remainingSlots={0} />);
    expect(screen.queryByRole("button", { name: "Lock them in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeOnTheScreen();
    await rerender(<IdeasSheet {...props()} remainingSlots={1} onLock={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Lock them in" })).toBeNull();
  });
});

describe("TaskCard: steps and Break it down", () => {
  const base: Task = { id: "t1", text: "Clean kitchen", createdAt: "", carriedOver: false };
  const withSteps: Task = {
    ...base,
    steps: [
      { id: "s1", text: "Clear counter", done: true },
      { id: "s2", text: "Load dishwasher", done: false },
      { id: "s3", text: "Wipe surfaces", done: false },
    ],
  };
  const props = () => ({
    completed: false,
    onToggle: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    index: 0,
  });

  it("hides Break it down when no handler is given (AI unavailable)", async () => {
    await render(<TaskCard {...props()} task={base} />);
    expect(screen.queryByText("Break it down")).toBeNull();
  });

  it("offers Break it down and calls the handler", async () => {
    const onBreakDown = jest.fn();
    await render(<TaskCard {...props()} task={base} onBreakDown={onBreakDown} />);
    const link = screen.getByRole("button", { name: "Break down Clean kitchen" });
    expect(link).toBeEnabled();
    await fireEvent.press(link);
    expect(onBreakDown).toHaveBeenCalledTimes(1);
  });

  it("shows a busy, disabled state while breaking down", async () => {
    const onBreakDown = jest.fn();
    await render(<TaskCard {...props()} task={base} onBreakDown={onBreakDown} breakingDown />);
    const link = screen.getByRole("button", { name: "Break down Clean kitchen" });
    expect(link).toBeDisabled();
    expect(link).toBeBusy();
    expect(screen.getByText("Breaking it down…")).toBeOnTheScreen();
    await fireEvent.press(link);
    expect(onBreakDown).not.toHaveBeenCalled();
  });

  it("hides Break it down for a finished task or one that already has steps", async () => {
    const { rerender } = await render(
      <TaskCard {...props()} task={base} completed onBreakDown={jest.fn()} />,
    );
    expect(screen.queryByText("Break it down")).toBeNull();
    await rerender(<TaskCard {...props()} task={withSteps} onBreakDown={jest.fn()} />);
    expect(screen.queryByText("Break it down")).toBeNull();
    // An empty list counts as no steps.
    await rerender(<TaskCard {...props()} task={{ ...base, steps: [] }} onBreakDown={jest.fn()} />);
    expect(screen.getByText("Break it down")).toBeOnTheScreen();
  });

  it("shows steps as a checklist with position and state, and toggles one", async () => {
    const onToggleStep = jest.fn();
    await render(<TaskCard {...props()} task={withSteps} onToggleStep={onToggleStep} />);
    expect(screen.getByRole("checkbox", { name: "Step 1 of 3: Clear counter" })).toBeChecked();
    const second = screen.getByRole("checkbox", { name: "Step 2 of 3: Load dishwasher" });
    expect(second).not.toBeChecked();
    await fireEvent.press(second);
    expect(onToggleStep).toHaveBeenCalledWith("s2");
    // The task's own checkbox is untouched.
    expect(props().onToggle).not.toHaveBeenCalled();
  });

  it("toggling a step doesn't toggle the task", async () => {
    const p = props();
    await render(<TaskCard {...p} task={withSteps} onToggleStep={jest.fn()} />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Step 3 of 3: Wipe surfaces" }));
    expect(p.onToggle).not.toHaveBeenCalled();
  });

  it("offers Clear steps only with a handler", async () => {
    const onClearSteps = jest.fn();
    const { rerender } = await render(<TaskCard {...props()} task={withSteps} />);
    expect(screen.queryByRole("button", { name: "Clear steps" })).toBeNull();
    await rerender(<TaskCard {...props()} task={withSteps} onClearSteps={onClearSteps} />);
    await fireEvent.press(screen.getByRole("button", { name: "Clear steps" }));
    expect(onClearSteps).toHaveBeenCalledTimes(1);
  });

  it("hides the steps while the task is being edited", async () => {
    await render(<TaskCard {...props()} task={withSteps} onToggleStep={jest.fn()} />);
    expect(screen.getByTestId("steps-t1")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Edit task"));
    expect(screen.queryByTestId("steps-t1")).toBeNull();
  });
});
