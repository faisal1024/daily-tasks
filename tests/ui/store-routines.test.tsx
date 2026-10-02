// Routines (1.3) through the real DailyTasksProvider: adding one to today
// (and every refusal), suggestions across a day change, the free limit and a
// lapsed Plus, and that analytics never carries routine text.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { track } from "@/lib/daily-tasks/analytics";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { routinesDueToday } from "@/lib/daily-tasks/routines";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Routine, type Task } from "@/lib/daily-tasks/types";

let mockPlus: Partial<PlusContextValue>;
jest.mock("@/lib/daily-tasks/plus-context", () => ({ usePlus: () => mockPlus }));

jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const FREE: Partial<PlusContextValue> = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
  entitlementKnown: true,
};
const PLUS: Partial<PlusContextValue> = { ...FREE, entitlementActive: true };

// Thursday 1 Oct 2026 (local weekday 4); Friday is 5, Saturday 6.
const THU = "2026-10-01";
const FRI = "2026-10-02";
const SAT = "2026-10-03";

const routine = (id: string, text: string, days: number[], paused = false): Routine => ({
  id,
  text,
  days,
  paused,
  createdAt: "2026-09-30T08:00:00.000Z",
});
const WALK = routine("r1", "Walk after lunch", [4, 6]);

const task = (id: string, text: string): Task => ({
  id,
  text,
  createdAt: new Date(2026, 9, 1, 8).toISOString(),
  carriedOver: false,
});

/** Fake only the clock; real timers keep RNTL's async waits working. */
function fakeClockAt(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "queueMicrotask",
      "nextTick",
    ],
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <DailyTasksProvider>{children}</DailyTasksProvider>
);

