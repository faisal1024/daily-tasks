// The real store for the daily ritual (Phase 9a): the evening close and its
// draft, using the draft in the morning, milestones ticked by hand, and
// planning counting as showing up.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { addDays } from "@/lib/daily-tasks/date";
import type { EveningClose } from "@/lib/daily-tasks/evening";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, MomentumPlan, Task } from "@/lib/daily-tasks/types";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const D = "2026-09-25";

function fakeClockAt(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
}

const task = (id: string, text: string): Task => ({ id, text, createdAt: "2026-09-25T08:00:00.000Z", carriedOver: false });

const PLAN: MomentumPlan = {
  id: "plan",
  goalTitle: "Run a 5K",
  generatedAt: "2026-09-25T08:00:00.000Z",
  provider: "template",
  milestones: [
    { id: "run_1_mile", title: "Run 1 mile", description: "", completedAt: null },
    { id: "run_3_miles", title: "Run 3 miles", description: "", completedAt: null },
  ],
  taskPool: [],
  todaySuggestions: [],
  promptSummary: "",
  version: 1,
};

const close = (overrides: Partial<EveningClose> = {}): EveningClose => ({
  note: "A good day.",
  because: "Picking up where today left off.",
  tomorrow: ["Read", "Stretch"],
  memory: null,
  source: "local",
  ...overrides,
});

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

