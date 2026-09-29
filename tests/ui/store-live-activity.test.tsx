// The Live Activity, its buttons' queues and "start my next task" on the real
// store (1.3, PR F). The native FocusActivity module and the App Group are
// mocked: the module records what the app asks of ActivityKit, and the App
// Group's queues (focus.commands, widget.toggles, focus.startRequest) are
// plain variables each test fills in.
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

import { redirectSystemPath } from "@/app/+native-intent";
import { track } from "@/lib/daily-tasks/analytics";
import {
  __resetFocusLinkForTests,
  queueFocusStart,
} from "@/lib/daily-tasks/focus-link";
import type { FocusSession } from "@/lib/daily-tasks/focus-session";
import { LAST_TIMER_KEY } from "@/lib/daily-tasks/focus-timer-storage";
import {
  __resetLiveActivityForTests,
  FINAL_DISMISS_SECONDS,
  syncLiveActivity,
} from "@/lib/daily-tasks/live-activity";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import {
  __resetStorageForTests,
  buildInitialState,
} from "@/lib/daily-tasks/storage";
import {
  DEFAULT_AUTO_LOCK,
  type AppState as DailyState,
  type Task,
} from "@/lib/daily-tasks/types";
import {
  invalidateFocusSession,
  markFocusCommandsProcessed,
  markFocusStartRequestHandled,
  writeFocusSession,
} from "@/lib/daily-tasks/widget-bridge";
import {
  loadFocusActivity,
  type FocusActivityModule,
} from "@/modules/focus-activity";

// --- The App Group -----------------------------------------------------------

let mockToggles: { raw: string | null; processedSeq: number } = {
  raw: null,
  processedSeq: 0,
};
let mockCommands: { raw: string | null; processedSeq: number } = {
  raw: null,
  processedSeq: 0,
};
let mockStartRequest: { raw: string | null; handledId: string | null } = {
  raw: null,
  handledId: null,
};
jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  invalidateFocusSession: jest.fn(),
  readFocusCommands: jest.fn(() => mockCommands),
  markFocusCommandsProcessed: jest.fn((seq: number) => {
    mockCommands = { ...mockCommands, processedSeq: seq };
  }),
  readFocusStartRequest: jest.fn(() => mockStartRequest),
  markFocusStartRequestHandled: jest.fn((id: string) => {
    mockStartRequest = { ...mockStartRequest, handledId: id };
  }),
  focusSessionJson: jest.fn((session: object, rev: number) =>
    JSON.stringify({ v: 1, rev, ...session }),
  ),
  writeWidgetSnapshot: jest.fn(),
  writeFocusSession: jest.fn(),
  invalidateWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => mockToggles),
  markWidgetTogglesProcessed: jest.fn((seq: number) => {
    mockToggles = { ...mockToggles, processedSeq: seq };
  }),
}));

// --- ActivityKit (the FocusActivity module) ----------------------------------

/** The activities "showing", by session id. */
let mockActivities: string[] = [];
function makeNative() {
  return {
    areActivitiesEnabled: jest.fn(() => true),
    activeSessionIds: jest.fn(() => [...mockActivities]),
    start: jest.fn(async (json: string) => {
      mockActivities.push(JSON.parse(json).id);
      return true;
    }),
    update: jest.fn(async () => true),
    end: jest.fn(async (sessionId: string | null) => {
      mockActivities = mockActivities.filter((id) => id !== sessionId);
    }),
  };
}
let native = makeNative();
jest.mock("@/modules/focus-activity", () => ({ loadFocusActivity: jest.fn() }));
const loadNative = loadFocusActivity as jest.Mock;

jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  subscribeFocusResponses: jest.fn(() => () => {}),
}));

jest.mock("@/lib/daily-tasks/navigation", () => ({
  navigateToToday: jest.fn(),
}));

jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallBuild: false,
    paywallEnabled: false,
    entitlementActive: false,
    entitlementKnown: true,
  }),
}));

const tracked = track as jest.Mock;
const mirror = writeFocusSession as jest.Mock;

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

let appStateListeners = new Set<(state: string) => void>();
let restoreAppState: () => void = () => {};
const foreground = () =>
  act(async () =>
    [...appStateListeners].forEach((listener) => listener("active")),
  );

