// The focus session on the real store (1.3, PR #72): saved and normalized on
// load, mirrored to the App Group, its end notification scheduled /
// rescheduled / cancelled, marked ended right at its end and on coming back,
// cleared by a widget tick and at midnight, the notification's buttons
// (including the tap that launched the app), and its analytics.
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

import { track } from "@/lib/daily-tasks/analytics";
import type { FocusSession } from "@/lib/daily-tasks/focus-session";
import {
  cancelFocusTimerNotification,
  scheduleFocusSessionNotification,
  subscribeFocusResponses,
  type FocusNotificationResponse,
} from "@/lib/daily-tasks/notifications";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState as DailyState, type Task } from "@/lib/daily-tasks/types";
import { navigateToToday } from "@/lib/daily-tasks/navigation";
import { writeFocusSession } from "@/lib/daily-tasks/widget-bridge";

let mockQueue: { raw: string | null; processedSeq: number } = { raw: null, processedSeq: 0 };
jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  invalidateFocusSession: jest.fn(),
  readFocusCommands: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markFocusCommandsProcessed: jest.fn(),
  readFocusStartRequest: jest.fn(() => ({ raw: null, handledId: null })),
  markFocusStartRequestHandled: jest.fn(),
  focusSessionJson: jest.fn((session: object, rev: number) => JSON.stringify({ v: 1, rev, ...session })),
  writeWidgetSnapshot: jest.fn(),
  writeFocusSession: jest.fn(),
  invalidateWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => mockQueue),
  markWidgetTogglesProcessed: jest.fn((seq: number) => {
    mockQueue = { ...mockQueue, processedSeq: seq };
  }),
}));

let mockResponder: ((response: FocusNotificationResponse) => void) | null = null;
/** A tap that "launched the app": handed over as soon as the store subscribes. */
let mockLaunchResponse: FocusNotificationResponse | null = null;
jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  subscribeFocusResponses: jest.fn((listener: (response: FocusNotificationResponse) => void) => {
    mockResponder = listener;
    if (mockLaunchResponse) listener(mockLaunchResponse);
    return () => {
      mockResponder = null;
    };
  }),
}));

jest.mock("@/lib/daily-tasks/navigation", () => ({ navigateToToday: jest.fn() }));

jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: false, paywallEnabled: false, entitlementActive: false, entitlementKnown: true }),
}));

const schedule = scheduleFocusSessionNotification as jest.Mock;
const cancel = cancelFocusTimerNotification as jest.Mock;
const mirror = writeFocusSession as jest.Mock;
const tracked = track as jest.Mock;

const MIN = 60_000;
const START = new Date(2026, 8, 26, 9, 0);
const TODAY = "2026-09-26";
const TASKS: Task[] = ["Walk", "Read", "Stretch"].map((text, i) => ({
  id: `t${i}`,
  text,
  createdAt: new Date(2026, 8, 26, 8).toISOString(),
  carriedOver: false,
}));

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "saved",
    taskId: "t0",
    taskText: "Walk",
    stepText: null,
    date: TODAY,
    kind: "timer",
    durationMs: 10 * MIN,
    startedAt: START.getTime(),
    endAt: START.getTime() + 10 * MIN,
    pausedRemainingMs: null,
    status: "running",
    ...overrides,
  };
}

/** Capture AppState listeners (see store-widget.test.tsx). */
let appStateListeners = new Set<(state: string) => void>();
let restoreAppState: () => void = () => {};
const foreground = () => act(async () => [...appStateListeners].forEach((listener) => listener("active")));

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => {});
}

async function renderStore(
  saved: Partial<DailyState> = {},
  savedFor: Date = START,
  { keepLaunchCancel = false }: { keepLaunchCancel?: boolean } = {},
) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({
      ...buildInitialState(savedFor),
      hasSeenOnboarding: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: TASKS,
      ...saved,
    }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await flush();
  expect(hook.result.current.ready).toBe(true);
  // The launch's reconcile cancels once when there's no running session (see
  // "at launch" below); other tests count from here.
  if (!keepLaunchCancel) cancel.mockClear();
  return hook;
}

async function savedSession(): Promise<unknown> {
  const raw = await AsyncStorage.getItem("daily-tasks/state/v1");
  return raw ? JSON.parse(raw).focusSession : undefined;
}

const endedEvents = () => tracked.mock.calls.filter((call) => call[0] === "focus_session_ended");

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  __resetStorageForTests();
  mockQueue = { raw: null, processedSeq: 0 };
  mockResponder = null;
  mockLaunchResponse = null;
  jest.clearAllMocks();
  await AsyncStorage.clear();
  const addEventListener = AppState.addEventListener as unknown as jest.Mock;
  const original = addEventListener.getMockImplementation();
  appStateListeners = new Set();
  addEventListener.mockImplementation((_type: string, listener: (state: string) => void) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  });
  restoreAppState = () => addEventListener.mockImplementation(original);
});

