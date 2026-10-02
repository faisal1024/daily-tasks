// The real store around midnight (Phase 8): an action after the clock passes
// midnight runs the day change first (no D tasks leaking into D+1), a clock
// that moves back doesn't "roll over" into an earlier day, and the rating
// flag set by a perfect day.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { applyRollover, syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Task } from "@/lib/daily-tasks/types";

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
const NEXT = "2026-09-26";

// Local time (08:00 on D), not a UTC literal: day keys are local.
const WALK: Task = { id: "t0", text: "Walk", createdAt: new Date(2026, 8, 25, 8).toISOString(), carriedOver: false };

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

/**
 * Save a state the app could have written: today's history record mirrors the
 * live list (every task change goes through syncTodayHistory). Auto-lock is
 * off so these midnight tests don't depend on the lock time (or timezone);
 * pass `autoLock` to opt in.
 */
async function renderOnDay(saved: Partial<AppState>, savedFor: Date) {
  const state: AppState = {
    ...buildInitialState(savedFor),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    ...saved,
  };
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("store: actions just after midnight", () => {
  it("adding a task at 00:00:10 (before the minute tick) runs the day change first", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 25, 8));
    expect(result.current.today).toBe(D);

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.addTask("Read"));

    const state = result.current.state;
    expect(result.current.today).toBe(NEXT);
    expect(state.lastOpenedDate).toBe(NEXT);
    // Yesterday keeps its own list; the new task is today's only.
    expect(state.history[D].tasks.map((t) => t.text)).toEqual(["Walk"]);
    expect(state.tasks.map((t) => t.text)).toEqual(["Read"]);
    expect(state.history[NEXT].tasks.map((t) => t.text)).toEqual(["Read"]);
    // Walk waits in the rollover once, not duplicated.
    expect(state.pendingRollover?.tasks.map((t) => t.text)).toEqual(["Walk"]);
  });

  it("adding a task at 00:00:10 on a set (auto-locked) day lands on the new, unlocked day", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    const { result } = await renderOnDay(
      { tasks: [WALK], todayLocked: true, todayLockSource: "auto" },
      new Date(2026, 8, 25, 8),
    );

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.addTask("Read"));

    const state = result.current.state;
    expect(state.lastOpenedDate).toBe(NEXT);
    // Yesterday stays set; the add isn't swallowed by yesterday's lock.
    expect(state.history[D]).toMatchObject({ locked: true, lockSource: "auto" });
    expect(state.todayLocked).toBe(false);
    expect(state.tasks.map((t) => t.text)).toEqual(["Read"]);
  });

  it("repairs a saved day whose history drifted from its list, so the rollover archives the real list", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    // An old build's save: Walk is on the list but the day's record is empty.
    await AsyncStorage.setItem(
      "daily-tasks/state/v1",
      JSON.stringify({
        ...buildInitialState(new Date(2026, 8, 25, 8)),
        hasSeenOnboarding: true,
        autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
        tasks: [WALK],
      }),
    );
    const { result } = await renderHook(() => useDailyTasks(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.state.history[D].tasks.map((t) => t.text)).toEqual(["Walk"]);

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.addTask("Read"));
    expect(result.current.state.lastOpenedDate).toBe(NEXT);
    expect(result.current.state.history[D].tasks.map((t) => t.text)).toEqual(["Walk"]);
  });

  it("a tick just after midnight counts for the day on screen, then the day changes", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 25, 8));

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.toggleTask("t0"));

    const state = result.current.state;
    expect(result.current.today).toBe(NEXT);
    expect(state.lastOpenedDate).toBe(NEXT);
    expect(state.history[D]).toMatchObject({ total: 1, completed: 1 });
    // Done on D, so nothing to carry over; nothing lands on the new day.
    expect(state.pendingRollover).toBeNull();
    expect(state.todayCompletions).toEqual([]);
    expect(state.journey.awardDate).toBe(D);
    expect(state.journey.awardedTaskIds).toEqual(["t0"]);
  });

  it.each([
    ["result", (store: ReturnType<typeof useDailyTasks>) => store.setTodayReflectionResult("good")],
    ["note", (store: ReturnType<typeof useDailyTasks>) => store.setTodayReflection("Felt good")],
  ] as const)("an evening check-in %s saved at 00:00:10 lands on the day on screen", async (kind, save) => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    const { result } = await renderOnDay({ tasks: [WALK], todayCompletions: ["t0"] }, new Date(2026, 8, 25, 8));

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => save(result.current));

    const state = result.current.state;
    expect(state.lastOpenedDate).toBe(NEXT);
    if (kind === "result") {
      expect(state.history[D].reflectionResult).toBe("good");
      expect(state.history[NEXT].reflectionResult).toBeNull();
      expect(state.todayReflectionResult).toBeNull();
    } else {
      expect(state.history[D].reflection).toBe("Felt good");
      expect(state.history[NEXT].reflection).toBeNull();
      expect(state.todayReflection).toBeNull();
    }
  });

  it("ignores step changes for a task that isn't on today's list", async () => {
    fakeClockAt(new Date(2026, 8, 25, 10, 0));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 25, 8));
    const before = result.current.state;
    await act(async () => result.current.setTaskSteps("not-a-task", ["One", "Two"]));
    await act(async () => result.current.toggleTaskStep("not-a-task", "s1"));
    await act(async () => result.current.clearTaskSteps("not-a-task"));
    expect(result.current.state).toBe(before);
  });

  it("ignores a toggle, edit or delete for a task that isn't on today's list (no phantom completion or XP)", async () => {
    fakeClockAt(new Date(2026, 8, 25, 10, 0));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 25, 8));
    const before = result.current.state;
    await act(async () => result.current.toggleTask("not-a-task"));
    await act(async () => result.current.editTask("not-a-task", "Renamed"));
    await act(async () => result.current.deleteTask("not-a-task"));
    const after = result.current.state;
    expect(after.todayCompletions).toEqual([]);
    expect(after.journey).toEqual(before.journey);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.history[D]).toEqual(before.history[D]);
  });

  it("a clock that moved back doesn't roll over into the earlier day", async () => {
    // Saved on the 26th; the clock now reads the 25th (travel west / manual change).
    fakeClockAt(new Date(2026, 8, 25, 10, 0));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 26, 9));
    expect(result.current.state.lastOpenedDate).toBe(NEXT);
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk"]);
    expect(result.current.state.pendingRollover).toBeNull();

    expect(result.current.state.history[D]).toBeUndefined();

    const state = buildInitialState(new Date(2026, 8, 26, 9));
    expect(applyRollover(state, D)).toBe(state);
  });
});

