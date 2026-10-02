// Keep-awake on the focus screen (1.3 polish, PR #82): the screen stays on
// only while the timer counts down with the app on screen; a pause, time's up,
// the session ending, closing the screen or the background releases it, and
// coming back to a running timer takes it again. expo-keep-awake is mocked:
// `held` is whether the focus tag is currently held.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { FOCUS_KEEP_AWAKE_TAG } from "@/hooks/use-focus-keep-awake";
import type { Task } from "@/lib/daily-tasks/types";

import { renderFocusOnStore, spyOnAnnouncements } from "./focus-harness";

let mockHeld = new Set<string>();
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(async (tag: string) => {
    mockHeld.add(tag);
  }),
  deactivateKeepAwake: jest.fn(async (tag: string) => {
    mockHeld.delete(tag);
  }),
}));
jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  subscribeFocusResponses: jest.fn(() => () => {}),
}));
jest.mock("@/lib/daily-tasks/navigation", () => ({ navigateToToday: jest.fn() }));

const activate = activateKeepAwakeAsync as jest.Mock;
const deactivate = deactivateKeepAwake as jest.Mock;

const START = new Date(2026, 8, 26, 9, 0);
const MIN = 60_000;
const TASK: Task = { id: "t0", text: "Walk the dog", createdAt: "", carriedOver: false };

let appStateListeners: ((status: string) => void)[] = [];
const appState = (status: string) => act(async () => appStateListeners.forEach((listener) => listener(status)));
const held = () => mockHeld.has(FOCUS_KEEP_AWAKE_TAG);
const pick = (name: string) => act(async () => fireEvent.press(screen.getByRole("button", { name })));
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  mockHeld = new Set();
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (s: string) => void) => {
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((l) => l !== listener);
      },
    };
  }) as unknown as typeof AppState.addEventListener);
  spyOnAnnouncements();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("focus screen keep-awake", () => {
  it("is off with no timer; on once a timer runs, with the focus tag only", async () => {
    await renderFocusOnStore([TASK]);
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(activate).not.toHaveBeenCalled();
    await pick("10 minute timer");
    expect(held()).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate.mock.calls.every(([tag]) => tag === FOCUS_KEEP_AWAKE_TAG)).toBe(true);
    // Ticking doesn't re-take it.
    await advance(2 * MIN);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("off on pause, on again on resume; off on Stop timer", async () => {
    await renderFocusOnStore([TASK]);
    await pick("10 minute timer");
    await pick("Pause");
    expect(held()).toBe(false);
    await advance(5 * MIN);
    expect(held()).toBe(false);
    await pick("Resume");
    expect(held()).toBe(true);
    await pick("Stop timer");
    expect(held()).toBe(false);
    expect(deactivate.mock.calls.every(([tag]) => tag === FOCUS_KEEP_AWAKE_TAG)).toBe(true);
  });

  it("off at time's up (the check-in), on for 5 more minutes, off at its end and after Take a break", async () => {
    await renderFocusOnStore([TASK]);
    await pick("10 minute timer");
    await advance(10 * MIN + 100);
    expect(screen.getByTestId("focus-check-in")).toBeOnTheScreen();
    expect(held()).toBe(false);
    // 5 more minutes counts down again: on.
    await pick("5 more minutes");
    expect(held()).toBe(true);
    await advance(5 * MIN + 100);
    expect(held()).toBe(false);
    await pick("Take a break");
    expect(held()).toBe(false);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("off in the background, back on when the app returns to a running timer (not to a paused one)", async () => {
    await renderFocusOnStore([TASK]);
    await pick("10 minute timer");
    await appState("background");
    expect(held()).toBe(false);
    await appState("active");
    expect(held()).toBe(true);
    // "inactive" (a notification centre pull) isn't the background.
    await appState("inactive");
    expect(held()).toBe(true);
    await pick("Pause");
    await appState("background");
    await appState("active");
    expect(held()).toBe(false);
  });

  it("closing the screen (unmount) mid-run releases it; the session goes on", async () => {
    const { rerender } = await renderFocusOnStore([TASK]);
    await pick("10 minute timer");
    expect(held()).toBe(true);
    await act(async () => rerender({ open: false }));
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    expect(held()).toBe(false);
    await act(async () => rerender({ open: true }));
    expect(held()).toBe(true);
  });

  it("a failing native module never throws into the screen", async () => {
    activate.mockImplementationOnce(async () => {
      throw new Error("no module");
    });
    deactivate.mockImplementationOnce(() => {
      throw new Error("no module");
    });
    await renderFocusOnStore([TASK]);
    await pick("10 minute timer");
    await pick("Pause");
    expect(screen.getByTestId("focus-timer-resume")).toBeOnTheScreen();
  });
});