afterEach(() => {
  restoreAppState();
  jest.useRealTimers();
});

describe("store: starting a focus session", () => {
  it("starts on an open task: saved, mirrored, its end notification scheduled, and focus_session_started tracked", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    await flush();

    const current = result.current.state.focusSession!;
    expect(current).toMatchObject({
      taskId: "t0",
      taskText: "Walk",
      date: TODAY,
      kind: "timer",
      status: "running",
      durationMs: 10 * MIN,
      endAt: START.getTime() + 10 * MIN,
    });
    expect(await savedSession()).toEqual(current);
    expect(mirror).toHaveBeenLastCalledWith(current);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith({
      sessionId: current.id,
      taskId: "t0",
      kind: "timer",
      at: new Date(START.getTime() + 10 * MIN),
      title: "Walk",
      body: "Time's up. Done, or 5 more minutes?",
    });
    expect(tracked).toHaveBeenCalledWith("focus_session_started", { kind: "timer", minutes: 10, source: "row" });
  });

  it("does nothing on a ticked task", async () => {
    const { result } = await renderStore({ todayCompletions: ["t0"] });
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    expect(result.current.state.focusSession).toBeNull();
    expect(tracked).not.toHaveBeenCalledWith("focus_session_started", expect.anything());
  });

  it("a start on another task replaces it (the old one is reported cleared)", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    const first = result.current.state.focusSession!.id;
    jest.setSystemTime(START.getTime() + 1);
    await act(async () => result.current.startFocusSession("t1", { kind: "starter", minutes: 5, source: "coach" }));
    await flush();
    expect(result.current.state.focusSession).toMatchObject({ taskId: "t1", kind: "starter", durationMs: 5 * MIN });
    expect(result.current.state.focusSession!.id).not.toBe(first);
    expect(endedEvents()).toEqual([["focus_session_ended", { outcome: "cleared", minutes: 10 }]]);
    expect(tracked).toHaveBeenCalledWith("focus_session_started", { kind: "starter", minutes: 5, source: "coach" });
  });
});

describe("store: a saved session on load", () => {
  it("keeps a valid one for today (and mirrors it) without rescheduling a new session", async () => {
    const { result } = await renderStore({ focusSession: session() });
    expect(result.current.state.focusSession).toEqual(session());
    expect(mirror).toHaveBeenLastCalledWith(session());
  });

  it("drops a malformed one (running with no end), mirroring null", async () => {
    const { result } = await renderStore({ focusSession: { ...session(), endAt: null } as FocusSession });
    expect(result.current.state.focusSession).toBeNull();
    expect(mirror).toHaveBeenLastCalledWith(null);
  });

  it("drops one from another day even when the list is today's", async () => {
    const { result } = await renderStore({ focusSession: session({ date: "2026-09-25" }) });
    expect(result.current.state.focusSession).toBeNull();
  });

  it("drops one whose task is gone", async () => {
    const { result } = await renderStore({ focusSession: session({ taskId: "gone" }) });
    expect(result.current.state.focusSession).toBeNull();
  });

  it("marks a run-out one ended on load (it went off while the app was closed)", async () => {
    jest.setSystemTime(START.getTime() + 30 * MIN);
    const { result } = await renderStore({ focusSession: session() });
    expect(result.current.state.focusSession).toMatchObject({ id: "saved", status: "ended" });
    expect(await savedSession()).toMatchObject({ status: "ended" });
  });
});

describe("store: the session's end", () => {
  it("is marked ended right at its end (not a moment before), saved and mirrored", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    await act(async () => {
      jest.advanceTimersByTime(10 * MIN - 1);
    });
    expect(result.current.state.focusSession?.status).toBe("running");
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await flush();
    expect(result.current.state.focusSession?.status).toBe("ended");
    expect(mirror).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ended" }));
    expect(await savedSession()).toMatchObject({ status: "ended" });
    // Left to go off: an ended session's notification isn't cancelled.
    expect(cancel).not.toHaveBeenCalled();
  });

  it("is marked ended on AppState active after the background (no timer ran meanwhile)", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    jest.setSystemTime(START.getTime() + 25 * MIN);
    expect(result.current.state.focusSession?.status).toBe("running");
    await foreground();
    expect(result.current.state.focusSession?.status).toBe("ended");
  });
});