describe("store: clock behind the saved day", () => {
  it("one day behind (flying west over midnight): stays on the saved day and writes to it", async () => {
    fakeClockAt(new Date(2026, 8, 25, 10, 0));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 26, 9));
    expect(result.current.today).toBe(NEXT);
    await act(async () => result.current.toggleTask("t0"));
    await act(async () => result.current.addTask("Read"));
    const state = result.current.state;
    expect(state.history[NEXT]).toMatchObject({ total: 2, completed: 1 });
    expect(state.history[NEXT].tasks.map((t) => t.text)).toEqual(["Walk", "Read"]);
    expect(state.history[D]).toBeUndefined();
    expect(state.journey.awardDate).toBe(NEXT);
  });

  it("three days behind (a date fixed after being wrong): follows the clock", async () => {
    fakeClockAt(new Date(2026, 8, 23, 10, 0));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 26, 9));
    expect(result.current.today).toBe("2026-09-23");
    expect(result.current.state.lastOpenedDate).toBe("2026-09-23");
    expect(result.current.state.tasks).toEqual([]);
  });
});

describe("store: rating due", () => {
  it("marks a rating due once and clears it when the prompt is shown", async () => {
    const { result } = await renderOnDay({}, new Date());
    expect(result.current.state.reviewDueAt).toBeNull();
    await act(async () => result.current.markReviewDue("perfect_day"));
    const due = result.current.state.reviewDueAt;
    expect(due).not.toBeNull();
    // A second perfect day doesn't push the ask further out.
    await act(async () => result.current.markReviewDue("perfect_day"));
    expect(result.current.state.reviewDueAt).toBe(due);
    await act(async () => result.current.markReviewPrompted());
    expect(result.current.state.reviewDueAt).toBeNull();
    expect(result.current.state.lastReviewPromptAt).not.toBeNull();
  });
});

describe("store: an ask that was never shown (PR #78 review)", () => {
  it("an expired or corrupt ask is replaced by the next happy moment, and can be cleared", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { result } = await renderOnDay({ reviewDueAt: eightDaysAgo, reviewDueSource: "perfect_day" }, new Date());
    await act(async () => result.current.markReviewDue("milestone"));
    expect(result.current.state.reviewDueAt).not.toBe(eightDaysAgo);
    expect(Date.now() - Date.parse(result.current.state.reviewDueAt!)).toBeLessThan(60_000);
    expect(result.current.state.reviewDueSource).toBe("milestone");

    await act(async () => result.current.clearReviewDue());
    expect(result.current.state.reviewDueAt).toBeNull();
    expect(result.current.state.reviewDueSource).toBeNull();
  });

  it("a corrupt saved ask doesn't block a new one", async () => {
    const { result } = await renderOnDay({ reviewDueAt: "garbage", reviewDueSource: "perfect_day" }, new Date());
    await act(async () => result.current.markReviewDue("good_week"));
    expect(Number.isNaN(Date.parse(result.current.state.reviewDueAt!))).toBe(false);
    expect(result.current.state.reviewDueSource).toBe("good_week");
  });
});

describe("store: the rating ask's source (1.3)", () => {
  it("keeps the first happy moment's source, saves it, and clears it with the ask", async () => {
    const { result } = await renderOnDay({}, new Date());
    await act(async () => result.current.markReviewDue("milestone"));
    await act(async () => result.current.markReviewDue("good_week"));
    expect(result.current.state.reviewDueSource).toBe("milestone");
    await act(async () => result.current.markReviewPrompted());
    expect(result.current.state.reviewDueAt).toBeNull();
    expect(result.current.state.reviewDueSource).toBeNull();
  });
});

describe("store: the Coach's note cache over midnight (1.2)", () => {
  it("the day change drops yesterday's coachNotes, and a late reply or mark for yesterday doesn't recreate them", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    const lines = { start: "Open it.", momentum: "Keep going." };
    const { result } = await renderOnDay(
      { tasks: [WALK], coachNotes: { date: D, notes: { walk: lines }, requests: 2, asked: ["walk"], logged: true } },
      new Date(2026, 8, 25, 8),
    );
    expect(result.current.state.coachNotes?.date).toBe(D);

    // The call made for D answers just after midnight: the rollover runs first,
    // and the reply (and the analytics mark) for D are dropped.
    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.setCoachNotes(D, { walk: lines }));
    expect(result.current.today).toBe(NEXT);
    expect(result.current.state.coachNotes).toBeNull();
    await act(async () => result.current.markCoachNoteLogged(D));
    expect(result.current.state.coachNotes).toBeNull();

    // Today's own claim starts a fresh cache with today's count.
    await act(async () => result.current.claimCoachRequest(["Walk"]));
    expect(result.current.state.coachNotes).toEqual({ date: NEXT, notes: {}, requests: 1, asked: ["walk"], logged: false });
  });
});
