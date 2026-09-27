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
    await act(async () => result.current.setEveningClose(close()));
    expect(result.current.state.tomorrowDraft).toEqual({
      forDate: addDays(D, 1),
      tasks: ["Read", "Stretch"],
      note: "A good day.",
      because: "Picking up where today left off.",
      source: "local",
    });
    expect(result.current.state.coachMemory).toBe("Mornings work best.");

    await act(async () => result.current.setEveningClose(close({ memory: "Finishes short tasks.", source: "ai" })));
    expect(result.current.state.coachMemory).toBe("Finishes short tasks.");
  });

  it("uses the draft in the morning: adds its tasks and clears it", async () => {
    fakeClockAt(new Date(2026, 8, 26, 8, 0));
    const { result } = await renderStore(
      { tomorrowDraft: { forDate: "2026-09-26", tasks: ["Read", "Stretch"], note: "", because: "", source: "local" } },
      new Date(2026, 8, 26, 7),
    );
    await act(async () => result.current.applyTomorrowDraft(["Read", "Stretch"]));
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
