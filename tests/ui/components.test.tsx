import { AccessibilityInfo } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { AddTaskRow } from "@/components/daily-tasks/add-task-row";
import { IdeasSheet, type IdeaItem } from "@/components/daily-tasks/ideas-sheet";
import { StatusLine } from "@/components/daily-tasks/status-line";
import { TodayHeader } from "@/components/daily-tasks/today-header";
import { THINKING_HINT_DELAY_MS, todayProgress, todayStatus } from "@/lib/daily-tasks/today-view";

import { renderWithProviders as render } from "./render";


describe("TodayHeader", () => {
  it("shows a plain 'Today' title, the date with progress, one Day N chip and a thin bar", async () => {
    await render(
      <TodayHeader dateLabel="Sunday, 27 September" progress={todayProgress(2, 3)} daysShowedUp={21} />,
    );
    expect(screen.getByRole("header", { name: "Today" })).toBeOnTheScreen();
    expect(screen.getByText("Sunday, 27 September · 2 of 3 done")).toBeOnTheScreen();
    expect(screen.getByText("Day 21")).toBeOnTheScreen();
    expect(screen.getByLabelText("Day 21 of showing up")).toBeOnTheScreen();
    // No greeting or motivational headline any more.
    expect(screen.queryByText("Almost there!")).toBeNull();
    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).toBeNull();
    // VoiceOver hears the label, not a percentage measured against three slots.
    expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({ text: "2 of 3 done" });
  });

  it("shows just the date and no progress bar before any task is picked", async () => {
    await render(
      <TodayHeader dateLabel="Sunday, 27 September" progress={todayProgress(0, 0)} daysShowedUp={1} />,
    );
    expect(screen.getByText("Sunday, 27 September")).toBeOnTheScreen();
    expect(screen.queryByText(/ · /)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("Pick today's three")).toBeNull();
  });
});

describe("TodayHeader progress label", () => {
  it("speaks the open-slot label, not a percentage, while slots are open", async () => {
    await render(
      <TodayHeader dateLabel="Monday, 28 September" progress={todayProgress(0, 1)} daysShowedUp={1} />,
    );
    // Spoken with a comma: VoiceOver would read the middle dot aloud.
    expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({
      text: "0 of 1 done, 2 open",
    });
    expect(screen.getByText("Monday, 28 September · 0 of 1 done · 2 open")).toBeOnTheScreen();
  });
});

describe("AddTaskRow", () => {
  it("invites a task while open and says the day is set when locked", async () => {
    const onAdd = jest.fn();
    const { rerender } = await render(<AddTaskRow remainingSlots={2} slotNumber={2} onAdd={onAdd} />);
    expect(screen.getByRole("button", { name: "Add a task, slot 2" })).toBeOnTheScreen();
    // A plain row now: no subtitle copy.
    expect(screen.queryByText("Something you'll stand behind today.")).toBeNull();
    await rerender(<AddTaskRow remainingSlots={2} slotNumber={2} onAdd={onAdd} disabled />);
    const openSlot = screen.getByRole("button", { name: "Left open on purpose" });
    expect(openSlot).toBeDisabled();
    expect(screen.queryByText("Room to breathe.")).toBeNull();
    await fireEvent.press(openSlot);
    expect(screen.queryByPlaceholderText("What's one thing for today?")).toBeNull();
    expect(screen.queryByText("Today is set.")).toBeNull();
  });

  it("adds trimmed text typed into the slot", async () => {
    const onAdd = jest.fn();
    await render(<AddTaskRow remainingSlots={2} slotNumber={2} onAdd={onAdd} />);
    await fireEvent.press(screen.getByText("Add a task"));
    const input = screen.getByPlaceholderText("What's one thing for today?");
    await fireEvent.changeText(input, "  Walk  ");
    await fireEvent(input, "submitEditing");
    expect(onAdd).toHaveBeenCalledWith("Walk");
  });
});