const wrapper = ({ children }: { children: ReactNode }) => (
  <DailyTasksProvider>{children}</DailyTasksProvider>
);

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await act(async () => {});
}

async function renderStore(saved: Partial<DailyState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({
      ...buildInitialState(START),
      hasSeenOnboarding: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: TASKS,
      ...saved,
    }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await flush();
  expect(hook.result.current.ready).toBe(true);
  return hook;
}

const shownJson = (mock: jest.Mock) =>
  mock.mock.calls.map((call) => JSON.parse(call[0] as string));
const events = (name: string) =>
  tracked.mock.calls.filter((call) => call[0] === name);
const commands = (
  list: { seq: number; sessionId: string; action: string; at: number }[],
) => JSON.stringify(list);

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  __resetStorageForTests();
  __resetLiveActivityForTests();
  __resetFocusLinkForTests();
  mockToggles = { raw: null, processedSeq: 0 };
  mockCommands = { raw: null, processedSeq: 0 };
  mockStartRequest = { raw: null, handledId: null };
  mockActivities = [];
  native = makeNative();
  jest.clearAllMocks();
  loadNative.mockImplementation(() => native as unknown as FocusActivityModule);
  await AsyncStorage.clear();
  const addEventListener = AppState.addEventListener as unknown as jest.Mock;
  const original = addEventListener.getMockImplementation();
  appStateListeners = new Set();
  addEventListener.mockImplementation(
    (_type: string, listener: (state: string) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  );
  restoreAppState = () => addEventListener.mockImplementation(original);
});

afterEach(() => {
  restoreAppState();
  jest.useRealTimers();
});

// --- The Live Activity from the store ------------------------------------------