async function renderStore(saved: Partial<AppState>, savedFor = new Date(2026, 8, 25, 8)) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(savedFor), hasSeenOnboarding: true, ...saved }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  fakeClockAt(new Date(2026, 8, 25, 20, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("store: evening close and tomorrow's draft", () => {
  it("keeps tomorrow's draft, keeps the coach memory on a local close, and updates it from the AI", async () => {
    const { result } = await renderStore({ coachMemory: "Mornings work best." });
    await act(async () => result.current.setEveningClose(close(), D, "good"));
    expect(result.current.state.eveningClose).toEqual({ date: D, result: "good", note: "A good day." });
    expect(result.current.state.tomorrowDraft).toEqual({
      forDate: addDays(D, 1),
      tasks: ["Read", "Stretch"],
      note: "A good day.",
      because: "Picking up where today left off.",
      source: "local",
    });
    expect(result.current.state.coachMemory).toBe("Mornings work best.");

    await act(async () =>
      result.current.setEveningClose(close({ memory: "Finishes short tasks.", source: "ai" }), D, "good"),
    );
    expect(result.current.state.coachMemory).toBe("Finishes short tasks.");
  });

  it("drafts for the morning after the day that was closed, even if the reply lands after midnight", async () => {
    const { result } = await renderStore({});
    // The store has moved on to the 26th by the time the close comes back.
    fakeClockAt(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.addTask("After midnight"));
    expect(result.current.today).toBe("2026-09-26");
    await act(async () => result.current.setEveningClose(close(), D, "hard"));
    expect(result.current.state.tomorrowDraft?.forDate).toBe("2026-09-26");
    expect(result.current.state.eveningClose).toMatchObject({ date: D, result: "hard" });
  });

  it("keeps a day closed with nothing drafted", async () => {
    const { result } = await renderStore({});
    await act(async () => result.current.setEveningClose(close({ tomorrow: [] }), D, "easy"));
    expect(result.current.state.tomorrowDraft).toBeNull();
    expect(result.current.state.eveningClose).toEqual({ date: D, result: "easy", note: "A good day." });
  });

  it("saves draft tasks that didn't fit for later", async () => {
    fakeClockAt(new Date(2026, 8, 26, 8, 0));
    const { result } = await renderStore(
      {
        tasks: [task("t0", "Walk"), task("t1", "Hydrate")],
        tomorrowDraft: { forDate: "2026-09-26", tasks: ["Read", "Stretch", "Call mum"], note: "", because: "", source: "local" },
      },
      new Date(2026, 8, 26, 7),
    );
    await act(async () => result.current.applyTomorrowDraft(["Read"], ["Read", "Stretch", "Call mum"]));
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk", "Hydrate", "Read"]);
    expect(result.current.state.parkedTasks.map((p) => p.text)).toEqual(["Stretch", "Call mum"]);
    expect(result.current.state.tomorrowDraft).toBeNull();
  });

  it("saves only what the card offered: tasks carried over or dropped at rollover don't come back", async () => {
    fakeClockAt(new Date(2026, 8, 26, 8, 0));
    const { result } = await renderStore(
      {
        tasks: [task("t0", "A")],
        tomorrowDraft: { forDate: "2026-09-26", tasks: ["A", "B", "C"], note: "", because: "", source: "local" },
      },
      new Date(2026, 8, 26, 7),
    );
    // A was carried over (already on the list), C was dropped: the card offered only B.
    await act(async () => result.current.applyTomorrowDraft(["B"], ["B"]));
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["A", "B"]);
    expect(result.current.state.parkedTasks).toEqual([]);
  });

  it("uses the draft in the morning: adds its tasks and clears it", async () => {
    fakeClockAt(new Date(2026, 8, 26, 8, 0));
    const { result } = await renderStore(
      { tomorrowDraft: { forDate: "2026-09-26", tasks: ["Read", "Stretch"], note: "", because: "", source: "local" } },
      new Date(2026, 8, 26, 7),
    );
    await act(async () => result.current.applyTomorrowDraft(["Read", "Stretch"], ["Read", "Stretch"]));
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Read", "Stretch"]);
    expect(result.current.state.tomorrowDraft).toBeNull();
  });

  it("drops a draft for a day that has passed at rollover, and keeps one for today", async () => {
    fakeClockAt(new Date(2026, 8, 27, 8, 0));
    const stale = await renderStore({
      tomorrowDraft: { forDate: "2026-09-26", tasks: ["Read"], note: "", because: "", source: "local" },
    });
    expect(stale.result.current.state.tomorrowDraft).toBeNull();
    stale.unmount();

    await AsyncStorage.clear();
    fakeClockAt(new Date(2026, 8, 26, 8, 0));
    const fresh = await renderStore({
      tomorrowDraft: { forDate: "2026-09-26", tasks: ["Read"], note: "", because: "", source: "local" },
    });
    expect(fresh.result.current.state.tomorrowDraft?.forDate).toBe("2026-09-26");
  });
});

describe("store: milestones and showing up", () => {
  it("a perfect day no longer ticks a milestone; the user marks it reached", async () => {
    const tasks = [task("t0", "Walk"), task("t1", "Read"), task("t2", "Stretch")];
    const { result } = await renderStore({ tasks, todayCompletions: ["t0", "t1"], momentumPlan: PLAN });
    await act(async () => result.current.toggleTask("t2"));
    expect(result.current.state.history[D].completed).toBe(3);
    expect(result.current.state.completedMilestoneIds).toEqual([]);
    expect(result.current.state.pendingMilestoneCelebration).toBeNull();

    await act(async () => result.current.completeMilestone("run_1_mile"));
    expect(result.current.state.completedMilestoneIds).toEqual(["run_1_mile"]);
    expect(result.current.state.pendingMilestoneCelebration).toBe("Run 1 mile");
    // Unknown or already-reached milestones change nothing.
    const before = result.current.state;
    await act(async () => result.current.completeMilestone("run_1_mile"));
    await act(async () => result.current.completeMilestone("nope"));
    expect(result.current.state).toBe(before);

    // A mistaken tap can be undone; undoing one that isn't reached is a no-op.
    await act(async () => result.current.uncompleteMilestone("run_1_mile"));
    expect(result.current.state.completedMilestoneIds).toEqual([]);
    const after = result.current.state;
    await act(async () => result.current.uncompleteMilestone("run_1_mile"));
    expect(result.current.state).toBe(after);
  });

  it("carrying tasks over at rollover counts as showing up", async () => {
    fakeClockAt(new Date(2026, 8, 26, 8, 0));
    const record = (id: string, text: string) => ({ id, text, completed: false, carriedOver: false, rolloverOutcome: null });
    const { result } = await renderStore({
      tasks: [task("t0", "Walk"), task("t1", "Read")],
      history: {
        [D]: { date: D, total: 2, completed: 0, locked: false, lockSource: null, tasks: [record("t0", "Walk"), record("t1", "Read")], reflection: null, reflectionResult: null },
      },
    });
    expect(result.current.state.pendingRollover?.tasks).toHaveLength(2);
    expect(result.current.state.journey.lastShowedUpDate).not.toBe("2026-09-26");
    await act(async () => result.current.resolveRollover(["t0"]));
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk"]);
    expect(result.current.state.journey.lastShowedUpDate).toBe("2026-09-26");
  });

  it("planning a task counts as showing up, and Day N counts planned days (today included)", async () => {
    const { result } = await renderStore({
      history: {
        "2026-09-20": { date: "2026-09-20", total: 2, completed: 0, locked: false, lockSource: null, tasks: [], reflection: null, reflectionResult: null },
        "2026-09-22": { date: "2026-09-22", total: 0, completed: 0, locked: false, lockSource: null, tasks: [], reflection: null, reflectionResult: null },
      },
    });
    expect(result.current.daysShowedUp).toBe(2);
    expect(result.current.state.journey.lastShowedUpDate).not.toBe(D);
    await act(async () => result.current.addTask("Walk"));
    expect(result.current.state.journey.lastShowedUpDate).toBe(D);
  });
});

describe("store: tomorrow morning's notification", () => {
  it("announces the draft without tasks finished after the close", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked module
    const Notifications = require("expo-notifications") as { scheduleNotificationAsync: jest.Mock };
    fakeClockAt(new Date(2026, 8, 25, 17, 0));
    const { result } = await renderStore({ tasks: [task("t0", "A"), task("t1", "B"), task("t2", "C")] });
    await act(async () => result.current.setEveningClose(close({ tomorrow: ["A", "B", "C"] }), D, "good"));
    await act(async () => result.current.toggleTask("t0"));

    const bodyFor = () =>
      Notifications.scheduleNotificationAsync.mock.calls
        .map(([request]) => request as { content: { title: string; body: string } })
        .filter((request) => request.content.title === "Your three for Saturday")
        .map((request) => request.content.body)
        .pop();
    await waitFor(() => expect(bodyFor()).toBe("B · C"));
  });
});