describe("StatusLine", () => {
  it("offers Set today while choosing and calls onLock", async () => {
    const onLock = jest.fn();
    await render(
      <StatusLine
        status={todayStatus({ locked: false, lockSource: null, taskCount: 2, completedCount: 0 })}
        onLock={onLock}
      />,
    );
    expect(screen.getByText("Set today")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Set today's tasks" }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("offers no Set action once work has started or every task is done", async () => {
    const { rerender } = await render(
      <StatusLine
        status={todayStatus({ locked: false, lockSource: null, taskCount: 3, completedCount: 3 })}
        onLock={jest.fn()}
      />,
    );
    expect(screen.getByText("All done for today.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Set today's tasks" })).toBeNull();

    await rerender(
      <StatusLine
        status={todayStatus({ locked: false, lockSource: null, taskCount: 3, completedCount: 1 })}
        onLock={jest.fn()}
      />,
    );
    expect(screen.getByText("Keep going. 2 to go.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Set today's tasks" })).toBeNull();
  });

  it("offers Change once the day is set, and calls onUnlock", async () => {
    const onUnlock = jest.fn();
    await render(
      <StatusLine
        status={todayStatus({ locked: true, lockSource: "manual", taskCount: 2, completedCount: 0 })}
        onLock={jest.fn()}
        onUnlock={onUnlock}
      />,
    );
    expect(screen.getByText("Change")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Change today's tasks" }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("hides Set today once the day is set, and for an empty day", async () => {
    const { rerender } = await render(
      <StatusLine
        status={todayStatus({
          locked: true,
          lockSource: "manual",
          taskCount: 3,
          completedCount: 1,
        })}
        onLock={jest.fn()}
      />,
    );
    expect(screen.getByText("Today is set. 2 to go.")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).toBeNull();

    await rerender(
      <StatusLine
        status={todayStatus({ locked: false, lockSource: null, taskCount: 0, completedCount: 0 })}
        onLock={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("IdeasSheet", () => {
  const ideas: IdeaItem[] = [
    { id: "a", text: "Walk 20 minutes", estimatedMinutes: 20 },
    { id: "b", text: "Stretch calves", estimatedMinutes: 10 },
    { id: "c", text: "Lay out gear", estimatedMinutes: 5 },
  ];
  const props = () => ({
    visible: true,
    onClose: jest.fn(),
    goalTitle: "Run a 5K",
    source: { personalized: true, label: "Made for your goal" },
    ideas,
    addedTexts: new Set<string>(),
    remainingSlots: 3,
    adaptationReason: null,
    canRegenerate: true,
    regenerating: false,
    failureMessage: null,
    onAdd: jest.fn(),
    onAddAll: jest.fn(),
    onRegenerate: jest.fn(),
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("labels personalized vs starter ideas", async () => {
    const { rerender } = await render(<IdeasSheet {...props()} />);
    expect(screen.getByText("Made for your goal")).toBeOnTheScreen();
    await rerender(
      <IdeasSheet {...props()} source={{ personalized: false, label: "Starter ideas" }} />,
    );
    expect(screen.getByText("Starter ideas")).toBeOnTheScreen();
  });

  it("adds a single idea and adds only as many as there are open slots", async () => {
    const p = props();
    await render(<IdeasSheet {...p} remainingSlots={2} />);
    await fireEvent.press(screen.getByRole("button", { name: "Add Walk 20 minutes" }));
    expect(p.onAdd).toHaveBeenCalledWith("Walk 20 minutes");
    expect(screen.getByText("Add the first 2")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Add 2 of these ideas" }));
    expect(p.onAddAll).toHaveBeenCalledWith(["Walk 20 minutes", "Stretch calves"]);
  });

  it("marks added ideas and disables them", async () => {
    await render(<IdeasSheet {...props()} addedTexts={new Set(["walk 20 minutes"])} />);
    const added = screen.getByRole("button", { name: "Walk 20 minutes, added" });
    expect(added).toBeDisabled();
  });

  it("shows a Done state when all three slots are filled", async () => {
    const p = props();
    await render(<IdeasSheet {...p} remainingSlots={0} />);
    expect(screen.getByText("Today's three are picked. Nice.")).toBeOnTheScreen();
    expect(screen.queryByText(/Add all/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("shows 'Still thinking…' only after a slow refresh, and hides it when done", async () => {
    jest.useFakeTimers();
    const { rerender } = await render(<IdeasSheet {...props()} regenerating />);
    expect(screen.getByText("Refreshing…")).toBeOnTheScreen();
    expect(screen.queryByText(/Still thinking/)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(THINKING_HINT_DELAY_MS);
    });
    expect(screen.getByText(/Still thinking/)).toBeOnTheScreen();
    await rerender(<IdeasSheet {...props()} regenerating={false} />);
    expect(screen.queryByText(/Still thinking/)).toBeNull();
  });

  it("shows failure notes with an icon and announces them for VoiceOver", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    await render(
      <IdeasSheet
        {...props()}
        failureMessage="Couldn't get fresh ideas right now. Try again in a bit."
      />,
    );
    expect(screen.getByTestId("ideas-failure")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(
      "Couldn't get fresh ideas right now. Try again in a bit.",
    );
  });

  it("disables New ideas while refreshing and hides it when regeneration isn't possible", async () => {
    const p = props();
    const { rerender } = await render(<IdeasSheet {...p} regenerating />);
    expect(screen.getByRole("button", { name: "Get new ideas" })).toBeDisabled();
    await rerender(<IdeasSheet {...p} canRegenerate={false} />);
    expect(screen.queryByRole("button", { name: "Get new ideas" })).toBeNull();
  });

  it("bases the hint on ideas that can still be added: not already added, and no more than the free slots", async () => {
    const { rerender } = await render(<IdeasSheet {...props()} />);
    expect(screen.getByText("Add any you like — one, two, or all three.")).toBeOnTheScreen();
    // Three ideas, two free slots.
    await rerender(<IdeasSheet {...props()} remainingSlots={2} />);
    expect(screen.getByText("Add one or both.")).toBeOnTheScreen();
    // Three free slots, but one idea is already on the list.
    await rerender(<IdeasSheet {...props()} addedTexts={new Set(["walk 20 minutes"])} />);
    expect(screen.getByText("Add one or both.")).toBeOnTheScreen();
    // One free slot.
    await rerender(<IdeasSheet {...props()} remainingSlots={1} />);
    expect(screen.getByText("Add it if it fits.")).toBeOnTheScreen();
    expect(screen.getByText("Add the first 1")).toBeOnTheScreen();
  });

  it("says 'Add all' when every remaining idea fits", async () => {
    await render(<IdeasSheet {...props()} remainingSlots={3} />);
    expect(screen.getByText("Add all")).toBeOnTheScreen();
    expect(screen.queryByText(/Add the first/)).toBeNull();
  });

  it("uses count-aware copy for fewer than three ideas", async () => {
    await render(<IdeasSheet {...props()} ideas={ideas.slice(0, 1)} />);
    expect(screen.getByText("Add it if it fits.")).toBeOnTheScreen();
    expect(screen.queryByText(/Add all/)).toBeNull();
  });
});