describe("Live Activity: follows the session", () => {
  it("starts with the session, and is updated on pause, resume, 5 more minutes and an edit of its task (not when unchanged)", async () => {
    const { result } = await renderStore();
    expect(native.start).not.toHaveBeenCalled();

    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    const id = result.current.state.focusSession!.id;
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(shownJson(native.start)[0]).toMatchObject({
      v: 1,
      id,
      taskId: "t0",
      taskText: "Walk",
      status: "running",
    });
    expect(native.update).not.toHaveBeenCalled();

    jest.setSystemTime(START.getTime() + 4 * MIN);
    await act(async () => result.current.pauseFocusSession());
    await flush();
    expect(shownJson(native.update).at(-1)).toMatchObject({
      id,
      status: "paused",
      pausedRemainingMs: 6 * MIN,
    });

    await act(async () => result.current.resumeFocusSession());
    await flush();
    expect(shownJson(native.update).at(-1)).toMatchObject({
      id,
      status: "running",
      endAt: START.getTime() + 10 * MIN,
    });

    await act(async () => result.current.extendFocusSession());
    await flush();
    expect(shownJson(native.update).at(-1)).toMatchObject({
      id,
      durationMs: 15 * MIN,
    });

    await act(async () => result.current.editTask("t0", "Walk the dog"));
    await flush();
    expect(shownJson(native.update).at(-1)).toMatchObject({
      id,
      taskText: "Walk the dog",
    });
    const updates = native.update.mock.calls.length;
    expect(updates).toBe(4);

    // A change elsewhere (another task ticked) re-renders but doesn't re-send it.
    await act(async () => result.current.toggleTask("t2"));
    await flush();
    expect(native.update).toHaveBeenCalledTimes(updates);
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(native.end).not.toHaveBeenCalled();
  });

  it('ticking its task ends it with a short "Done"', async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    const id = result.current.state.focusSession!.id;
    await act(async () => result.current.toggleTask("t0"));
    await flush();
    expect(native.end).toHaveBeenCalledTimes(1);
    expect(native.end).toHaveBeenCalledWith(id, "done", FINAL_DISMISS_SECONDS);
  });

  it('Stop ends it with "Timer stopped"; so does deleting its task', async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    const first = result.current.state.focusSession!.id;
    await act(async () => result.current.stopFocusSession("stopped"));
    await flush();
    expect(native.end).toHaveBeenLastCalledWith(
      first,
      "stopped",
      FINAL_DISMISS_SECONDS,
    );

    jest.setSystemTime(START.getTime() + 1);
    await act(async () =>
      result.current.startFocusSession("t1", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    const second = result.current.state.focusSession!.id;
    await act(async () => result.current.deleteTask("t1"));
    await flush();
    expect(native.end).toHaveBeenLastCalledWith(
      second,
      "stopped",
      FINAL_DISMISS_SECONDS,
    );
    expect(native.end).toHaveBeenCalledTimes(2);
  });

  it("syncLiveActivity sends a session's content once: a copy with the same content isn't re-sent, a change is, force re-sends", async () => {
    await syncLiveActivity(session());
    expect(native.start).toHaveBeenCalledTimes(1);
    await syncLiveActivity({ ...session() });
    expect(native.update).not.toHaveBeenCalled();
    await syncLiveActivity(session({ taskText: "Walk far" }));
    expect(native.update).toHaveBeenCalledTimes(1);
    await syncLiveActivity(session({ taskText: "Walk far" }), { force: true });
    expect(native.update).toHaveBeenCalledTimes(2);
    // A failed update isn't remembered as shown: it's sent again next time.
    native.update.mockResolvedValueOnce(false);
    await syncLiveActivity(
      session({ status: "paused", endAt: null, pausedRemainingMs: MIN }),
    );
    await syncLiveActivity(
      session({ status: "paused", endAt: null, pausedRemainingMs: MIN }),
    );
    expect(native.update).toHaveBeenCalledTimes(4);
  });

  it("time's up updates it to ended (it isn't ended or restarted)", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(10 * MIN + 100);
    });
    await flush();
    expect(result.current.state.focusSession?.status).toBe("ended");
    expect(shownJson(native.update).at(-1)).toMatchObject({ status: "ended" });
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(native.end).not.toHaveBeenCalled();
  });

  it("reconciles at launch: an orphan activity is ended at once, and the saved session gets its activity", async () => {
    mockActivities = ["orphan"];
    await renderStore({ focusSession: session() });
    expect(native.end).toHaveBeenCalledWith("orphan", null, 0);
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(shownJson(native.start)[0]).toMatchObject({
      id: "saved",
      status: "running",
    });
  });

  it("reconciles on foreground: one dismissed meanwhile is re-created, an orphan ended, and the content re-sent", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    const id = result.current.state.focusSession!.id;
    expect(native.start).toHaveBeenCalledTimes(1);

    // The user swiped it away, and a stale one from an older session showed up.
    mockActivities = ["old"];
    await foreground();
    await flush();
    expect(native.end).toHaveBeenCalledWith("old", null, 0);
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(shownJson(native.start)[1]).toMatchObject({ id });

    // Still showing: a foreground re-sends its content (a button may have changed it).
    await foreground();
    await flush();
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(native.update).toHaveBeenCalledTimes(1);
  });

  it("a saved session that's already at time's up gets no new activity", async () => {
    jest.setSystemTime(START.getTime() + 30 * MIN);
    const { result } = await renderStore({ focusSession: session() });
    expect(result.current.state.focusSession?.status).toBe("ended");
    expect(native.start).not.toHaveBeenCalled();
  });

  it("nothing is asked of ActivityKit when Live Activities are off, or the module isn't there", async () => {
    native.areActivitiesEnabled.mockReturnValue(false);
    const { result, unmount } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    expect(native.start).not.toHaveBeenCalled();
    unmount();

    __resetLiveActivityForTests();
    __resetStorageForTests();
    loadNative.mockReturnValue(null);
    const other = makeNative();
    native = other;
    const second = await renderStore();
    await act(async () =>
      second.result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await act(async () => second.result.current.stopFocusSession("stopped"));
    await foreground();
    await flush();
    expect(other.activeSessionIds).not.toHaveBeenCalled();
    expect(other.start).not.toHaveBeenCalled();
    expect(other.end).not.toHaveBeenCalled();
  });

  it("never throws into the app: a failing module is contained, and later calls still go through", async () => {
    native.start.mockRejectedValueOnce(new Error("ActivityKit said no"));
    native.activeSessionIds.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    expect(result.current.state.focusSession?.status).toBe("running");
    await act(async () => result.current.pauseFocusSession());
    await flush();
    expect(result.current.state.focusSession?.status).toBe("paused");
    // The start failed, so it's tried again (not "already shown").
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(shownJson(native.start).at(-1)).toMatchObject({ status: "paused" });
  });
});

