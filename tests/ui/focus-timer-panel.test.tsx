// Focus timer v2 (1.2, PR #70; on the session since 1.3): the panel on its
// own, over the pure session engine. Presets + the last custom chip (which
// start at once), Custom with Start, the custom wheel (iOS) and stepper
// (elsewhere), Pause / Resume / Stop timer, the background resync, the
// check-in at zero, what's announced, and the FocusMode wiring (Done's
// report, Close's hint). The store side (the end notification, the session
// surviving Close) is in focus-mode.test.tsx.
import { useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { FocusCheckIn, type FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { FocusMode } from "@/components/daily-tasks/focus-mode";
import { FocusTimerPanel } from "@/components/daily-tasks/focus-timer-panel";
import {
  extend,
  keepGoing,
  pause,
  resume,
  startSession,
  type FocusSession,
} from "@/lib/daily-tasks/focus-session";
import { LAST_CUSTOM_TIMER_KEY } from "@/lib/daily-tasks/focus-timer-storage";
import { getNotificationPermissionStatus } from "@/lib/daily-tasks/notifications";

import { spyOnAnnouncements } from "./focus-harness";
import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/notifications", () => ({
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
}));
const permission = getNotificationPermissionStatus as jest.Mock;

const START = new Date(2026, 8, 26, 9, 0);
const MIN = 60_000;
const originalOS = Platform.OS;
const TASK = { id: "t", text: "Write", createdAt: "", carriedOver: false };

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
  Platform.OS = originalOS;
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/** The session engine without the store: what Today does, in a few lines. */
function useLocalSession(onStart: (minutes: number) => void) {
  const [session, setSession] = useState<FocusSession | null>(null);
  const update = (change: (s: FocusSession, now: number) => FocusSession) =>
    setSession((current) => current && change(current, Date.now()));
  const controls: FocusSessionControls = {
    pause: () => update(pause),
    resume: () => update(resume),
    stop: () => setSession(null),
    extend: () => update((s, now) => extend(s, now)),
    keepGoing: () => update((s, now) => keepGoing(s, now)),
    done: jest.fn(),
  };
  const start = (minutes: number) => {
    onStart(minutes);
    setSession(
      startSession({ id: `s${Date.now()}`, taskId: TASK.id, taskText: TASK.text, date: "2026-09-26", kind: "timer", minutes, now: Date.now() }),
    );
  };
  return { session, controls, start };
}

function PanelHarness({ onStart }: { onStart: (minutes: number) => void }) {
  const { session, controls, start } = useLocalSession(onStart);
  return (
    <FocusTimerPanel
      session={session}
      onStart={start}
      controls={controls}
      checkIn={session ? <FocusCheckIn session={session} controls={controls} showDone={false} /> : null}
    />
  );
}

function ModeHarness({ onDone }: { onDone: (timer: number) => void }) {
  const { session, controls, start } = useLocalSession(() => {});
  return (
    <FocusMode
      task={TASK}
      session={session}
      onToggleStep={jest.fn()}
      onDone={onDone}
      onClose={jest.fn()}
      onStartTimer={start}
      controls={controls}
    />
  );
}