describe("store: pause, resume, extend, stop and the end notification", () => {
  it("pause cancels it; resume reschedules for the new end; extend reschedules; stop cancels and clears", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    const id = result.current.state.focusSession!.id;
    expect(schedule).toHaveBeenCalledTimes(1);

    jest.setSystemTime(START.getTime() + 4 * MIN);
    await act(async () => result.current.pauseFocusSession());
    expect(result.current.state.focusSession).toMatchObject({ status: "paused", pausedRemainingMs: 6 * MIN });
    expect(cancel).toHaveBeenCalledTimes(1);

    jest.setSystemTime(START.getTime() + 30 * MIN);
    await act(async () => result.current.resumeFocusSession());
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: id, at: new Date(START.getTime() + 36 * MIN) }),
    );

    await act(async () => result.current.extendFocusSession());
    expect(schedule).toHaveBeenCalledTimes(3);
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ at: new Date(START.getTime() + 41 * MIN) }));
    expect(tracked).toHaveBeenCalledWith("focus_session_ended", { outcome: "extended", minutes: 10 });

    await act(async () => result.current.stopFocusSession("stopped"));
    await flush();
    expect(result.current.state.focusSession).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(mirror).toHaveBeenLastCalledWith(null);
    expect(await savedSession()).toBeNull();
    expect(endedEvents().at(-1)).toEqual(["focus_session_ended", { outcome: "stopped", minutes: 15 }]);
  });

  it("a starter's Keep going reschedules as a 20-minute timer and is reported extended", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "starter", minutes: 5, source: "coach" }));
    await act(async () => {
      jest.advanceTimersByTime(5 * MIN + 100);
    });
    expect(result.current.state.focusSession?.status).toBe("ended");
    await act(async () => result.current.keepGoingFocusSession());
    expect(result.current.state.focusSession).toMatchObject({ kind: "timer", durationMs: 20 * MIN, status: "running" });
    expect(schedule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        at: new Date(Date.now() + 20 * MIN),
        kind: "timer",
        title: "Walk",
        body: "Time's up. Done, or 5 more minutes?",
      }),
    );
    expect(endedEvents()).toEqual([["focus_session_ended", { outcome: "extended", minutes: 5 }]]);
  });
});

describe("store: what clears the session", () => {
  it("ticking its task in the app clears it (reported done) and cancels the notification", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    await act(async () => result.current.toggleTask("t0"));
    await flush();
    expect(result.current.state.focusSession).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(endedEvents()).toEqual([["focus_session_ended", { outcome: "done", minutes: 10 }]]);
  });

  it("a tick from the widget clears it too", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    mockQueue = { raw: JSON.stringify([{ seq: 1, id: "t0", date: TODAY, done: true }]), processedSeq: 0 };
    await foreground();
    await flush();
    expect(result.current.state.todayCompletions).toContain("t0");
    expect(result.current.state.focusSession).toBeNull();
    expect(mirror).toHaveBeenLastCalledWith(null);
    expect(endedEvents()).toEqual([["focus_session_ended", { outcome: "done", minutes: 10 }]]);
  });

  it("deleting its task clears it (reported cleared)", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    await act(async () => result.current.deleteTask("t0"));
    await flush();
    expect(result.current.state.focusSession).toBeNull();
    expect(endedEvents()).toEqual([["focus_session_ended", { outcome: "cleared", minutes: 10 }]]);
  });

  it("the day changing at midnight clears a paused one", async () => {
    jest.setSystemTime(new Date(2026, 8, 26, 23, 50));
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 60, source: "row" }));
    await act(async () => result.current.pauseFocusSession());
    jest.setSystemTime(new Date(2026, 8, 27, 0, 0, 10));
    await foreground();
    await flush();
    expect(result.current.state.lastOpenedDate).toBe("2026-09-27");
    expect(result.current.state.focusSession).toBeNull();
    expect(mirror).toHaveBeenLastCalledWith(null);
  });
});