/** A save from Thursday morning (local), auto-lock off so the lock time doesn't matter. */
async function renderStore(saved: Partial<AppState>) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 9, 1, 8)),
    hasSeenOnboarding: true,
    plusGrandfathered: false,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    ...saved,
  };
  await AsyncStorage.setItem("daily-tasks/state/v1", JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

const trackedNames = () => (track as jest.Mock).mock.calls.map(([name]) => name);
const due = (store: ReturnType<typeof useDailyTasks>) =>
  routinesDueToday(store.state.routines, store.state.tasks, store.today).map((r) => r.id);

beforeEach(async () => {
  __resetStorageForTests();
  (track as jest.Mock).mockClear();
  mockPlus = { ...FREE };
  await AsyncStorage.clear();
  fakeClockAt(new Date(2026, 9, 1, 10, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("store: addRoutineToToday", () => {
  it("adds a due routine as a task carrying its routineId; it stops being suggested", async () => {
    const { result } = await renderStore({ routines: [WALK], tasks: [task("t0", "Read")] });
    expect(result.current.today).toBe(THU);
    expect(due(result.current)).toEqual(["r1"]);

    let landed: boolean | undefined;
    await act(async () => {
      landed = result.current.addRoutineToToday("r1");
    });
    expect(landed).toBe(true);

    const added = result.current.state.tasks.find((t) => t.text === "Walk after lunch");
    expect(added).toMatchObject({ routineId: "r1", carriedOver: false });
    expect(result.current.state.tasks).toHaveLength(2);
    expect(due(result.current)).toEqual([]);
    expect(trackedNames().filter((n) => n === "routine_added_today")).toHaveLength(1);
  });

  it.each([
    ["today is set", { tasks: [task("t0", "Read")], todayLocked: true, todayLockSource: "manual" as const }, "r1"],
    ["today already has three", { tasks: [task("a", "A"), task("b", "B"), task("c", "C")] }, "r1"],
    ["the routine is paused", { routines: [routine("r1", "Walk after lunch", [4], true)] }, "r1"],
    ["it isn't due today (Friday only)", { routines: [routine("r1", "Walk after lunch", [5])] }, "r1"],
    ["it's already on today by routineId", { tasks: [{ ...task("t0", "Walk (short)"), routineId: "r1" }] }, "r1"],
    ["the same words are already on today", { tasks: [task("t0", "  WALK   after lunch ")] }, "r1"],
    ["the routine doesn't exist", {}, "nope"],
  ])("is refused when %s (no change, no analytics)", async (_label, saved, id) => {
    const { result } = await renderStore({ routines: [WALK], ...saved });
    const before = result.current.state;
    let landed: boolean | undefined;
    await act(async () => {
      landed = result.current.addRoutineToToday(id);
    });
    expect(landed).toBe(false);
    expect(result.current.state).toBe(before);
    expect(trackedNames()).not.toContain("routine_added_today");
  });

  it("follows the store's day across midnight: refused on Friday, suggested again on Saturday", async () => {
    const { result } = await renderStore({ routines: [WALK] });
    await act(async () => result.current.addRoutineToToday("r1"));
    expect(result.current.state.tasks.map((t) => t.routineId)).toEqual(["r1"]);

    // Just after midnight, before any minute tick: the action runs the day change first.
    jest.setSystemTime(new Date(2026, 9, 2, 0, 0, 10));
    await act(async () => result.current.addRoutineToToday("r1"));
    expect(result.current.today).toBe(FRI);
    expect(result.current.state.tasks).toEqual([]);
    expect(due(result.current)).toEqual([]);

    jest.setSystemTime(new Date(2026, 9, 3, 0, 0, 10));
    await act(async () => result.current.addRoutineToToday("r1"));
    expect(result.current.today).toBe(SAT);
    expect(result.current.state.tasks.map((t) => [t.text, t.routineId])).toEqual([["Walk after lunch", "r1"]]);
    expect(trackedNames().filter((n) => n === "routine_added_today")).toHaveLength(2);
  });

  it("judges the add on the new day after midnight: yesterday's copy doesn't block it", async () => {
    // Due Thursday and Friday; added Thursday, so Thursday's list has it.
    const { result } = await renderStore({ routines: [routine("r1", "Walk after lunch", [4, 5])] });
    await act(async () => result.current.addRoutineToToday("r1"));
    expect(due(result.current)).toEqual([]);

    jest.setSystemTime(new Date(2026, 9, 2, 0, 0, 10));
    let landed: boolean | undefined;
    await act(async () => {
      landed = result.current.addRoutineToToday("r1");
    });
    expect(result.current.today).toBe(FRI);
    expect(landed).toBe(true);
    expect(result.current.state.tasks.map((t) => t.routineId)).toEqual(["r1"]);
    expect(trackedNames().filter((n) => n === "routine_added_today")).toHaveLength(2);
  });
});

describe("store: the free routine limit", () => {
  it("a free user at two is refused with \"limit\" (the screen tracks routine_limit_hit)", async () => {
    const { result } = await renderStore({
      routines: [routine("r1", "Secret walk", [1]), routine("r2", "Secret read", [2])],
    });
    expect(result.current.hasPlus).toBe(false);
    expect(result.current.canAddRoutine).toBe(false);
    let outcome: string | undefined;
    await act(async () => {
      outcome = result.current.addRoutine("Private journal", [1]);
    });
    expect(outcome).toBe("limit");
    expect(result.current.state.routines).toHaveLength(2);
    expect(trackedNames()).not.toContain("routine_limit_hit");
    expect(trackedNames()).not.toContain("routine_created");
  });

  it("two adds in one render (a double tap) see each other: the second is refused, tracked once", async () => {
    const { result } = await renderStore({ routines: [routine("r1", "Walk", [1])] });
    let outcomes: string[] = [];
    await act(async () => {
      outcomes = [result.current.addRoutine("Read", [2]), result.current.addRoutine("Stretch", [3])];
    });
    expect(outcomes).toEqual(["added", "limit"]);
    expect(result.current.state.routines.map((r) => r.text)).toEqual(["Walk", "Read"]);
    expect((track as jest.Mock).mock.calls.filter(([name]) => name === "routine_created")).toEqual([
      ["routine_created", { count: 2 }],
    ]);
  });

  it("Plus: a double-tapped Save adds the routine once (\"exists\")", async () => {
    mockPlus = { ...PLUS };
    const { result } = await renderStore({});
    let outcomes: string[] = [];
    await act(async () => {
      outcomes = [result.current.addRoutine("Read", [2]), result.current.addRoutine("Read", [2])];
    });
    expect(outcomes).toEqual(["added", "exists"]);
    expect(result.current.state.routines).toHaveLength(1);
    expect(trackedNames().filter((n) => n === "routine_created")).toHaveLength(1);
  });

  it("Plus adds past two; a created routine is cleaned and logs its count, never its text", async () => {
    mockPlus = { ...PLUS };
    const { result } = await renderStore({ routines: [routine("r1", "Walk", [1]), routine("r2", "Read", [2])] });
    expect(result.current.canAddRoutine).toBe(true);
    let outcome: string | undefined;
    await act(async () => {
      outcome = result.current.addRoutine("  Private journal  ", [3, 3, 1, 9]);
    });
    expect(outcome).toBe("added");
    expect(result.current.state.routines[2]).toMatchObject({ text: "Private journal", days: [1, 3], paused: false });
    expect(track).toHaveBeenCalledWith("routine_created", { count: 3 });
  });

  it("rejects no words or no days as \"invalid\"", async () => {
    mockPlus = { ...PLUS };
    const { result } = await renderStore({});
    let outcomes: string[] = [];
    await act(async () => {
      outcomes = [result.current.addRoutine("   ", [1]), result.current.addRoutine("Walk", [7, -1])];
    });
    expect(outcomes).toEqual(["invalid", "invalid"]);
    expect(result.current.state.routines).toEqual([]);
  });

  it("after Plus lapses, three routines keep being suggested and can be edited, paused and deleted; a new one is gated", async () => {
    const { result } = await renderStore({
      routines: [routine("r1", "Walk", [4]), routine("r2", "Read", [4]), routine("r3", "Stretch", [4])],
    });
    expect(result.current.hasPlus).toBe(false);
    expect(due(result.current)).toEqual(["r1", "r2", "r3"]);

    await act(async () => result.current.updateRoutine("r3", "Stretch 5 min", [4, 5]));
    await act(async () => result.current.setRoutinePaused("r2", true));
    await act(async () => result.current.removeRoutine("r1"));
    expect(result.current.state.routines).toEqual([
      expect.objectContaining({ id: "r2", paused: true }),
      expect.objectContaining({ id: "r3", text: "Stretch 5 min", days: [4, 5] }),
    ]);
    expect(due(result.current)).toEqual(["r3"]);

    // Back to two: still at the free limit, so a new one is gated.
    let outcome: string | undefined;
    await act(async () => {
      outcome = result.current.addRoutine("New", [1]);
    });
    expect(outcome).toBe("limit");
    expect(result.current.state.routines).toHaveLength(2);
  });
});

describe("store: routine analytics", () => {
  it("no event ever carries routine text", async () => {
    mockPlus = { ...PLUS };
    const { result } = await renderStore({ routines: [routine("r1", "Secret walk", [4])] });
    await act(async () => {
      result.current.addRoutine("Secret journal", [4]);
    });
    await act(async () => result.current.addRoutineToToday("r1"));
    const serialised = JSON.stringify((track as jest.Mock).mock.calls);
    expect(trackedNames()).toEqual(expect.arrayContaining(["routine_created", "routine_added_today"]));
    expect(serialised).not.toMatch(/Secret/i);
  });
});
