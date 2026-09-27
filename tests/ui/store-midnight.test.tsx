// The real store around midnight (Phase 8): an action after the clock passes
// midnight runs the day change first (no D tasks leaking into D+1), a clock
// that moves back doesn't "roll over" into an earlier day, and the rating
// flag set by a perfect day.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { applyRollover } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";

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

const WALK: Task = { id: "t0", text: "Walk", createdAt: "2026-09-25T08:00:00.000Z", carriedOver: false };

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

async function renderOnDay(saved: Partial<AppState>, savedFor: Date) {
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

  it("ticking yesterday's task after midnight doesn't change yesterday's record", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    const { result } = await renderOnDay({ tasks: [WALK] }, new Date(2026, 8, 25, 8));

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.toggleTask("t0"));

    const state = result.current.state;
    expect(state.lastOpenedDate).toBe(NEXT);
    expect(state.history[D].completed).toBe(0);
    expect(state.history[D].tasks).toHaveLength(1);
    expect(state.pendingRollover?.tasks.map((t) => t.id)).toEqual(["t0"]);
  });

  // BUG (reported, not fixed): the tap in the test above still dispatches
  // toggleTask("t0") on the NEW day, where t0 isn't a task: todayCompletions
  // gets a phantom "t0" and the journey awards task XP for it on the new day.
  it.todo("a tap on a task that rolled over at midnight doesn't add a phantom completion or XP to the new day");

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

// BUG (reported, not fixed): in the scenario above the store's `today` is set
// from the raw clock at launch (the 25th) while the state stays on the 26th, so
// every action stamps the 25th: adding "Read" writes the 26th's list into
// history["2026-09-25"] (overwriting that day's real record), and an auto-lock
// that evening marks the 25th locked with the 26th's tasks.
describe("store: clock moved back (known bug)", () => {
  it.todo("actions after a clock moved back still go to the state's day (lastOpenedDate), not the earlier clock day");
});

describe("store: rating due", () => {
  it("marks a rating due once and clears it when the prompt is shown", async () => {
    const { result } = await renderOnDay({}, new Date());
    expect(result.current.state.reviewDueAt).toBeNull();
    await act(async () => result.current.markReviewDue());
    const due = result.current.state.reviewDueAt;
    expect(due).not.toBeNull();
    // A second perfect day doesn't push the ask further out.
    await act(async () => result.current.markReviewDue());
    expect(result.current.state.reviewDueAt).toBe(due);
    await act(async () => result.current.markReviewPrompted());
    expect(result.current.state.reviewDueAt).toBeNull();
    expect(result.current.state.lastReviewPromptAt).not.toBeNull();
  });
});
