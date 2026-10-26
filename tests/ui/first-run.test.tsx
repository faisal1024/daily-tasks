// First run (Phase 9b; three screens since 1.5): dump → "Here are your three" → Today.
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
    // Returns how many went on today: all of them, unless a test says otherwise.
    onSet: jest.fn((picks: string[]) => picks.length),
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
    expect(button("Use these three")).toBeEnabled();
    expect((p.onStep as jest.Mock).mock.calls.map(([s]: [FirstRunStep]) => s)).toEqual(["dump", "sorting", "three"]);
  });
});

describe("FirstRun: choosing", () => {
  it("unticking a pick parks it: onSet(use, [unticked, ...rest]), then straight on to Today", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Call mum" }));
    expect(screen.getByRole("checkbox", { name: "Call mum" })).not.toBeChecked();
    await fireEvent.press(button("Use these two"));
    expect(p.onSet).toHaveBeenCalledWith(["Walk", "Report"], ["Call mum", "Groceries"]);
    expect(p.onFinish).toHaveBeenCalledTimes(1);
    expect(p.onFinish).toHaveBeenCalledWith({ picked: 2, source: "dump" });
    expect(p.onStep).toHaveBeenLastCalledWith("three");
  });

  it("can't use the picks with nothing ticked", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    for (const name of ["Walk", "Call mum", "Report"]) {
      await fireEvent.press(screen.getByRole("checkbox", { name }));
    }
    expect(button("Use these zero")).toBeDisabled();
    await fireEvent.press(button("Use these zero"));
    expect(p.onSet).not.toHaveBeenCalled();
    expect(p.onFinish).not.toHaveBeenCalled();
  });

  it("with nothing to pick, keeps it all and goes straight to Today", async () => {
    const p = props({ onSort: jest.fn(async () => sorted([], ["Note to self"])) });
    await render(<FirstRun {...p} />);
    await dumpAndSort("note to self");
    expect(p.onSet).toHaveBeenCalledWith([], ["Note to self"]);
    expect(p.onFinish).toHaveBeenCalledTimes(1);
    expect(p.onFinish).toHaveBeenCalledWith({ picked: 0, source: "dump" });
  });

  it("'I'll add my own' goes straight to Today without adding anything", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await fireEvent.press(button("I'll add my own"));
    expect(p.onFinish).toHaveBeenCalledTimes(1);
    expect(p.onFinish).toHaveBeenCalledWith({ picked: 0, source: "own" });
    expect(p.onSort).not.toHaveBeenCalled();
    expect(p.onSet).not.toHaveBeenCalled();
    expect((p.onStep as jest.Mock).mock.calls.map(([s]: [FirstRunStep]) => s)).toEqual(["dump"]);
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
    await fireEvent.press(button("Use this one"));
    expect(p.onSet).toHaveBeenCalledWith(["New A"], []);
    expect(p.onFinish).toHaveBeenCalledWith({ picked: 1, source: "dump" });
  });
});

describe("FirstRun: three screens (1.5)", () => {
  it("reports what actually went on today (onSet's answer), e.g. none on a day locked meanwhile", async () => {
    const p = props({ onSet: jest.fn(() => 0) });
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    await fireEvent.press(button("Use these three"));
    expect(p.onFinish).toHaveBeenCalledWith({ picked: 0, source: "dump" });
  });

  it("has no nudge or widget screen: using the picks is the last step", async () => {
    const p = props();
    await render(<FirstRun {...p} />);
    await dumpAndSort();
    await fireEvent.press(button("Use these three"));
    expect(p.onFinish).toHaveBeenCalledWith({ picked: 3, source: "dump" });
    expect(screen.queryByRole("button", { name: "Yes, nudge me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByText("Keep your three in sight")).toBeNull();
    expect(screen.queryByText(/are set\./)).toBeNull();
    const steps = (p.onStep as jest.Mock).mock.calls.map(([s]: [FirstRunStep]) => s);
    expect(steps).toEqual(["dump", "sorting", "three"]);
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
    const use = button("Use these three");
    await act(async () => {
      void fireEvent.press(use);
      void fireEvent.press(use);
    });
    expect(p.onSet).toHaveBeenCalledTimes(1);
    expect(p.onFinish).toHaveBeenCalledTimes(1);
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

  it("resumeCount (tasks already on today) has nothing left to ask: it finishes at once", async () => {
    const p = props({ resumeCount: 2 });
    await render(<FirstRun {...p} />);
    expect(p.onFinish).toHaveBeenCalledTimes(1);
    expect(p.onFinish).toHaveBeenCalledWith({ picked: 0, source: "resume" });
    expect(p.onStep).not.toHaveBeenCalled();
    expect(p.onSet).not.toHaveBeenCalled();
  });
});