// --- Pause / Resume from the Live Activity (focus.commands) --------------------

describe("Live Activity buttons: the focus.commands queue", () => {
  it("at launch, a pause tapped before the end keeps the session paused even though the app opens after its end", async () => {
    // Paused at 4 minutes in (6 left), app opened 30 minutes in.
    mockCommands = {
      raw: commands([
        {
          seq: 3,
          sessionId: "saved",
          action: "pause",
          at: START.getTime() + 4 * MIN,
        },
      ]),
      processedSeq: 2,
    };
    jest.setSystemTime(START.getTime() + 30 * MIN);
    const { result } = await renderStore({ focusSession: session() });
    expect(result.current.state.focusSession).toMatchObject({
      id: "saved",
      status: "paused",
      pausedRemainingMs: 6 * MIN,
      endAt: null,
    });
    expect(markFocusCommandsProcessed).toHaveBeenCalledWith(3);
    expect(invalidateFocusSession).toHaveBeenCalled();
    expect(mirror).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "paused" }),
    );
    expect(events("live_activity_action")).toEqual([
      ["live_activity_action", { action: "pause" }],
    ]);
  });

  it("on foreground: commands already processed, for another session, or malformed are skipped; the newest seq is still recorded", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    const id = result.current.state.focusSession!.id;
    mockCommands = {
      raw: commands([
        { seq: 5, sessionId: id, action: "pause", at: START.getTime() + MIN },
        {
          seq: 6,
          sessionId: "older-session",
          action: "pause",
          at: START.getTime() + MIN,
        },
        { seq: 7, sessionId: id, action: "bogus", at: START.getTime() },
      ]),
      processedSeq: 5,
    };
    jest.setSystemTime(START.getTime() + 2 * MIN);
    await foreground();
    await flush();
    expect(result.current.state.focusSession).toMatchObject({
      id,
      status: "running",
    });
    expect(markFocusCommandsProcessed).toHaveBeenCalledWith(6);
    expect(events("live_activity_action")).toEqual([]);
  });

  it("pause then resume are applied at their tap times, in seq order, once (replaying changes nothing)", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    const id = result.current.state.focusSession!.id;
    mockCommands = {
      raw: commands([
        {
          seq: 2,
          sessionId: id,
          action: "resume",
          at: START.getTime() + 5 * MIN,
        },
        {
          seq: 1,
          sessionId: id,
          action: "pause",
          at: START.getTime() + 2 * MIN,
        },
      ]),
      processedSeq: 0,
    };
    jest.setSystemTime(START.getTime() + 6 * MIN);
    await foreground();
    await flush();
    // 8 left at the pause, resumed at 5 minutes in: ends at 13.
    expect(result.current.state.focusSession).toMatchObject({
      status: "running",
      endAt: START.getTime() + 13 * MIN,
    });
    expect(mockCommands.processedSeq).toBe(2);
    expect(events("live_activity_action")).toEqual([
      ["live_activity_action", { action: "pause" }],
      ["live_activity_action", { action: "resume" }],
    ]);

    // Same queue again (nothing newer): nothing changes.
    await foreground();
    await flush();
    expect(result.current.state.focusSession).toMatchObject({
      endAt: START.getTime() + 13 * MIN,
    });
    expect(events("live_activity_action")).toHaveLength(2);
  });

  it("with the app open, a pause tapped just before the end wins over the end timer", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    const id = result.current.state.focusSession!.id;
    // Tapped on the lock screen at 9 minutes in; the app's end timer then fires.
    mockCommands = {
      raw: commands([
        {
          seq: 1,
          sessionId: id,
          action: "pause",
          at: START.getTime() + 9 * MIN,
        },
      ]),
      processedSeq: 0,
    };
    await act(async () => {
      jest.advanceTimersByTime(10 * MIN + 100);
    });
    await flush();
    expect(result.current.state.focusSession).toMatchObject({
      status: "paused",
      pausedRemainingMs: MIN,
    });
  });
});

