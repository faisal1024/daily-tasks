// Yesterday's unfinished ones as an inline card on Today (the real component,
// not the stand-in the Today screen tests use).
import { fireEvent, screen } from "@testing-library/react-native";

import { RolloverModal } from "@/components/daily-tasks/rollover-modal";
import type { DayTaskRecord, PendingRollover } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

function pendingOf(...texts: string[]): PendingRollover {
  return {
    sourceDate: "2026-09-25",
    tasks: texts.map(
      (text, i): DayTaskRecord => ({
        id: `y${i}`,
        text,
        completed: false,
        carriedOver: false,
        rolloverOutcome: "unresolved",
      }),
    ),
  };
}

const row = (name: string) => screen.getByRole("checkbox", { name });
const checked = (name: string) => row(name).props.accessibilityState?.checked === true;
const disabled = (name: string) => row(name).props.accessibilityState?.disabled === true;
const applyText = () => screen.getByTestId("rollover-apply");

describe("Rollover card", () => {
  it("renders nothing when nothing is pending", async () => {
    await render(<RolloverModal pending={null} remainingSlots={3} onApply={jest.fn()} />);
    expect(screen.queryByTestId("rollover-card")).toBeNull();
  });

  it("is an inline card next to the rest of Today (siblings stay pressable)", async () => {
    const { Pressable, Text, View } = jest.requireActual("react-native");
    const other = jest.fn();
    await render(
      <View>
        <RolloverModal pending={pendingOf("Walk")} remainingSlots={3} onApply={jest.fn()} />
        <Pressable testID="sibling" onPress={other}>
          <Text>Use this</Text>
        </Pressable>
      </View>,
    );
    expect(screen.getByTestId("rollover-card")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("sibling"));
    expect(other).toHaveBeenCalled();
  });

  it("preselects only as many as there's room for, and greys the rest out", async () => {
    await render(
      <RolloverModal pending={pendingOf("Walk", "Read", "Call mum")} remainingSlots={2} onApply={jest.fn()} />,
    );
    expect(checked("Walk")).toBe(true);
    expect(checked("Read")).toBe(true);
    expect(checked("Call mum")).toBe(false);
    expect(disabled("Call mum")).toBe(true);
    expect(row("Call mum").props.accessibilityHint).toMatch(/Untick another one first/);
    expect(screen.getByText(/Room for 2 today/)).toBeOnTheScreen();
    expect(applyText()).toHaveTextContent("Bring 2 into today");
  });

  it("preselects everything when all of it fits", async () => {
    const onApply = jest.fn();
    await render(<RolloverModal pending={pendingOf("Walk", "Read")} remainingSlots={3} onApply={onApply} />);
    expect(checked("Walk")).toBe(true);
    expect(checked("Read")).toBe(true);
    await fireEvent.press(applyText());
    expect(onApply).toHaveBeenCalledWith(["y0", "y1"]);
  });

  it("toggles: untick frees room for another, and apply sends what's ticked", async () => {
    const onApply = jest.fn();
    await render(
      <RolloverModal pending={pendingOf("Walk", "Read", "Call mum")} remainingSlots={2} onApply={onApply} />,
    );
    await fireEvent.press(row("Walk"));
    expect(checked("Walk")).toBe(false);
    expect(disabled("Call mum")).toBe(false);
    expect(applyText()).toHaveTextContent("Bring 1 into today");

    await fireEvent.press(row("Call mum"));
    expect(checked("Call mum")).toBe(true);
    // Full again: the unticked one is greyed out.
    expect(disabled("Walk")).toBe(true);

    await fireEvent.press(applyText());
    expect(onApply).toHaveBeenCalledWith(["y1", "y2"]);
  });

  it("can't tick more than there's room for (a press on a greyed row does nothing)", async () => {
    await render(
      <RolloverModal pending={pendingOf("Walk", "Read", "Call mum")} remainingSlots={1} onApply={jest.fn()} />,
    );
    expect(screen.getByText(/Room for 1 today: tick the one that matters most/)).toBeOnTheScreen();
    await fireEvent.press(row("Read"));
    expect(checked("Read")).toBe(false);
    expect(checked("Walk")).toBe(true);
    expect(applyText()).toHaveTextContent("Bring 1 into today");
  });

  it("with nothing ticked the main button starts fresh, and there's no second Start fresh", async () => {
    const onApply = jest.fn();
    await render(<RolloverModal pending={pendingOf("Walk")} remainingSlots={3} onApply={onApply} />);
    expect(screen.getByText(/This one wasn't finished/)).toBeOnTheScreen();
    expect(screen.getByTestId("rollover-fresh")).toBeOnTheScreen();

    await fireEvent.press(row("Walk"));
    expect(applyText()).toHaveTextContent("Start fresh");
    expect(screen.queryByTestId("rollover-fresh")).toBeNull();
    await fireEvent.press(applyText());
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("Start fresh drops everything even with some ticked", async () => {
    const onApply = jest.fn();
    await render(<RolloverModal pending={pendingOf("Walk", "Read")} remainingSlots={3} onApply={onApply} />);
    await fireEvent.press(screen.getByTestId("rollover-fresh"));
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("with no room: says so, nothing is tickable, and Got it resolves with nothing", async () => {
    const onApply = jest.fn();
    await render(<RolloverModal pending={pendingOf("Walk", "Read")} remainingSlots={0} onApply={onApply} />);
    expect(screen.getByText(/already full, so these stay in your history/)).toBeOnTheScreen();
    expect(checked("Walk")).toBe(false);
    expect(disabled("Walk")).toBe(true);
    expect(disabled("Read")).toBe(true);
    await fireEvent.press(row("Walk"));
    expect(checked("Walk")).toBe(false);
    expect(applyText()).toHaveTextContent("Got it");
    expect(screen.queryByTestId("rollover-fresh")).toBeNull();
    await fireEvent.press(applyText());
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("when the room shrinks (e.g. last night's draft was used) the selection never exceeds it", async () => {
    const onApply = jest.fn();
    const pending = pendingOf("Walk", "Read", "Call mum");
    const { rerender } = await render(<RolloverModal pending={pending} remainingSlots={3} onApply={onApply} />);
    expect(applyText()).toHaveTextContent("Bring 3 into today");

    await rerender(<RolloverModal pending={pending} remainingSlots={1} onApply={onApply} />);
    expect(applyText()).toHaveTextContent("Bring 1 into today");
    expect(screen.getByText(/Room for 1 today/)).toBeOnTheScreen();
    expect(disabled("Read")).toBe(true);
    await fireEvent.press(applyText());
    expect(onApply).toHaveBeenLastCalledWith(["y0"]);

    await rerender(<RolloverModal pending={pending} remainingSlots={0} onApply={onApply} />);
    expect(applyText()).toHaveTextContent("Got it");
    await fireEvent.press(applyText());
    expect(onApply).toHaveBeenLastCalledWith([]);
  });

  it("when the room shrinks, the user's own picks are kept, trimmed to fit (never reset to the first ones)", async () => {
    const onApply = jest.fn();
    const pending = pendingOf("Walk", "Read", "Call mum");
    const { rerender } = await render(<RolloverModal pending={pending} remainingSlots={2} onApply={onApply} />);
    // The user picks Call mum over Walk...
    await fireEvent.press(row("Walk"));
    await fireEvent.press(row("Call mum"));
    expect(checked("Call mum")).toBe(true);
    // ...then the room drops to 1: still their picks (Read, ticked first), not Walk.
    await rerender(<RolloverModal pending={pending} remainingSlots={1} onApply={onApply} />);
    expect(checked("Walk")).toBe(false);
    expect(checked("Read")).toBe(true);
    expect(checked("Call mum")).toBe(false);
  });

  it("keeps the user's picks across re-renders that don't change the room or the pending list", async () => {
    const pending = pendingOf("Walk", "Read");
    const onApply = jest.fn();
    const { rerender } = await render(<RolloverModal pending={pending} remainingSlots={3} onApply={onApply} />);
    await fireEvent.press(row("Walk"));
    await rerender(<RolloverModal pending={pending} remainingSlots={3} onApply={jest.fn()} />);
    expect(checked("Walk")).toBe(false);
    expect(applyText()).toHaveTextContent("Bring 1 into today");
  });
});
