// First run (Phase 9b): dump → pick three → set → nudge → widget.
import { act, fireEvent, screen } from "@testing-library/react-native";

import { FirstRun, type FirstRunStep } from "@/components/daily-tasks/first-run";
import type { SortedBrainDump } from "@/lib/daily-tasks/ai-helpers";

import { renderWithProviders as render } from "./render";

function sorted(picks: string[], parked: string[] = [], notice: string | null = null): SortedBrainDump {
  return { result: { picks, parked, source: "ai" }, notice } as SortedBrainDump;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function props(overrides: Partial<Parameters<typeof FirstRun>[0]> = {}) {
  return {
    visible: true,
    onSort: jest.fn(async () => sorted(["Walk", "Call mum", "Report"], ["Groceries"])),
    onSet: jest.fn(),
    onAskNudge: jest.fn(async () => true),
    showWidgetStep: true,
    onStep: jest.fn(),
    onFinish: jest.fn(),
    ...overrides,
  };
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

async function dumpAndSort(text = "  walk, call mum, report, groceries  ") {
  await fireEvent.changeText(screen.getByLabelText("What's on your mind today"), text);
  await fireEvent.press(button("Pick my three"));
}

describe("FirstRun: dump and sort", () => {
  it("can't pick three from an empty (or blank) dump", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    expect(button("Pick my three")).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("What's on your mind today"), "   ");
    expect(button("Pick my three")).toBeDisabled();
    await fireEvent.press(button("Pick my three"));
    expect(p.onSort).not.toHaveBeenCalled();
    expect(p.onStep).toHaveBeenCalledWith("dump");
  });

  it("sorts the trimmed text and shows the picks, all ticked, with the rest counted", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    expect(p.onSort).toHaveBeenCalledWith("walk, call mum, report, groceries");
    expect(screen.getByText("Here are your three for today")).toBeOnTheScreen();
    for (const name of ["Walk", "Call mum", "Report"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
    expect(screen.getByText("1 more thing saved for later.")).toBeOnTheScreen();
    expect(button("Set my three")).toBeEnabled();
    expect((p.onStep as jest.Mock).mock.calls.map(([s]: [FirstRunStep]) => s)).toEqual(["dump", "sorting", "three"]);
  });
});

describe("FirstRun: choosing", () => {
  it("unticking a pick parks it: onSet(use, [unticked, ...rest])", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Call mum" }));
    expect(screen.getByRole("checkbox", { name: "Call mum" })).not.toBeChecked();
    await fireEvent.press(button("Set my two"));
    expect(p.onSet).toHaveBeenCalledWith(["Walk", "Report"], ["Call mum", "Groceries"]);
    expect(screen.getByText("Your two are set.")).toBeOnTheScreen();
    expect(p.onStep).toHaveBeenLastCalledWith("nudge");
  });

  it("can't set with nothing ticked", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    for (const name of ["Walk", "Call mum", "Report"]) {
      await fireEvent.press(screen.getByRole("checkbox", { name }));
    }
    expect(button("Set my zero")).toBeDisabled();
    await fireEvent.press(button("Set my zero"));
    expect(p.onSet).not.toHaveBeenCalled();
  });

  it("with nothing to pick, keeps it all and goes straight to the nudge", async () => {
    const p = props({ onSort: jest.fn(async () => sorted([], ["Note to self"])) });
    await render(<FirstRun {...p} />);
    await dumpAndSort("note to self");
    expect(p.onSet).toHaveBeenCalledWith([], ["Note to self"]);
    expect(screen.getByText("Add your three on Today")).toBeOnTheScreen();
  });

  it("'I'll add my own' skips to the nudge without setting anything", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await fireEvent.press(button("I'll add my own"));
    expect(screen.getByText("Add your three on Today")).toBeOnTheScreen();
    expect(p.onSort).not.toHaveBeenCalled();
    expect(p.onSet).not.toHaveBeenCalled();
    expect(p.onStep).toHaveBeenLastCalledWith("nudge");
  });

  it("Start over then re-sort shows the new picks, not the old ones", async () => {
    const second = deferred<SortedBrainDump>();
    const onSort = jest
      .fn()
      .mockResolvedValueOnce(sorted(["Old A", "Old B"]))
      .mockReturnValueOnce(second.promise);
    const p = props({ onSort });
    await render(<FirstRun {...p} />);
    await dumpAndSort("old");
    expect(screen.getByRole("checkbox", { name: "Old A" })).toBeOnTheScreen();
    await fireEvent.press(button("Start over"));
    await dumpAndSort("new");
    expect(screen.getByText("Picking your three…")).toBeOnTheScreen();
    await act(async () => second.resolve(sorted(["New A"])));
    expect(screen.getByText("Here's one for today")).toBeOnTheScreen();
    expect(screen.queryByRole("checkbox", { name: "Old A" })).toBeNull();
    await fireEvent.press(button("Set this one"));
    expect(p.onSet).toHaveBeenCalledWith(["New A"], []);
  });
});