async function renderPanel() {
  const onStart = jest.fn();
  const view = await render(<PanelHarness onStart={onStart} />);
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

describe("FocusTimerPanel: another task's timer", () => {
  it("says above the lengths that starting here stops it", async () => {
    await render(
      <FocusTimerPanel
        session={null}
        onStart={jest.fn()}
        controls={{ pause: jest.fn(), resume: jest.fn(), stop: jest.fn(), extend: jest.fn(), keepGoing: jest.fn(), done: jest.fn() }}
        checkIn={null}
        otherTimerText="Read"
      />,
    );
    expect(screen.getByTestId("focus-timer-replaces")).toHaveTextContent('This stops the timer on "Read".');
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
    await act(async () => {});
    expect(await AsyncStorage.getItem(LAST_CUSTOM_TIMER_KEY)).toBe("75");

    await press("Stop timer");
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
  it("a chip starts it with its minutes", async () => {
    const { onStart } = await renderPanel();
    await press("20 minute timer");
    expect(onStart.mock.calls).toEqual([[20]]);
    expect(remaining()).toHaveTextContent("20:00");
  });

  it("Pause freezes the time left, even as the clock moves on", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(3 * MIN);
    expect(remaining()).toHaveTextContent("7:00");
    await press("Pause");
    expect(screen.getByTestId("focus-timer-ends")).toHaveTextContent("Paused");
    expect(screen.getByTestId("focus-timer-ring").props.accessibilityLabel).toBe(
      "Timer paused, 7 minutes left of 10 minutes",
    );
    // No ticking and no AppState listener while paused.
    expect(appStateListeners).toHaveLength(0);
    await advance(30 * MIN);
    jest.setSystemTime(START.getTime() + 60 * MIN);
    expect(remaining()).toHaveTextContent("7:00");
    expect(screen.queryByTestId("focus-check-in")).toBeNull();
  });

  it("Resume recomputes the end from now", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(3 * MIN);
    await press("Pause");
    await advance(20 * MIN);
    await press("Resume");
    expect(remaining()).toHaveTextContent("7:00");
    await advance(2 * MIN);
    expect(remaining()).toHaveTextContent("5:00");
    await advance(5 * MIN);
    expect(screen.getByTestId("focus-check-in-title")).toHaveTextContent('Time\'s up on "Write".');
  });

  it("Stop timer while running goes back to the picker (nothing picked)", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(MIN);
    await press("Stop timer");
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "10 minute timer" })).not.toBeSelected();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    await advance(20 * MIN);
    expect(screen.queryByTestId("focus-check-in")).toBeNull();
  });

  it("back from the background past the end: AppState active shows the check-in", async () => {
    await renderPanel();
    await press("5 minute timer");
    expect(appStateListeners).toHaveLength(1);
    jest.setSystemTime(START.getTime() + 12 * MIN);
    await foreground();
    expect(screen.getByTestId("focus-check-in-title")).toHaveTextContent('Time\'s up on "Write".');
  });

  it("Pause tapped after it ran out (between ticks) ends it instead of pausing at 0:00", async () => {
    await renderPanel();
    await press("5 minute timer");
    jest.setSystemTime(START.getTime() + 5 * MIN + 200);
    await press("Pause");
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(screen.getByTestId("focus-check-in")).toBeOnTheScreen();
  });
});

describe("FocusTimerPanel: finishing", () => {
  it("Time's up in a full ring (no tick) and the check-in: 5 more minutes and Stop here (no Done: the screen has one)", async () => {
    await renderPanel();
    await press("5 minute timer");
    await advance(5 * MIN);
    expect(screen.getByTestId("focus-timer-times-up")).toHaveTextContent("Time's up");
    expect(screen.getByTestId("focus-check-in-title")).toHaveTextContent('Time\'s up on "Write".');
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop timer" })).toBeNull();

    // 5 more minutes: runs again for just the extra, on a ring of the new length.
    await press("5 more minutes");
    expect(remaining()).toHaveTextContent("5:00");
    expect(screen.getByTestId("focus-timer-ring").props.accessibilityLabel).toMatch(/^5 minutes left of 10 minutes/);
    await advance(5 * MIN);
    await press("Stop here");
    expect(screen.queryByTestId("focus-timer-ring")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("the panel says Pause and Resume (the session's start and end are said by Today)", async () => {
    await renderPanel();
    await press("10 minute timer");
    await advance(2 * MIN);
    await press("Pause");
    await advance(MIN);
    await press("Resume");
    await advance(8 * MIN);
    expect(said()).toEqual(["Paused", "Resumed"]);
  });
});

describe("FocusMode: the timer reported on Done", () => {
  it("is the session's length, including 5 more minutes", async () => {
    const onDone = jest.fn();
    await render(<ModeHarness onDone={onDone} />);
    await act(async () => {});
    await press("20 minute timer");
    await press("Stop timer");
    await press("5 minute timer");
    await advance(5 * MIN);
    await press("5 more minutes");
    await press("Done");
    expect(onDone).toHaveBeenCalledWith(10);
  });

  it("is 0 after Stop timer; while a timer runs Close reads Back to Today (it keeps going)", async () => {
    const onDone = jest.fn();
    await render(<ModeHarness onDone={onDone} />);
    await act(async () => {});
    const close = () => screen.getByTestId("focus-close");
    expect(close()).toHaveTextContent("Close");
    expect(close().props.accessibilityHint).toBe("Closes focus mode");
    await press("20 minute timer");
    expect(close()).toHaveTextContent("Back to Today");
    expect(close().props.accessibilityLabel).toBe("Back to Today");
    expect(close().props.accessibilityHint).toBe("The timer keeps going");
    await press("Stop timer");
    expect(close()).toHaveTextContent("Close");
    expect(close().props.accessibilityHint).toBe("Closes focus mode");
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
