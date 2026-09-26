import { AccessibilityInfo } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { IdeasSheet, type IdeaItem } from "@/components/daily-tasks/ideas-sheet";
import { StatusLine } from "@/components/daily-tasks/status-line";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TodayHeader } from "@/components/daily-tasks/today-header";
import {
  THINKING_HINT_DELAY_MS,
  todayProgress,
  todayStatus,
} from "@/lib/daily-tasks/today-view";

import { renderWithProviders as render } from "./render";

const task = (text: string) => ({ id: text, text, createdAt: "", carriedOver: false });

describe("TodayHeader", () => {
  it("shows greeting, one streak/level chip, headline and progress", async () => {
    await render(
      <TodayHeader
        greeting="Good morning, Alex"
        progress={todayProgress(2, 3)}
        dayStreak={21}
        level={4}
      />,
    );
    expect(screen.getByText("Good morning, Alex")).toBeOnTheScreen();
    expect(screen.getByText("🔥 21 · Lv 4")).toBeOnTheScreen();
    expect(screen.getByLabelText("21-day streak, level 4")).toBeOnTheScreen();
    expect(screen.getByText("Almost there!")).toBeOnTheScreen();
    expect(screen.getByText("2 of 3 done")).toBeOnTheScreen();
    expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({ now: 67 });
  });
});

describe("StatusLine", () => {
  it("offers Lock in while choosing and calls onLock", async () => {
    const onLock = jest.fn();
    await render(
      <StatusLine
        status={todayStatus({ locked: false, lockSource: null, taskCount: 2, completedCount: 0 })}
        onLock={onLock}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Lock in today's tasks" }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("hides Lock in once the day is set, and for an empty day", async () => {
    const { rerender } = await render(
      <StatusLine
        status={todayStatus({ locked: true, lockSource: "manual", taskCount: 3, completedCount: 1 })}
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

describe("TaskCard", () => {
  it("exposes one checkbox per task with position, name and state", async () => {
    const onToggle = jest.fn();
    await render(
      <TaskCard
        task={task("Walk 20 minutes")}
        index={1}
        completed={false}
        onToggle={onToggle}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    const box = screen.getByRole("checkbox", { name: "Task 2: Walk 20 minutes" });
    expect(box).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await fireEvent.press(box);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("marks completed tasks as checked", async () => {
    await render(
      <TaskCard
        task={task("Stretch")}
        completed
        onToggle={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Stretch" })).toBeChecked();
  });

  it("hides edit and delete when the day is locked", async () => {
    await render(
      <TaskCard
        task={task("Stretch")}
        completed={false}
        onToggle={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        canEdit={false}
        canDelete={false}
      />,
    );
    expect(screen.queryByLabelText("Edit task")).toBeNull();
    expect(screen.queryByLabelText("Delete task")).toBeNull();
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
    source: { personalized: true, label: "Personalized for Run a 5K" },
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
    expect(screen.getByText("Personalized for Run a 5K")).toBeOnTheScreen();
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
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    await render(
      <IdeasSheet {...props()} failureMessage="Couldn't get fresh ideas right now. Try again in a bit." />,
    );
    expect(screen.getByTestId("ideas-failure")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith("Couldn't get fresh ideas right now. Try again in a bit.");
  });

  it("disables New ideas while refreshing and hides it when regeneration isn't possible", async () => {
    const p = props();
    const { rerender } = await render(<IdeasSheet {...p} regenerating />);
    expect(screen.getByRole("button", { name: "Get new ideas" })).toBeDisabled();
    await rerender(<IdeasSheet {...p} canRegenerate={false} />);
    expect(screen.queryByRole("button", { name: "Get new ideas" })).toBeNull();
  });

  it("uses count-aware copy for fewer than three ideas", async () => {
    await render(<IdeasSheet {...props()} ideas={ideas.slice(0, 1)} />);
    expect(screen.getByText("Add it if it fits.")).toBeOnTheScreen();
    expect(screen.queryByText(/Add all/)).toBeNull();
  });
});