describe("FirstRun: nudge and widget", () => {
  it("'Yes, nudge me' waits for the permission, then shows the widget step; Done finishes", async () => {
    const answer = deferred<boolean>();
    const p = props({ onAskNudge: jest.fn(() => answer.promise) });
    await render(<FirstRun {...p} />);
    await fireEvent.press(button("I'll add my own"));
    await fireEvent.press(button("Yes, nudge me"));
    expect(p.onAskNudge).toHaveBeenCalledTimes(1);
    expect(button("Asking…")).toBeDisabled();
    expect(p.onStep).not.toHaveBeenCalledWith("widget");
    await act(async () => answer.resolve(false));
    expect(screen.getByText("Keep your three in sight")).toBeOnTheScreen();
    expect(p.onStep).toHaveBeenLastCalledWith("widget");
    expect(p.onFinish).not.toHaveBeenCalled();
    await fireEvent.press(button("Done"));
    expect(p.onFinish).toHaveBeenCalledTimes(1);
  });

  it("without the widget step, the nudge answer finishes first run", async () => {
    const p = props({ showWidgetStep: false });
    await render(<FirstRun {...p} />);
    await fireEvent.press(button("I'll add my own"));
    await fireEvent.press(button("Yes, nudge me"));
    expect(p.onFinish).toHaveBeenCalledTimes(1);
    expect(p.onStep).not.toHaveBeenCalledWith("widget");
  });

  it("'Not now' skips the permission and moves on the same way", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await fireEvent.press(button("I'll add my own"));
    await fireEvent.press(button("Not now"));
    expect(p.onAskNudge).not.toHaveBeenCalled();
    expect(screen.getByText("Keep your three in sight")).toBeOnTheScreen();

    const q = props({ showWidgetStep: false });
    await render(<FirstRun {...q} />);
    await fireEvent.press(button("I'll add my own"));
    await fireEvent.press(button("Not now"));
    expect(q.onFinish).toHaveBeenCalledTimes(1);
  });
});

describe("FirstRun: review fixes (7275263)", () => {
  it("Cancel while sorting goes back to the dump (text kept) and ignores the late reply", async () => {
    const reply = deferred<SortedBrainDump>();
    const p = props({ onSort: jest.fn(() => reply.promise) });
    await render(<FirstRun {...p} />);
    await dumpAndSort("walk");
    await fireEvent.press(button("Cancel"));
    expect(screen.getByLabelText("What's on your mind today").props.value).toBe("walk");
    await act(async () => reply.resolve(sorted(["Walk"])));
    expect(screen.getByTestId("first-run-dump")).toBeOnTheScreen();
    expect(p.onSet).not.toHaveBeenCalled();
  });

  it("a double tap sorts once and sets once", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await fireEvent.changeText(screen.getByLabelText("What's on your mind today"), "walk");
    // Both taps land before React re-renders (same handler, same render).
    const pick = button("Pick my three");
    await act(async () => {
      void fireEvent.press(pick);
      void fireEvent.press(pick);
    });
    expect(p.onSort).toHaveBeenCalledTimes(1);
    const set = button("Set my three");
    await act(async () => {
      void fireEvent.press(set);
      void fireEvent.press(set);
    });
    expect(p.onSet).toHaveBeenCalledTimes(1);
  });

  it("replaces the sorter's notice with the first-run fallback copy", async () => {
    const p = props({ onSort: jest.fn(async () => sorted(["Walk"], [], "Couldn't reach the AI")) });
    await render(<FirstRun {...p} />);
    await dumpAndSort("walk");
    expect(screen.queryByText("Couldn't reach the AI")).toBeNull();
    expect(screen.getByText(/We couldn't sort this one, so here are the first few/)).toBeOnTheScreen();
  });

  it("a free-limit split shows the used-up copy (not the fallback), then Start over clears it", async () => {
    const limited = {
      result: { picks: ["Swim"], parked: [], source: "local" },
      notice: "sorter's own notice",
      freeLimit: true,
    } as SortedBrainDump;
    const onSort = jest.fn(async () => limited).mockResolvedValueOnce(limited).mockResolvedValueOnce(sorted(["Walk"]));
    const p = props({ onSort });
    await render(<FirstRun {...p} />);
    await dumpAndSort("swim");
    expect(screen.getByTestId("first-run-three")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Your free AI sorts are used up, so we kept the first things you wrote. Untick any that aren't for today.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/We couldn't sort this one/)).toBeNull();
    expect(screen.queryByText("sorter's own notice")).toBeNull();
    await fireEvent.press(button("Start over"));
    await dumpAndSort("walk");
    expect(screen.queryByText(/free AI sorts are used up/)).toBeNull();
    expect(screen.queryByText(/We couldn't sort this one/)).toBeNull();
  });

  it("an AI sort with no notice shows no notice", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    expect(screen.queryByText(/free AI sorts are used up/)).toBeNull();
    expect(screen.queryByText(/We couldn't sort this one/)).toBeNull();
  });

  it("the nudge copy matches the schedule and points to Settings", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    await fireEvent.press(button("Set my three"));
    expect(screen.getByText("Your three are set.")).toBeOnTheScreen();
    expect(
      screen.getByText(/a nudge in the morning, a few gentle ones while your three are open, and some in the evening until you close the day\? You can change these in Settings\./),
    ).toBeOnTheScreen();
  });

  it("reopening starts fresh (text, picks cleared) at the dump", async () => {
    const p = props();
    const { rerender } = await render(<FirstRun {...p} />);
    await dumpAndSort("walk");
    await rerender(<FirstRun {...p} visible={false} />);
    await rerender(<FirstRun {...p} visible />);
    expect(screen.getByTestId("first-run-dump")).toBeOnTheScreen();
    expect(screen.getByLabelText("What's on your mind today").props.value).toBe("");
    expect(button("Pick my three")).toBeDisabled();
  });

  it("resumeCount starts at the nudge with the set count", async () => {
    const p = props({ resumeCount: 2 });
    await render(<FirstRun {...p} />);
    expect(screen.getByText("Your two are set.")).toBeOnTheScreen();
    expect(p.onStep).toHaveBeenCalledWith("nudge");
    expect(p.onStep).not.toHaveBeenCalledWith("dump");
  });
});
