// Focus mode (1.2, PR C): the task, its start line and steps, the gentle
// timer (wall-clock based, one haptic at zero, never closes), and closing.
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, AppState } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { FocusMode, TIMES_UP_TEXT } from "@/components/daily-tasks/focus-mode";
import type { Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const START = new Date(2026, 8, 26, 9, 0);
const MIN = 60_000;

const TASK: Task = {
  id: "t0",
  text: "Walk the dog",
  createdAt: "",
  carriedOver: false,
  steps: [
    { id: "s1", text: "Find the lead", done: false },
    { id: "s2", text: "Put shoes on", done: true },
  ],
};

let appStateListeners: ((status: string) => void)[] = [];
let appStateRemove: jest.Mock;
let announce: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  appStateListeners = [];
  appStateRemove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (s: string) => void) => {
    appStateListeners.push(listener);
    return { remove: appStateRemove };
  }) as unknown as typeof AppState.addEventListener);
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderFocus(props: Partial<React.ComponentProps<typeof FocusMode>> = {}) {
  const handlers = { onToggleStep: jest.fn(), onDone: jest.fn(), onClose: jest.fn(), onEnd: jest.fn() };
  const view = await render(
    <FocusMode visible task={TASK} startLine="Find the lead by the door." {...handlers} {...props} />,
  );
  return { ...handlers, view };
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const remaining = () => screen.getByTestId("focus-timer-remaining");

describe("FocusMode", () => {
  it("shows the task, its start line and its steps; a step calls onToggleStep with its id", async () => {
    const { onToggleStep } = await renderFocus();
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Focus: Walk the dog" })).toHaveTextContent("Walk the dog");
    expect(screen.getByTestId("focus-start-line")).toHaveTextContent("Find the lead by the door.");
    const step2 = screen.getByRole("checkbox", { name: "Step 2 of 2: Put shoes on" });
    expect(step2).toBeChecked();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Step 1 of 2: Find the lead" }));
    expect(onToggleStep).toHaveBeenCalledTimes(1);
    expect(onToggleStep).toHaveBeenCalledWith("s1");
  });

  it("defaults to no timer: None selected, no ring, nothing ticking or listening", async () => {
    await renderFocus();
    expect(screen.getByRole("button", { name: "No timer" })).toBeSelected();
    expect(screen.getByRole("button", { name: "10 minute timer" })).not.toBeSelected();
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(appStateListeners).toHaveLength(0);
    expect(announce).not.toHaveBeenCalled();
  });

  it("10 min shows 10:00, then 8:59 after 61 s, with a minute-level label", async () => {
    await renderFocus();
    await fireEvent.press(screen.getByRole("button", { name: "10 minute timer" }));
    expect(screen.getByRole("button", { name: "10 minute timer" })).toBeSelected();
    expect(remaining()).toHaveTextContent("10:00");
    expect(screen.getByLabelText("Timer: 10 minutes left of 10")).toBeOnTheScreen();
    // Half a second in (resynced on foreground): it rounds up, never shows 9:59 yet.
    jest.setSystemTime(START.getTime() + 500);
    await act(async () => appStateListeners.forEach((listener) => listener("active")));
    expect(remaining()).toHaveTextContent("10:00");
    jest.setSystemTime(START.getTime());
    await advance(61_000);
    expect(remaining()).toHaveTextContent("8:59");
    expect(screen.getByLabelText("Timer: 9 minutes left of 10")).toBeOnTheScreen();
  });

  it("follows the wall clock after the background: 5 min later, AppState active shows 5:00 left", async () => {
    await renderFocus();
    await fireEvent.press(screen.getByRole("button", { name: "10 minute timer" }));
    expect(appStateListeners).toHaveLength(1);
    // Backgrounded: the clock moves but no interval ticks run.
    jest.setSystemTime(START.getTime() + 5 * MIN);
    expect(remaining()).toHaveTextContent("10:00");
    await act(async () => appStateListeners.forEach((listener) => listener("active")));
    expect(remaining()).toHaveTextContent("5:00");
  });

  it("at zero: one light haptic, the time's-up line (announced), and it stays open", async () => {
    const { onClose, onDone } = await renderFocus();
    await fireEvent.press(screen.getByRole("button", { name: "10 minute timer" }));
    await advance(10 * MIN - 1000);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("focus-times-up")).toBeNull();

    await advance(1000);
    expect(screen.getByTestId("focus-times-up")).toHaveTextContent(TIMES_UP_TEXT);
    expect(remaining()).toHaveTextContent("0:00");
    expect(screen.getByLabelText("Timer finished")).toBeOnTheScreen();
    await advance(5 * MIN);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("announces only on start and at time's up, never each second or minute", async () => {
    await renderFocus();
    await fireEvent.press(screen.getByRole("button", { name: "10 minute timer" }));
    expect(announce.mock.calls).toEqual([["Timer started, 10 minutes"]]);
    await advance(9 * MIN);
    expect(announce).toHaveBeenCalledTimes(1);
    await advance(2 * MIN);
    expect(announce.mock.calls).toEqual([["Timer started, 10 minutes"], [TIMES_UP_TEXT]]);
  });

  it("picking the same length again restarts it; None clears it and stops ticking", async () => {
    const { onEnd, view } = await renderFocus();
    await fireEvent.press(screen.getByRole("button", { name: "25 minute timer" }));
    await advance(3 * MIN);
    expect(remaining()).toHaveTextContent("22:00");
    expect(screen.getByRole("button", { name: "25 minute timer" })).toHaveProp("accessibilityHint", "Starts it again");
    await fireEvent.press(screen.getByRole("button", { name: "25 minute timer" }));
    expect(remaining()).toHaveTextContent("25:00");

    await fireEvent.press(screen.getByRole("button", { name: "No timer" }));
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(appStateRemove).toHaveBeenCalled();
    // Nothing fires later: no haptic, no time's up.
    await advance(30 * MIN);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("focus-times-up")).toBeNull();
    // Analytics still records the last timer they started.
    await view.unmount();
    expect(onEnd).toHaveBeenCalledWith(25);
  });

  it("Not now calls only onClose; Done calls only onDone", async () => {
    const { onClose, onDone, onToggleStep } = await renderFocus();
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onToggleStep).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("unmounting mid-run clears the interval and the AppState listener, and reports onEnd once", async () => {
    const { onEnd, view } = await renderFocus();
    const setSpy = jest.spyOn(global, "setInterval");
    const clearSpy = jest.spyOn(global, "clearInterval");
    await fireEvent.press(screen.getByRole("button", { name: "10 minute timer" }));
    const ticks = setSpy.mock.results.filter((_r, i) => setSpy.mock.calls[i][1] === 1000).map((r) => r.value);
    expect(ticks).toHaveLength(1);
    expect(clearSpy).not.toHaveBeenCalledWith(ticks[0]);
    await view.unmount();
    expect(clearSpy).toHaveBeenCalledWith(ticks[0]);
    expect(appStateRemove).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(10);
  });
});