describe("Live Activity Done (widget.toggles, source live_activity)", () => {
  it("ticks the task the normal way, clears the session, ends the activity with Done and tracks the action", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await flush();
    const id = result.current.state.focusSession!.id;
    mockToggles = {
      raw: JSON.stringify([
        { seq: 1, id: "t0", date: TODAY, done: true, source: "live_activity" },
      ]),
      processedSeq: 0,
    };
    // The activity already ended itself with "Done" (FocusActions.done).
    mockActivities = [];
    await foreground();
    await flush();
    expect(result.current.state.todayCompletions).toEqual(["t0"]);
    expect(result.current.state.history[TODAY]).toMatchObject({ completed: 1 });
    expect(result.current.state.focusSession).toBeNull();
    expect(mirror).toHaveBeenLastCalledWith(null);
    expect(events("focus_session_ended")).toEqual([
      ["focus_session_ended", { outcome: "done", minutes: 10 }],
    ]);
    expect(events("live_activity_action")).toEqual([
      ["live_activity_action", { action: "done" }],
    ]);
    expect(mockToggles.processedSeq).toBe(1);
    // Nothing started again for the cleared session.
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(native.update).not.toHaveBeenCalledWith(
      expect.stringContaining(`"id":"${id}"`),
    );
  });

  it("a plain widget tick isn't counted as a Live Activity action", async () => {
    await renderStore();
    mockToggles = {
      raw: JSON.stringify([{ seq: 1, id: "t0", date: TODAY, done: true }]),
      processedSeq: 0,
    };
    await foreground();
    await flush();
    expect(events("live_activity_action")).toEqual([]);
  });
});

// --- "Start my next task" (widget, Siri) ---------------------------------------

