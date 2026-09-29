// The morning card (PR #69): last night's draft as ticked rows, the first that
// fit preselected, and the because line read from the morning's side.
import { fireEvent, screen } from "@testing-library/react-native";

import { TomorrowDraftCard } from "@/components/daily-tasks/ritual-cards";
import type { TomorrowDraft } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const draftOf = (tasks: string[], because = ""): TomorrowDraft => ({
  forDate: "2026-09-26",
  tasks,
  note: "",
  because,
  source: "local",
});

const row = (name: string) => screen.getByRole("checkbox", { name });
const checked = (name: string) => row(name).props.accessibilityState?.checked === true;
const disabled = (name: string) => row(name).props.accessibilityState?.disabled === true;
const useButton = () => screen.getByTestId("tomorrow-draft-use");
const hint = () => screen.queryByTestId("tomorrow-draft-hint");

async function renderCard(draft: TomorrowDraft, remainingSlots: number) {
  const onUse = jest.fn();
  const props = { draft, remainingSlots, onUse, onChange: jest.fn(), onDismiss: jest.fn() };
  const { rerender } = await render(<TomorrowDraftCard {...props} />);
  return { onUse, props, rerender };
}

describe("TomorrowDraftCard", () => {
  it("ticks everything that fits and offers Use these, with no hint", async () => {
    const { onUse } = await renderCard(draftOf(["Walk", "Read", "Stretch"]), 3);
    expect(["Walk", "Read", "Stretch"].every(checked)).toBe(true);
    expect(useButton()).toHaveTextContent("Use these");
    expect(hint()).toBeNull();
    await fireEvent.press(useButton());
    expect(onUse).toHaveBeenCalledWith(["Walk", "Read", "Stretch"]);
  });

  it("unticking one switches to Add N, says the unticked one is saved, and uses only the ticked (draft order)", async () => {
    const { onUse } = await renderCard(draftOf(["Walk", "Read", "Stretch"]), 3);
    await fireEvent.press(row("Read"));
    expect(checked("Read")).toBe(false);
    expect(useButton()).toHaveTextContent("Add 2");
    expect(useButton().props.accessibilityLabel).toBe("Add 2 tasks");
    expect(hint()).toHaveTextContent("The unticked one is saved for later.");
    // Re-tick then untick a different one: order is the draft's, not the tap order.
    await fireEvent.press(row("Read"));
    await fireEvent.press(row("Walk"));
    await fireEvent.press(useButton());
    expect(onUse).toHaveBeenCalledWith(["Read", "Stretch"]);
  });

  it("with one slot, ticks the first, greys out the rest; unticking frees them and a new tick is the one used", async () => {
    const { onUse } = await renderCard(draftOf(["Walk", "Read", "Stretch"]), 1);
    expect(checked("Walk")).toBe(true);
    expect(disabled("Read")).toBe(true);
    expect(disabled("Stretch")).toBe(true);
    expect(row("Read").props.accessibilityHint).toMatch(/Today is full\. Untick another one first\./);
    expect(useButton()).toHaveTextContent("Use this");
    expect(hint()).toHaveTextContent("Unticked ones are saved for later.");

    // Tapping a greyed-out row does nothing.
    await fireEvent.press(row("Stretch"));
    expect(checked("Stretch")).toBe(false);

    await fireEvent.press(row("Walk"));
    expect(disabled("Read")).toBe(false);
    expect(disabled("Stretch")).toBe(false);
    await fireEvent.press(row("Stretch"));
    expect(checked("Stretch")).toBe(true);
    expect(disabled("Walk")).toBe(true);
    await fireEvent.press(useButton());
    expect(onUse).toHaveBeenCalledWith(["Stretch"]);
  });

  it("with nothing ticked, the button is disabled, says why, and pressing it doesn't use anything", async () => {
    const { onUse } = await renderCard(draftOf(["Walk", "Read"]), 3);
    await fireEvent.press(row("Walk"));
    await fireEvent.press(row("Read"));
    expect(useButton().props.accessibilityState?.disabled).toBe(true);
    expect(useButton().props.accessibilityHint).toBe("Tick at least one task first");
    expect(hint()).toHaveTextContent("Tick the ones you want, or tap Change to start over.");
    await fireEvent.press(useButton());
    expect(onUse).not.toHaveBeenCalled();
  });

  it("trims the ticks when room shrinks while the card is open (keeping the user's picks otherwise)", async () => {
    const draft = draftOf(["Walk", "Read", "Stretch"]);
    const { onUse, props, rerender } = await renderCard(draft, 3);
    await fireEvent.press(row("Walk")); // Read + Stretch ticked
    await rerender(<TomorrowDraftCard {...props} remainingSlots={1} />);
    expect(checked("Read")).toBe(true);
    expect(checked("Stretch")).toBe(false);
    expect(disabled("Stretch")).toBe(true);
    await fireEvent.press(useButton());
    expect(onUse).toHaveBeenCalledWith(["Read"]);
  });

  it("re-seeds the ticks when a new draft arrives", async () => {
    const { props, rerender } = await renderCard(draftOf(["Walk", "Read"]), 2);
    await fireEvent.press(row("Walk"));
    await rerender(<TomorrowDraftCard {...props} draft={draftOf(["Walk", "Swim"])} />);
    expect(checked("Walk")).toBe(true);
    expect(checked("Swim")).toBe(true);
  });

  it("shows the because line from the morning's side", async () => {
    await renderCard(draftOf(["Walk"], "Because today worked well, tomorrow builds on it."), 3);
    expect(screen.getByTestId("tomorrow-draft")).toHaveTextContent(/Because yesterday worked well, today builds on it\./);
  });
});
