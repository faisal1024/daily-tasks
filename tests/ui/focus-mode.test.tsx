// Focus mode (1.2, PR C; the session's detail view since 1.3): the task, its
// start line and steps, the timer (5/10/20 start at once; wall-clock based,
// one haptic at zero, a check-in instead of a dead stop), its end
// notification, and closing without stopping it. Run on the real store.
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import {
  cancelFocusTimerNotification,
  scheduleFocusSessionNotification,
} from "@/lib/daily-tasks/notifications";
import type { Task } from "@/lib/daily-tasks/types";

import { renderFocusOnStore, spyOnAnnouncements, type FocusHarnessProps } from "./focus-harness";

jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  subscribeFocusResponses: jest.fn(() => () => {}),
}));
const schedule = scheduleFocusSessionNotification as jest.Mock;
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
let said: () => string[];

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (s: string) => void) => {
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((l) => l !== listener);
      },
    };
  }) as unknown as typeof AppState.addEventListener);
  said = spyOnAnnouncements();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderFocus(props: FocusHarnessProps = {}, task: Task = TASK) {
  const handlers = { onToggleStep: jest.fn(), onDone: jest.fn(), onClose: jest.fn() };
  const { view, rerender } = await renderFocusOnStore([task], {
    startLine: "Find the lead by the door.",
    ...handlers,
    ...props,
  });
  return { ...handlers, view, rerender };
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const foreground = () => act(async () => appStateListeners.forEach((listener) => listener("active")));
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
    await renderFocus({}, { ...TASK, steps: TASK.steps?.map((s) => ({ ...s, done: true })) });
    expect(screen.getByTestId("focus-steps-done")).toHaveTextContent("All steps done.");
  });

  it("defaults to no timer: a visible Timer label, 5/10/20 and Custom, none selected, nothing ticking or scheduled", async () => {
    await renderFocus();
    expect(screen.getByText("Timer")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "No timer" })).toBeNull();
    for (const name of ["5 minute timer", "10 minute timer", "20 minute timer", "Custom timer"]) {
      expect(screen.getByRole("button", { name })).not.toBeSelected();
    }
    expect(screen.getByRole("button", { name: "10 minute timer" })).toHaveTextContent("10 min");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(said()).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("10 min starts at once, shows 10:00, then 8:59 after 61 s, with a minute-level label and the end time", async () => {
    await renderFocus();
    await pick("10 minute timer");
    expect(remaining()).toHaveTextContent("10:00");
    expect(screen.getByTestId("focus-timer-ends")).toHaveTextContent(
      `Ends ${new Date(START.getTime() + 10 * MIN).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
    );
    expect(screen.getByTestId("focus-timer-ring").props.accessibilityLabel).toMatch(/^10 minutes left of 10 minutes, ends /);
    // Half a second in (resynced on foreground): it rounds up, never shows 9:59 yet.
    jest.setSystemTime(START.getTime() + 500);
    await foreground();
    expect(remaining()).toHaveTextContent("10:00");
    jest.setSystemTime(START.getTime());
    await advance(61_000);
    expect(remaining()).toHaveTextContent("8:59");
    expect(screen.getByTestId("focus-timer-ring").props.accessibilityLabel).toMatch(/^9 minutes left of 10 minutes/);
  });

  it("follows the wall clock after the background: 5 min later, AppState active shows 5:00 left", async () => {
    await renderFocus();
    await pick("10 minute timer");
    // Backgrounded: the clock moves but no interval ticks run.
    jest.setSystemTime(START.getTime() + 5 * MIN);
    expect(remaining()).toHaveTextContent("10:00");
    await foreground();
    expect(remaining()).toHaveTextContent("5:00");
  });

  it("never shows more than the full length when the clock moves back", async () => {
    await renderFocus();
    await pick("10 minute timer");
    jest.setSystemTime(START.getTime() - 5 * MIN);
    await foreground();
    expect(remaining()).toHaveTextContent("10:00");
  });

  it("at zero: one success haptic, a check in the ring, the check-in (said), and it stays open", async () => {
    const { onClose, onDone } = await renderFocus();
    await pick("10 minute timer");
    await advance(10 * MIN - 1000);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("focus-check-in")).toBeNull();

    await advance(1000);
    expect(screen.getByTestId("focus-check-in-title")).toHaveTextContent('Time\'s up on "Walk the dog".');
    expect(screen.queryByTestId("focus-timer-remaining")).toBeNull();
    expect(screen.getByTestId("focus-timer-check")).toBeOnTheScreen();
    expect(screen.getByLabelText("Timer finished")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "5 more minutes" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Not now" })).toBeOnTheScreen();
    // The footer's Done is the only Done.
    expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(1);
    await advance(5 * MIN);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("says only the start and the end, never each second or minute", async () => {
    await renderFocus();
    await pick("10 minute timer");
    expect(said()).toEqual(["Timer started, 10 minutes"]);
    await advance(9 * MIN);
    expect(said()).toHaveLength(1);
    await advance(2 * MIN);
    expect(said()).toEqual(["Timer started, 10 minutes", 'Time\'s up on "Walk the dog".']);
  });

  it("Stop timer goes back to the picker; 5 more minutes runs it again; Not now clears it", async () => {
    await renderFocus();
    await pick("20 minute timer");
    await advance(3 * MIN);
    expect(remaining()).toHaveTextContent("17:00");
    await pick("Stop timer");
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "20 minute timer" })).not.toBeSelected();

    await pick("10 minute timer");
    expect(remaining()).toHaveTextContent("10:00");
    // The store marks it ended right on time (a few ms after, never before).
    await advance(10 * MIN + 100);
    expect(screen.getByTestId("focus-check-in")).toBeOnTheScreen();
    await pick("5 more minutes");
    expect(remaining()).toHaveTextContent("5:00");
    expect(screen.queryByTestId("focus-check-in")).toBeNull();

    await advance(5 * MIN + 100);
    await pick("Not now");
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "10 minute timer" })).not.toBeSelected();
    // Nothing fires later: no third haptic, no check-in.
    await advance(30 * MIN);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("focus-check-in")).toBeNull();
  });

  it("schedules the end notification on start, cancels on Stop, reschedules on a new start and on 5 more minutes, and leaves it to go off at zero", async () => {
    await renderFocus();
    await pick("10 minute timer");
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ at: new Date(START.getTime() + 10 * MIN), body: 'Time\'s up on "Walk the dog".' }),
    );
    expect(cancel).not.toHaveBeenCalled();

    await advance(MIN);
    await pick("Stop timer");
    expect(cancel).toHaveBeenCalledTimes(1);
    await pick("20 minute timer");
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ at: new Date(START.getTime() + MIN + 20 * MIN) }));
    expect(schedule).toHaveBeenCalledTimes(2);

    cancel.mockClear();
    await advance(20 * MIN);
    // Left to go off (its sound plays in-app, its buttons work outside).
    expect(cancel).not.toHaveBeenCalled();
    const extendedAt = Date.now();
    await pick("5 more minutes");
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ at: new Date(extendedAt + 5 * MIN) }));
  });

  it("Close calls only onClose and keeps the timer; Done calls onDone once with the timer, even on a double tap", async () => {
    const { onClose, onDone, onToggleStep } = await renderFocus();
    await pick("20 minute timer");
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.props.accessibilityHint).toBe("Closes focus mode. The timer keeps going.");
    await pick("Close");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onToggleStep).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();

    await pick("Done");
    await pick("Done");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(20);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Done with no timer reports 0, and Close's hint doesn't mention one", async () => {
    const { onDone } = await renderFocus();
    expect(screen.getByRole("button", { name: "Close" }).props.accessibilityHint).toBe("Closes focus mode");
    await pick("Done");
    expect(onDone).toHaveBeenCalledWith(0);
  });

  it("closing (unmounting) mid-run stops its ticking but not the session or its notification", async () => {
    const { rerender } = await renderFocus();
    await pick("10 minute timer");
    const clearSpy = jest.spyOn(global, "clearInterval");
    await advance(1000);
    await rerender({ open: false });
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    // Opened again: the same session, the time moved on.
    await advance(2 * MIN);
    await rerender({ open: true });
    expect(remaining()).toHaveTextContent("7:59");
  });
});
