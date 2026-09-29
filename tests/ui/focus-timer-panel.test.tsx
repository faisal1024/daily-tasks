// Focus timer v2 (1.2, PR #70): the panel on its own. Presets + the last custom
// chip (which start at once), Custom with Start, the custom wheel (iOS) and
// stepper (elsewhere),
// Pause / Resume / Cancel and the end notification, the background resync,
// finishing, what's announced, and onStart on Start and Restart.
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, AppState, Platform } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { FocusMode } from "@/components/daily-tasks/focus-mode";
import { FocusTimerPanel } from "@/components/daily-tasks/focus-timer-panel";
import { timesUpText } from "@/lib/daily-tasks/focus-timer";
import { LAST_CUSTOM_TIMER_KEY } from "@/lib/daily-tasks/focus-timer-storage";
import {
  cancelFocusTimerNotification,
  getNotificationPermissionStatus,
  scheduleFocusTimerNotification,
} from "@/lib/daily-tasks/notifications";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusTimerNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
}));
const schedule = scheduleFocusTimerNotification as jest.Mock;
const cancel = cancelFocusTimerNotification as jest.Mock;
const permission = getNotificationPermissionStatus as jest.Mock;

const START = new Date(2026, 8, 26, 9, 0);
const MIN = 60_000;
const originalOS = Platform.OS;

let appStateListeners: ((status: string) => void)[] = [];
let announce: jest.SpyInstance;

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
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  await AsyncStorage.clear();
});

afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderPanel() {
  const onStart = jest.fn();
  const view = await render(<FocusTimerPanel onStart={onStart} />);
  // Let the last-custom load settle.
  await act(async () => {});
  return { onStart, view };
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const foreground = () => act(async () => appStateListeners.forEach((listener) => listener("active")));
const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
const remaining = () => screen.getByTestId("focus-timer-remaining");
const chipIds = () =>
  screen
    .getAllByRole("button")
    .map((node) => node.props.testID as string)
    .filter((id) => /^focus-timer-(\d+|custom)$/.test(id));
const wheelAt = (h: number, m: number) => {
  const date = new Date(START);
  date.setHours(h, m, 0, 0);
  return date;
};

describe("FocusTimerPanel: choosing a length", () => {
  it("offers 5 / 10 / 20 and Custom; the saved last custom length joins them as a chip", async () => {
    await AsyncStorage.setItem(LAST_CUSTOM_TIMER_KEY, "45");
    await renderPanel();
    expect(chipIds()).toEqual(["focus-timer-5", "focus-timer-10", "focus-timer-20", "focus-timer-45", "focus-timer-custom"]);
    expect(screen.getByRole("button", { name: "45 minute timer" })).toHaveTextContent("45 min");
  });

  it("an hour-plus last custom length reads in hours", async () => {
    await AsyncStorage.setItem(LAST_CUSTOM_TIMER_KEY, "75");
    await renderPanel();
    expect(screen.getByRole("button", { name: "1 hour 15 minutes timer" })).toHaveTextContent("1 hr 15 min");
  });

  it("a last custom length equal to a preset isn't a second chip", async () => {
    await AsyncStorage.setItem(LAST_CUSTOM_TIMER_KEY, "10");
    await renderPanel();
    expect(chipIds()).toEqual(["focus-timer-5", "focus-timer-10", "focus-timer-20", "focus-timer-custom"]);
    expect(screen.getAllByRole("button", { name: "10 minute timer" })).toHaveLength(1);
  });

  it("a length chip starts the timer at once (like Apple's Recents); Start and Cancel are only for Custom", async () => {
    const { onStart } = await renderPanel();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getByRole("button", { name: "5 minute timer" }).props.accessibilityHint).toBe(
      "Starts a timer for 5 minutes",
    );
    await press("5 minute timer");
    expect(onStart).toHaveBeenCalledWith(5);
    expect(schedule).toHaveBeenCalledWith(new Date(START.getTime() + 5 * MIN), 5);
    expect(remaining()).toHaveTextContent("5:00");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("the last custom chip sits in order among the presets and starts at once", async () => {
    await AsyncStorage.setItem(LAST_CUSTOM_TIMER_KEY, "7");
    const { onStart } = await renderPanel();
    expect(chipIds()).toEqual(["focus-timer-5", "focus-timer-7", "focus-timer-10", "focus-timer-20", "focus-timer-custom"]);
    await press("7 minute timer");
    expect(onStart).toHaveBeenCalledWith(7);
    expect(remaining()).toHaveTextContent("7:00");
  });

  it("Custom shows the limit, Cancel and Start; Cancel closes it without starting", async () => {
    const { onStart } = await renderPanel();
    await press("Custom timer");
    expect(screen.getByRole("button", { name: "Custom timer" })).toBeSelected();
    expect(screen.getByTestId("focus-timer-limit")).toHaveTextContent("Up to 3 hours");
    await press("Cancel");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getByRole("button", { name: "Custom timer" })).not.toBeSelected();
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("FocusTimerPanel: custom length", () => {
  it("iOS: the countdown wheel sets the length; Start runs it, saves it, and it becomes a chip", async () => {
    Platform.OS = "ios";
    const { onStart } = await renderPanel();
    await press("Custom timer");
    const wheel = screen.getByTestId("focus-timer-wheel");
    expect(wheel.props.mode).toBe("countdown");
    // Defaults to 15 minutes.
    expect(wheel.props.value.getHours()).toBe(0);
    expect(wheel.props.value.getMinutes()).toBe(15);

    await act(async () => wheel.props.onChange({ type: "set" }, wheelAt(1, 15)));
    expect(screen.getByRole("button", { name: "Start" }).props.accessibilityHint).toBe("Starts a timer for 1 hour 15 minutes");
    await press("Start");
    expect(onStart).toHaveBeenCalledWith(75);
    expect(remaining()).toHaveTextContent("1:15:00");
    expect(schedule).toHaveBeenLastCalledWith(new Date(START.getTime() + 75 * MIN), 75);
    await act(async () => {});
    expect(await AsyncStorage.getItem(LAST_CUSTOM_TIMER_KEY)).toBe("75");

    await press("Cancel");
    expect(screen.getByRole("button", { name: "1 hour 15 minutes timer" })).toHaveTextContent("1 hr 15 min");
  });

  it("iOS: a 0:00 wheel clamps to 1 minute and 4 hours to 3 hours, written back without remounting", async () => {
    Platform.OS = "ios";
    const { onStart } = await renderPanel();
    await press("Custom timer");
    const wheel = screen.getByTestId("focus-timer-wheel");
    await act(async () => wheel.props.onChange({ type: "set" }, wheelAt(0, 0)));
    const clampedLow = screen.getByTestId("focus-timer-wheel");
    expect(clampedLow).toBe(wheel);
    expect(clampedLow.props.value.getHours() * 60 + clampedLow.props.value.getMinutes()).toBe(1);
    await act(async () => screen.getByTestId("focus-timer-wheel").props.onChange({ type: "set" }, wheelAt(4, 0)));
    await advance(100);
    expect(screen.getByTestId("focus-timer-wheel")).toBe(wheel);
    // Again at the cap: the value is nudged (a second, then back, a frame
    // apart) so native setDate puts the wheel back to 3:00.
    const frames: FrameRequestCallback[] = [];
    jest.spyOn(global, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const wheelTime = () => (screen.getByTestId("focus-timer-wheel").props.value as Date).getTime();
    await act(async () => screen.getByTestId("focus-timer-wheel").props.onChange({ type: "set" }, wheelAt(5, 0)));
    const before = wheelTime();
    await act(async () => frames.shift()?.(0));
    expect(wheelTime()).toBe(before + 1000);
    await act(async () => frames.shift()?.(0));
    expect(wheelTime()).toBe(before);
    expect(screen.getByTestId("focus-timer-wheel")).toBe(wheel);
    const capped = screen.getByTestId("focus-timer-wheel").props.value as Date;
    expect(capped.getHours() * 60 + capped.getMinutes()).toBe(180);
    await press("Start");
    expect(onStart).toHaveBeenCalledWith(180);
    expect(remaining()).toHaveTextContent("3:00:00");
  });

  it("iOS: one frame after the wheel mounts its value is nudged a second and back (UIKit first-spin quirk)", async () => {
    Platform.OS = "ios";
    const frames: FrameRequestCallback[] = [];
    jest.spyOn(global, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    await renderPanel();
    await press("Custom timer");
    const wheelTime = () => (screen.getByTestId("focus-timer-wheel").props.value as Date).getTime();
    const mounted = wheelTime();
    // A fixed day, so daylight saving can't move the wheel's h:mm.
    expect(new Date(mounted).getFullYear()).toBe(2000);
    await act(async () => frames.shift()?.(0));
    expect(wheelTime()).toBe(mounted + 1000);
    await act(async () => frames.shift()?.(0));
    expect(wheelTime()).toBe(mounted);
  });

  it("Android: a stepper instead of the wheel, in steps of 5 within 1–180", async () => {
    Platform.OS = "android";
    const { onStart } = await renderPanel();
    await press("Custom timer");
    expect(screen.queryByTestId("focus-timer-wheel")).toBeNull();
    const value = () => screen.getByTestId("focus-timer-stepper-value");
    expect(value()).toHaveTextContent("15 min");
    await press("Longer timer");
    expect(value()).toHaveTextContent("20 min");
    for (let i = 0; i < 4; i++) await press("Shorter timer");
    expect(value()).toHaveTextContent("1 min");
    expect(screen.getByRole("button", { name: "Shorter timer" })).toBeDisabled();
    await press("Longer timer");
    expect(value()).toHaveTextContent("5 min");
    for (let i = 0; i < 40; i++) {
      if (screen.getByRole("button", { name: "Longer timer" }).props.accessibilityState?.disabled) break;
      await press("Longer timer");
    }
    expect(value()).toHaveTextContent("3 hr");
    expect(screen.getByRole("button", { name: "Longer timer" })).toBeDisabled();
    await press("Start");
    expect(onStart).toHaveBeenCalledWith(180);
  });
});

describe("FocusTimerPanel: running", () => {
  it("Start schedules the end notification with its minutes", async () => {
    const { onStart } = await renderPanel();
    await press("20 minute timer");
    expect(onStart.mock.calls).toEqual([[20]]);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(new Date(START.getTime() + 20 * MIN), 20);
    expect(remaining()).toHaveTextContent("20:00");
  });

  it("Pause cancels the notification and freezes the time left, even as the clock moves on", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(3 * MIN);
    expect(remaining()).toHaveTextContent("7:00");
    expect(cancel).not.toHaveBeenCalled();
    await press("Pause");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("focus-timer-ends")).toHaveTextContent("Paused");
    expect(screen.getByTestId("focus-timer-ring").props.accessibilityLabel).toBe(
      "Timer paused, 7 minutes left of 10 minutes",
    );
    // No ticking and no AppState listener while paused.
    expect(appStateListeners).toHaveLength(0);
    await advance(30 * MIN);
    jest.setSystemTime(START.getTime() + 60 * MIN);
    expect(remaining()).toHaveTextContent("7:00");
    expect(screen.queryByTestId("focus-times-up")).toBeNull();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("Resume recomputes the end from now and reschedules the notification", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(3 * MIN);
    await press("Pause");
    await advance(20 * MIN);
    const resumedAt = Date.now();
    await press("Resume");
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenLastCalledWith(new Date(resumedAt + 7 * MIN), 10);
    expect(remaining()).toHaveTextContent("7:00");
    await advance(2 * MIN);
    expect(remaining()).toHaveTextContent("5:00");
    await advance(5 * MIN);
    expect(screen.getByTestId("focus-times-up")).toHaveTextContent(timesUpText(10));
  });

  it("Cancel while running goes back to the picker (nothing picked) and cancels the notification", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(MIN);
    await press("Cancel");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "10 minute timer" })).not.toBeSelected();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    await advance(20 * MIN);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("back from the background past the end: AppState active finishes it", async () => {
    await renderPanel();
    await press("5 minute timer");
    expect(appStateListeners).toHaveLength(1);
    jest.setSystemTime(START.getTime() + 12 * MIN);
    await foreground();
    expect(screen.getByTestId("focus-times-up")).toHaveTextContent(timesUpText(5));
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it("Pause tapped after it ran out (between ticks) finishes it instead of pausing at 0:00", async () => {
    await renderPanel();
    await press("5 minute timer");
    jest.setSystemTime(START.getTime() + 5 * MIN + 200);
    await press("Pause");
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(screen.getByTestId("focus-times-up")).toBeOnTheScreen();
  });
});

describe("FocusTimerPanel: finishing", () => {
  it("one success haptic, the time's-up line, Restart and Clear; the notification is cancelled", async () => {
    const { onStart } = await renderPanel();
    await press("5 minute timer");
    await advance(5 * MIN);
    expect(screen.getByTestId("focus-times-up")).toHaveTextContent("That's 5 minutes. Keep going, or take a break.");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Restart" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Clear timer" })).toHaveTextContent("Clear");
    expect(screen.getByRole("button", { name: "Restart" }).props.accessibilityHint).toBe(
      "Starts the timer for 5 minutes again",
    );
    await advance(10 * MIN);
    await foreground();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);

    // Restart: a new run of the same length, reported and rescheduled.
    const restartedAt = Date.now();
    await press("Restart");
    expect(onStart.mock.calls).toEqual([[5], [5]]);
    expect(schedule).toHaveBeenLastCalledWith(new Date(restartedAt + 5 * MIN), 5);
    expect(remaining()).toHaveTextContent("5:00");

    await advance(5 * MIN);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    await press("Clear timer");
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("announces only start, pause, resume and the end, never each second or minute", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(2 * MIN);
    await press("Pause");
    await advance(MIN);
    await press("Resume");
    await advance(8 * MIN);
    expect(announce.mock.calls).toEqual([["Timer started, 10 minutes"], ["Paused"], ["Resumed"], [timesUpText(10)]]);
  });

  it("a quick Pause then Resume announces only the latest", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(1000);
    await press("Pause");
    await press("Resume");
    await advance(1000);
    expect(announce.mock.calls).toEqual([["Timer started, 10 minutes"], ["Resumed"]]);
  });
});

describe("FocusMode: the timer reported on Done", () => {
  it("is the last started length (including a Restart), and each start is reported", async () => {
    const onDone = jest.fn();
    const onTimerStart = jest.fn();
    await render(
      <FocusMode
        task={{ id: "t", text: "Write", createdAt: "", carriedOver: false }}
        onToggleStep={jest.fn()}
        onDone={onDone}
        onClose={jest.fn()}
        onTimerStart={onTimerStart}
      />,
    );
    await act(async () => {});
    await press("20 minute timer");
    await press("Cancel");
    await press("5 minute timer");
    await advance(5 * MIN);
    await press("Restart");
    expect(onTimerStart.mock.calls).toEqual([[20], [5], [5]]);
    await press("Done");
    expect(onDone).toHaveBeenCalledWith(5);
  });

  it("is 0 after a Cancel, and Not now's hint says it stops a running timer", async () => {
    const onDone = jest.fn();
    await render(
      <FocusMode
        task={{ id: "t", text: "Write", createdAt: "", carriedOver: false }}
        onToggleStep={jest.fn()}
        onDone={onDone}
        onClose={jest.fn()}
      />,
    );
    await act(async () => {});
    const notNow = () => screen.getByRole("button", { name: "Not now" });
    expect(notNow().props.accessibilityHint).toBe("Closes focus mode");
    await press("20 minute timer");
    expect(notNow().props.accessibilityHint).toBe("Closes focus mode and stops the timer.");
    await press("Cancel");
    expect(notNow().props.accessibilityHint).toBe("Closes focus mode");
    await press("Done");
    expect(onDone).toHaveBeenCalledWith(0);
  });
});

describe("FocusTimerPanel: the end-time icon", () => {
  it("a bell when notifications are allowed, a clock otherwise", async () => {
    await renderPanel();
    await press("5 minute timer");
    expect(screen.getByTestId("focus-timer-icon-bell")).toBeOnTheScreen();
  });

  it("a clock without notification permission", async () => {
    permission.mockResolvedValueOnce("denied");
    await renderPanel();
    await press("5 minute timer");
    expect(screen.queryByTestId("focus-timer-icon-bell")).toBeNull();
    expect(screen.getByTestId("focus-timer-icon-clock")).toBeOnTheScreen();
  });
});