describe("store: the end notification's buttons", () => {
  async function endedSession() {
    const hook = await renderStore();
    await act(async () => hook.result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    await act(async () => {
      jest.advanceTimersByTime(10 * MIN + 100);
    });
    return { ...hook, id: hook.result.current.state.focusSession!.id };
  }

  it("Done ticks the task the normal way (and the session goes)", async () => {
    const { result, id } = await endedSession();
    await act(async () => mockResponder!({ action: "done", sessionId: id }));
    await flush();
    expect(result.current.state.todayCompletions).toEqual(["t0"]);
    expect(result.current.state.history[TODAY]).toMatchObject({ completed: 1 });
    expect(result.current.state.focusSession).toBeNull();
    expect(tracked).toHaveBeenCalledWith("task_completed", { count: 1, source: "notification" });
  });

  it("5 more minutes extends it and reschedules", async () => {
    const { result, id } = await endedSession();
    await act(async () => mockResponder!({ action: "extend", sessionId: id }));
    expect(result.current.state.focusSession).toMatchObject({ status: "running", durationMs: 15 * MIN });
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ at: new Date(Date.now() + 5 * MIN) }));
  });

  it("a tap for an old session (another id) is ignored; a plain open changes nothing in the session", async () => {
    const { result, id } = await endedSession();
    await act(async () => mockResponder!({ action: "done", sessionId: "old" }));
    await act(async () => mockResponder!({ action: "extend", sessionId: "old" }));
    await act(async () => mockResponder!({ action: "open", sessionId: "old" }));
    expect(result.current.focusPrompt).toBeNull();
    await act(async () => mockResponder!({ action: "open", sessionId: id }));
    expect(result.current.state.todayCompletions).toEqual([]);
    expect(result.current.state.focusSession).toMatchObject({ id, status: "ended", durationMs: 10 * MIN });
  });

  it("a plain tap with the check-in due opens that session's focus screen (source notification)", async () => {
    const { result, id } = await endedSession();
    await act(async () => mockResponder!({ action: "open", sessionId: id }));
    expect(result.current.focusPrompt).toMatchObject({ taskId: "t0", source: "notification" });
  });

  // R1 (1.3 polish): a starter's notification offers Keep going (as its
  // check-in), and an old one's "5 more minutes" on a starter means the same.
  it.each(["keepGoing", "extend"] as const)(
    "a starter's %s from the notification keeps going as a 20-minute timer",
    async (action) => {
      const hook = await renderStore();
      await act(async () => hook.result.current.startFocusSession("t0", { kind: "starter", minutes: 5, source: "coach" }));
      await act(async () => {
        jest.advanceTimersByTime(5 * MIN + 100);
      });
      const id = hook.result.current.state.focusSession!.id;
      await act(async () => mockResponder!({ action, sessionId: id }));
      expect(hook.result.current.state.focusSession).toMatchObject({
        id,
        kind: "timer",
        status: "running",
        durationMs: 20 * MIN,
      });
      // Replayed, it doesn't restart the timer it became.
      await act(async () => mockResponder!({ action: "keepGoing", sessionId: id }));
      expect(hook.result.current.state.focusSession).toMatchObject({ durationMs: 20 * MIN });
    },
  );

  it("any tap on it (a button, the notification itself, an old one) goes to Today", async () => {
    const { id } = await endedSession();
    await act(async () => mockResponder!({ action: "open", sessionId: id }));
    expect(navigateToToday).toHaveBeenCalledTimes(1);
    await act(async () => mockResponder!({ action: "done", sessionId: "old" }));
    expect(navigateToToday).toHaveBeenCalledTimes(2);
  });

  it("the tap that launched the app is held until saved state loads, then handled once", async () => {
    mockLaunchResponse = { action: "done", sessionId: "saved" };
    jest.setSystemTime(START.getTime() + 20 * MIN);
    const { result } = await renderStore({ focusSession: session() });
    await flush();
    expect(subscribeFocusResponses).toHaveBeenCalledTimes(1);
    expect(result.current.state.todayCompletions).toEqual(["t0"]);
    expect(result.current.state.focusSession).toBeNull();
    const completions = tracked.mock.calls.filter((call) => call[0] === "task_completed");
    expect(completions).toEqual([["task_completed", { count: 1, source: "notification" }]]);
  });
});

describe("store: at launch (reconcile)", () => {
  it("a session cleared while loading (its task ticked in the widget) has its stale end notification cancelled", async () => {
    const { result } = await renderStore({ focusSession: session(), todayCompletions: ["t0"] }, START, {
      keepLaunchCancel: true,
    });
    expect(result.current.state.focusSession).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("a running session that ran out while the app was closed is ended at load: nothing scheduled for the past", async () => {
    const { result } = await renderStore(
      { focusSession: session({ startedAt: START.getTime() - 20 * MIN, endAt: START.getTime() - 10 * MIN }) },
      START,
      { keepLaunchCancel: true },
    );
    expect(result.current.state.focusSession).toMatchObject({ status: "ended" });
    expect(schedule).not.toHaveBeenCalled();
    // Left to go off / stay with its buttons.
    expect(cancel).not.toHaveBeenCalled();
  });

  it("one ending within a second isn't scheduled; one still running is scheduled for its end", async () => {
    await renderStore({ focusSession: session({ endAt: START.getTime() + 500 }) });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("an end further off than its length (the clock moved back) is pulled in to now + length", async () => {
    const { result } = await renderStore({ focusSession: session({ endAt: START.getTime() + 60 * MIN }) });
    expect(result.current.state.focusSession).toMatchObject({ endAt: START.getTime() + 10 * MIN });
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ at: new Date(START.getTime() + 10 * MIN) }));
  });

  it("an end past the next midnight isn't scheduled (the session clears at midnight)", async () => {
    const late = new Date(2026, 8, 26, 23, 55);
    jest.setSystemTime(late);
    await renderStore({ focusSession: session({ startedAt: late.getTime(), endAt: late.getTime() + 10 * MIN }) }, late);
    expect(schedule).not.toHaveBeenCalled();
  });
});