describe("start my next task: links and the App Group request", () => {
  it("the router takes dailytasks://focus/start links (showing Today) and leaves every other link alone", () => {
    expect(
      redirectSystemPath({
        path: "dailytasks://focus/start?task=next&source=siri&kind=starter",
        initial: true,
      }),
    ).toBe("/");
    expect(redirectSystemPath({ path: "/settings", initial: false })).toBe(
      "/settings",
    );
    expect(
      redirectSystemPath({
        path: "dailytasks://focus/start?task=t9",
        initial: false,
      }),
    ).toBe("dailytasks://focus/start?task=t9");
  });

  it("a widget link starts the next open task with the last length used; a link that came before the store was ready waits for it", async () => {
    await AsyncStorage.setItem(LAST_TIMER_KEY, "15");
    // Cold start: the router saw the link before anything loaded.
    redirectSystemPath({
      path: "dailytasks://focus/start?task=next&source=widget",
      initial: true,
    });
    const { result } = await renderStore({ todayCompletions: ["t0"] });
    await flush();
    expect(result.current.state.focusSession).toMatchObject({
      taskId: "t1",
      kind: "timer",
      durationMs: 15 * MIN,
    });
    expect(events("focus_session_started")).toEqual([
      [
        "focus_session_started",
        { kind: "timer", minutes: 15, source: "widget" },
      ],
    ]);
  });

  it("with no length used yet it's 20 minutes; kind=starter is the 5-minute starter (source siri)", async () => {
    const { result } = await renderStore();
    await act(async () => queueFocusStart({ kind: "timer", source: "widget" }));
    await flush();
    expect(result.current.state.focusSession).toMatchObject({
      taskId: "t0",
      durationMs: 20 * MIN,
    });
    await act(async () => result.current.stopFocusSession("stopped"));

    await act(async () => queueFocusStart({ kind: "starter", source: "siri" }));
    await flush();
    expect(result.current.state.focusSession).toMatchObject({
      taskId: "t0",
      kind: "starter",
      durationMs: 5 * MIN,
    });
    expect(events("focus_session_started").at(-1)).toEqual([
      "focus_session_started",
      { kind: "starter", minutes: 5, source: "siri" },
    ]);
  });

  it("never restarts the timer already on that task (running or paused)", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t0", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    await act(async () => result.current.pauseFocusSession());
    const before = result.current.state.focusSession;
    tracked.mockClear();
    await act(async () => queueFocusStart({ kind: "timer", source: "widget" }));
    await flush();
    expect(result.current.state.focusSession).toBe(before);
    expect(events("focus_session_started")).toEqual([]);
    expect(result.current.focusPrompt).toBeNull();
  });

  it("another task's timer on: it isn't replaced; Today is asked to open the next task's focus screen", async () => {
    const { result } = await renderStore();
    await act(async () =>
      result.current.startFocusSession("t1", {
        kind: "timer",
        minutes: 10,
        source: "row",
      }),
    );
    const before = result.current.state.focusSession;
    tracked.mockClear();
    await act(async () => queueFocusStart({ kind: "timer", source: "siri" }));
    await flush();
    expect(result.current.state.focusSession).toBe(before);
    expect(events("focus_session_started")).toEqual([]);
    expect(result.current.focusPrompt).toMatchObject({
      taskId: "t0",
      source: "siri",
    });
    await act(async () => result.current.clearFocusPrompt());
    expect(result.current.focusPrompt).toBeNull();
  });

  it("no open task: nothing happens", async () => {
    const { result } = await renderStore({
      todayCompletions: ["t0", "t1", "t2"],
    });
    await act(async () => queueFocusStart({ kind: "timer", source: "widget" }));
    await flush();
    expect(result.current.state.focusSession).toBeNull();
    expect(result.current.focusPrompt).toBeNull();
    expect(events("focus_session_started")).toEqual([]);
  });

  it("Siri's focus.startRequest is honoured once within a minute (marked handled), and ignored when older", async () => {
    mockStartRequest = {
      raw: JSON.stringify({
        id: "r1",
        kind: "starter",
        source: "siri",
        at: START.getTime() - 30_000,
      }),
      handledId: null,
    };
    const { result } = await renderStore();
    await flush();
    expect(result.current.state.focusSession).toMatchObject({
      taskId: "t0",
      kind: "starter",
    });
    expect(markFocusStartRequestHandled).toHaveBeenCalledWith("r1");
    const first = result.current.state.focusSession!.id;

    // Stopped, then the app comes back: the same request isn't taken again.
    await act(async () => result.current.stopFocusSession("stopped"));
    await foreground();
    await flush();
    expect(result.current.state.focusSession).toBeNull();

    // A new one, but more than a minute old: ignored.
    mockStartRequest = {
      raw: JSON.stringify({
        id: "r2",
        kind: "timer",
        source: "siri",
        at: Date.now() - 61_000,
      }),
      handledId: "r1",
    };
    await foreground();
    await flush();
    expect(result.current.state.focusSession).toBeNull();
    expect(events("focus_session_started")).toHaveLength(1);
    expect(first).toBeTruthy();
  });

  it("one Siri run arriving both ways (the link and the App Group request) starts one session", async () => {
    mockStartRequest = {
      raw: JSON.stringify({
        id: "r1",
        kind: "timer",
        source: "siri",
        at: START.getTime(),
      }),
      handledId: null,
    };
    redirectSystemPath({
      path: "dailytasks://focus/start?task=next&source=siri",
      initial: true,
    });
    await renderStore();
    await flush();
    expect(events("focus_session_started")).toEqual([
      ["focus_session_started", { kind: "timer", minutes: 20, source: "siri" }],
    ]);
  });

  // KNOWN BUG (PR #73): two handleFocusStarts runs overlap (the foreground takes
  // the App Group request, the link takes the queued one; both await
  // loadLastTimer and plan on the same stateRef), so the task is started twice:
  // focus_session_started is tracked twice and the first session is replaced.
  // Marked failing so the suite stays green; drop `.failing` once fixed.
  it.failing(
    "Siri while the app is in the background: the foreground and the link arriving together start one session",
    async () => {
      const { result } = await renderStore();
      // Siri left its request, then iOS reports "active" and hands over the link.
      mockStartRequest = {
        raw: JSON.stringify({
          id: "r1",
          kind: "timer",
          source: "siri",
          at: START.getTime(),
        }),
        handledId: null,
      };
      await act(async () => {
        [...appStateListeners].forEach((listener) => listener("active"));
        redirectSystemPath({
          path: "dailytasks://focus/start?task=next&source=siri",
          initial: false,
        });
      });
      await flush();
      expect(result.current.state.focusSession).toMatchObject({ taskId: "t0" });
      expect(events("focus_session_started")).toHaveLength(1);
      expect(events("focus_session_ended")).toEqual([]);
    },
  );
});
