// Focus mode (1.2, PR C): the task, its start line and steps, the timer
// (5/10/20 start at once, or Custom with Start/Cancel; wall-clock based, one haptic at zero,
// never closes), its end-of-timer notification, and closing.
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, AppState } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { FocusMode } from "@/components/daily-tasks/focus-mode";
import { timesUpText } from "@/lib/daily-tasks/focus-timer";
import {
  cancelFocusTimerNotification,
  scheduleFocusTimerNotification,
} from "@/lib/daily-tasks/notifications";
import type { Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusTimerNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
}));
const schedule = scheduleFocusTimerNotification as jest.Mock;
const cancel = cancelFocusTimerNotification as jest.Mock;

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
  const handlers = { onToggleStep: jest.fn(), onDone: jest.fn(), onClose: jest.fn(), onTimerStart: jest.fn() };
  const view = await render(
    <FocusMode task={TASK} startLine="Find the lead by the door." {...handlers} {...props} />,
  );
  return { ...handlers, view };
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const remaining = () => screen.getByTestId("focus-timer-remaining");
const pick = (name: string) => fireEvent.press(screen.getByRole("button", { name }));

describe("FocusMode", () => {
  it("shows the task, its start line and its steps; a step calls onToggleStep with its id", async () => {
    const { onToggleStep } = await renderFocus();
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Focus: Walk the dog" })).toHaveTextContent("Walk the dog");
    expect(screen.getByTestId("focus-start-line")).toHaveTextContent("Find the lead by the door.");
    const step2 = screen.getByRole("checkbox", { name: "Step 2 of 2: Put shoes on" });
    expect(step2).toBeChecked();
    expect(screen.queryByTestId("focus-steps-done")).toBeNull();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Step 1 of 2: Find the lead" }));
    expect(onToggleStep).toHaveBeenCalledTimes(1);
    expect(onToggleStep).toHaveBeenCalledWith("s1");
  });

  it("says All steps done. once every step is ticked", async () => {
    await renderFocus({ task: { ...TASK, steps: TASK.steps?.map((s) => ({ ...s, done: true })) } });
    expect(screen.getByTestId("focus-steps-done")).toHaveTextContent("All steps done.");
  });

  it("defaults to no timer: a visible Timer label, 5/10/20 and Custom, none selected, no No timer, nothing ticking or scheduled", async () => {
    await renderFocus();
    expect(screen.getByText("Timer")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "No timer" })).toBeNull();
    for (const name of ["5 minute timer", "10 minute timer", "20 minute timer", "Custom timer"]) {
      expect(screen.getByRole("button", { name })).not.toBeSelected();
    }
    expect(screen.getByRole("button", { name: "10 minute timer" })).toHaveTextContent("10 min");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(appStateListeners).toHaveLength(0);
    expect(announce).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("10 min starts at once, shows 10:00, then 8:59 after 61 s, with a minute-level label and the end time", async () => {
    const { onTimerStart } = await renderFocus();
    await pick("10 minute timer");
    expect(onTimerStart).toHaveBeenCalledWith(10);
    expect(remaining()).toHaveTextContent("10:00");
    expect(screen.getByTestId("focus-timer-ends")).toHaveTextContent(
      `Ends ${new Date(START.getTime() + 10 * MIN).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
    );
    expect(screen.getByTestId("focus-timer-ring").props.accessibilityLabel).toMatch(/^10 minutes left of 10 minutes, ends /);
    // Half a second in (resynced on foreground): it rounds up, never shows 9:59 yet.
    jest.setSystemTime(START.getTime() + 500);
    await act(async () => appStateListeners.forEach((listener) => listener("active")));
    expect(remaining()).toHaveTextContent("10:00");
    jest.setSystemTime(START.getTime());
    await advance(61_000);
    expect(remaining()).toHaveTextContent("8:59");
    expect(screen.getByTestId("focus-timer-ring").props.accessibilityLabel).toMatch(/^9 minutes left of 10 minutes/);
  });

  it("follows the wall clock after the background: 5 min later, AppState active shows 5:00 left", async () => {
    await renderFocus();
    await pick("10 minute timer");
    expect(appStateListeners).toHaveLength(1);
    // Backgrounded: the clock moves but no interval ticks run.
    jest.setSystemTime(START.getTime() + 5 * MIN);
    expect(remaining()).toHaveTextContent("10:00");
    await act(async () => appStateListeners.forEach((listener) => listener("active")));
    expect(remaining()).toHaveTextContent("5:00");
  });

  it("never shows more than the full length when the clock moves back", async () => {
    await renderFocus();
    await pick("10 minute timer");
    jest.setSystemTime(START.getTime() - 5 * MIN);
    await act(async () => appStateListeners.forEach((listener) => listener("active")));
    expect(remaining()).toHaveTextContent("10:00");
  });

  it("at zero: one success haptic, a check in the ring, the time's-up line (announced), and it stays open", async () => {
    const { onClose, onDone } = await renderFocus();
    await pick("10 minute timer");
    await advance(10 * MIN - 1000);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("focus-times-up")).toBeNull();

    await advance(1000);
    expect(screen.getByTestId("focus-times-up")).toHaveTextContent(timesUpText(10));
    expect(timesUpText(10)).toBe("That's 10 minutes. Keep going, or take a break.");
    expect(screen.queryByTestId("focus-timer-remaining")).toBeNull();
    expect(screen.getByTestId("focus-timer-check")).toBeOnTheScreen();
    expect(screen.getByLabelText("Timer finished")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Restart" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Clear timer" })).toBeOnTheScreen();
    await advance(5 * MIN);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("announces only on start (after a short delay) and at time's up, never each second or minute", async () => {
    await renderFocus();
    await pick("10 minute timer");
    expect(announce).not.toHaveBeenCalled();
    await advance(300);
    expect(announce.mock.calls).toEqual([["Timer started, 10 minutes"]]);
    await advance(9 * MIN);
    expect(announce).toHaveBeenCalledTimes(1);
    await advance(2 * MIN);
    expect(announce.mock.calls).toEqual([["Timer started, 10 minutes"], [timesUpText(10)]]);
  });

  it("Cancel goes back to the picker; Restart starts it again once finished; Clear clears it", async () => {
    const { onTimerStart } = await renderFocus();
    await pick("20 minute timer");
    await advance(3 * MIN);
    expect(remaining()).toHaveTextContent("17:00");
    await pick("Cancel");
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "20 minute timer" })).not.toBeSelected();
    expect(appStateRemove).toHaveBeenCalled();

    await pick("10 minute timer");
    expect(remaining()).toHaveTextContent("10:00");
    expect(onTimerStart.mock.calls).toEqual([[20], [10]]);

    await advance(10 * MIN);
    expect(screen.getByTestId("focus-times-up")).toBeOnTheScreen();
    await pick("Restart");
    expect(remaining()).toHaveTextContent("10:00");
    expect(screen.queryByTestId("focus-times-up")).toBeNull();
    expect(onTimerStart).toHaveBeenCalledTimes(3);

    await advance(10 * MIN);
    await pick("Clear timer");
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "10 minute timer" })).not.toBeSelected();
    // Nothing fires later: no third haptic, no time's up.
    await advance(30 * MIN);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("focus-times-up")).toBeNull();
  });

  it("schedules the end notification on start, cancels on Cancel, reschedules on a new start, and leaves it to go off at zero", async () => {
    await renderFocus();
    await pick("10 minute timer");
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenLastCalledWith(new Date(START.getTime() + 10 * MIN), 10);
    expect(cancel).not.toHaveBeenCalled();

    await advance(MIN);
    await pick("Cancel");
    expect(cancel).toHaveBeenCalledTimes(1);
    await pick("20 minute timer");
    expect(schedule).toHaveBeenLastCalledWith(new Date(START.getTime() + MIN + 20 * MIN), 20);
    expect(schedule).toHaveBeenCalledTimes(2);

    cancel.mockClear();
    await advance(20 * MIN);
    // Left to go off (its sound plays in-app), then dismissed a moment later.
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Not now calls only onClose; Done calls onDone once with the timer, even on a double tap", async () => {
    const { onClose, onDone, onToggleStep } = await renderFocus();
    await pick("Not now");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onToggleStep).not.toHaveBeenCalled();

    await pick("20 minute timer");
    await pick("Done");
    await pick("Done");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(20);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Done with no timer reports 0", async () => {
    const { onDone } = await renderFocus();
    await pick("Done");
    expect(onDone).toHaveBeenCalledWith(0);
  });

  it("unmounting mid-run clears the interval, the AppState listener and the notification", async () => {
    const { view } = await renderFocus();
    const setSpy = jest.spyOn(global, "setInterval");
    const clearSpy = jest.spyOn(global, "clearInterval");
    await pick("10 minute timer");
    const ticks = setSpy.mock.results.filter((_r, i) => setSpy.mock.calls[i][1] === 1000).map((r) => r.value);
    expect(ticks).toHaveLength(1);
    expect(clearSpy).not.toHaveBeenCalledWith(ticks[0]);
    await view.unmount();
    expect(clearSpy).toHaveBeenCalledWith(ticks[0]);
    expect(appStateRemove).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    // The delayed start announcement doesn't fire after it's gone.
    await advance(1000);
    expect(announce).not.toHaveBeenCalled();
  });
});
