// Reordering on the real store (1.4, PR #90): moveTask / makeTaskNext follow
// the ordering rule, do nothing (the same state object) when there's nothing
// to move, work on a set day without touching the plan, leave the focus
// session on its task, and everything that says "next" follows the new order.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

import { planFocusStart } from "@/lib/daily-tasks/focus-link";
import { nextOpenTask } from "@/lib/daily-tasks/coach-note";
import { scheduleFocusSessionNotification } from "@/lib/daily-tasks/notifications";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState as DailyState, type Task } from "@/lib/daily-tasks/types";
import { writeFocusSession, writeWidgetSnapshot } from "@/lib/daily-tasks/widget-bridge";
import type { WidgetSnapshot } from "@/lib/daily-tasks/widget-snapshot";

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
  readWidgetToggles: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markWidgetTogglesProcessed: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  registerNagCategory: jest.fn(async () => {}),
  subscribeNagResponses: jest.fn(() => () => {}),
  subscribeFocusResponses: jest.fn(() => () => {}),
}));
jest.mock("@/lib/daily-tasks/navigation", () => ({ navigateToToday: jest.fn() }));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: false, paywallEnabled: false, entitlementActive: false, entitlementKnown: true }),
}));

const MIN = 60_000;
// Local time, mid-morning: nowhere near midnight in any timezone.
const START = new Date(2026, 9, 10, 9, 0);
const TODAY = "2026-10-10";
const KEY = "daily-tasks/state/v1";

const task = (id: string, text: string, extra: Partial<Task> = {}): Task => ({
  id,
  text,
  createdAt: new Date(2026, 9, 10, 8).toISOString(),
  carriedOver: false,
  ...extra,
});
const A = task("a", "Alpha");
const B = task("b", "Bravo");
const C = task("c", "Charlie");

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => {});
}

async function renderStore(saved: Partial<DailyState> = {}) {
  const state: DailyState = {
    ...buildInitialState(START),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks: [A, B, C],
    ...saved,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, TODAY)));
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await flush();
  expect(hook.result.current.ready).toBe(true);
  return hook;
}

type Store = { current: ReturnType<typeof useDailyTasks> };
/** "a b✓ c": today's order, with done tasks marked. */
const order = (result: Store) =>
  result.current.state.tasks
    .map((item) => (result.current.state.todayCompletions.includes(item.id) ? `${item.id}✓` : item.id))
    .join(" ");
const savedState = async (): Promise<DailyState> => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}");
const lastSnapshot = (): WidgetSnapshot => {
  const calls = (writeWidgetSnapshot as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
};

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  __resetStorageForTests();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("store: the ordering rule", () => {
  // docs/2026-10-v1.4.md, "The ordering rule", example table.
  it.each([
    { done: [] as string[], after: "c a b" },
    { done: ["b"], after: "c b✓ a" },
    { done: ["a"], after: "a✓ c b" },
  ])("makeTaskNext(c) with $done done gives $after, and it is saved", async ({ done, after }) => {
    const { result } = await renderStore({ todayCompletions: done });
    await act(async () => result.current.makeTaskNext("c"));
    await flush();
    expect(order(result)).toBe(after);
    const saved = await savedState();
    expect(saved.tasks.map((item) => item.id).join(" ")).toBe(after.replace(/✓/g, ""));
    expect(saved.todayCompletions).toEqual(done);
  });

  it("moveTask counts open tasks only and clamps its index", async () => {
    const { result } = await renderStore({ todayCompletions: ["b"] });
    // Open index 1 is the last open task: slot 3, past the done one.
    await act(async () => result.current.moveTask("a", 1));
    expect(order(result)).toBe("c b✓ a");
    await act(async () => result.current.moveTask("a", -4));
    expect(order(result)).toBe("a b✓ c");
    await act(async () => result.current.moveTask("a", 400));
    expect(order(result)).toBe("c b✓ a");
  });

  it("a move with nothing to do gives back the very same state (nothing re-saved or re-drawn)", async () => {
    const { result } = await renderStore({ todayCompletions: ["b"] });
    const before = result.current.state;
    const snapshots = (writeWidgetSnapshot as jest.Mock).mock.calls.length;
    const noOps: (() => void)[] = [
      () => result.current.makeTaskNext("a"), // already next
      () => result.current.moveTask("a", 0),
      () => result.current.moveTask("c", 1), // already last
      () => result.current.moveTask("c", 99), // clamped to where it is
      () => result.current.moveTask("a", -1),
      () => result.current.makeTaskNext("b"), // done
      () => result.current.moveTask("b", 1),
      () => result.current.makeTaskNext("nope"), // not on the list
      () => result.current.moveTask("c", Number.NaN),
      () => result.current.moveTask("c", Number.POSITIVE_INFINITY),
    ];
    for (const noOp of noOps) {
      await act(async () => noOp());
      expect(result.current.state).toBe(before);
    }
    await flush();
    expect((writeWidgetSnapshot as jest.Mock).mock.calls.length).toBe(snapshots);
  });

  it("with one open task there is nothing to move", async () => {
    const { result } = await renderStore({ todayCompletions: ["a", "b"] });
    const before = result.current.state;
    await act(async () => result.current.makeTaskNext("c"));
    await act(async () => result.current.moveTask("c", 0));
    expect(result.current.state).toBe(before);
  });
});

describe("store: reordering on a set day", () => {
  it("changes the order and nothing else: the lock, completions, steps and carried-over marks stay", async () => {
    const lockedAt = new Date(2026, 9, 10, 8, 30).toISOString();
    const steps = [
      { id: "s1", text: "Find shoes", done: true },
      { id: "s2", text: "Out the door", done: false },
    ];
    const { result } = await renderStore({
      tasks: [task("a", "Alpha", { carriedOver: true }), B, task("c", "Charlie", { steps, routineId: "r1" })],
      todayCompletions: ["b"],
      todayLocked: true,
      todayLockSource: "manual",
      todayLockedAt: lockedAt,
    });
    const before = result.current.state;
    expect(before.todayLocked).toBe(true);

    await act(async () => result.current.makeTaskNext("c"));
    await flush();
    const after = result.current.state;
    expect(order(result)).toBe("c b✓ a");

    // Everything but the order (and today's record of it) is untouched.
    const { tasks: tasksBefore, history: historyBefore, ...restBefore } = before;
    const { tasks: tasksAfter, history: historyAfter, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(after.todayLocked).toBe(true);
    expect(after.todayLockSource).toBe("manual");
    expect(after.todayLockedAt).toBe(lockedAt);
    expect(after.todayCompletions).toBe(before.todayCompletions);
    // The very same task objects, only in other slots.
    expect(tasksAfter[0]).toBe(tasksBefore[2]);
    expect(tasksAfter[1]).toBe(tasksBefore[1]);
    expect(tasksAfter[2]).toBe(tasksBefore[0]);
    expect(tasksAfter[0].steps).toEqual(steps);
    expect(tasksAfter[0].routineId).toBe("r1");
    expect(tasksAfter[2].carriedOver).toBe(true);

    // Today's history record is rewritten in the new order; other days aren't.
    expect(historyBefore[TODAY].tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(historyAfter[TODAY]).toEqual({
      ...historyBefore[TODAY],
      tasks: [historyBefore[TODAY].tasks[2], historyBefore[TODAY].tasks[1], historyBefore[TODAY].tasks[0]],
    });
    expect(historyAfter[TODAY]).toMatchObject({ locked: true, lockSource: "manual", total: 3, completed: 1 });
    expect(historyAfter[TODAY].tasks.map((item) => [item.id, item.completed, item.carriedOver])).toEqual([
      ["c", false, false],
      ["b", true, false],
      ["a", false, true],
    ]);

    const saved = await savedState();
    expect(saved.todayLocked).toBe(true);
    expect(saved.tasks.map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(saved.history[TODAY].tasks.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("moveTask works on a set day too", async () => {
    const { result } = await renderStore({ todayLocked: true, todayLockSource: "auto" });
    await act(async () => result.current.moveTask("a", 2));
    expect(order(result)).toBe("b c a");
    expect(result.current.state.todayLocked).toBe(true);
    expect(result.current.state.todayLockSource).toBe("auto");
  });
});

describe("store: the focus session stays on its task", () => {
  const start = (result: Store, id: string) =>
    act(async () => result.current.startFocusSession(id, { kind: "timer", minutes: 10, source: "row" }));

  it("running: another task becoming next, or the timed task itself moving, leaves the session as it is", async () => {
    const { result } = await renderStore();
    await start(result, "a");
    await flush();
    const session = result.current.state.focusSession!;
    expect(session).toMatchObject({ taskId: "a", status: "running" });
    const scheduled = (scheduleFocusSessionNotification as jest.Mock).mock.calls.length;
    const mirrored = (writeFocusSession as jest.Mock).mock.calls.length;

    await act(async () => result.current.makeTaskNext("c"));
    expect(order(result)).toBe("c a b");
    expect(result.current.state.focusSession).toBe(session);

    await act(async () => result.current.moveTask("a", 2));
    expect(order(result)).toBe("c b a");
    expect(result.current.state.focusSession).toBe(session);

    await flush();
    // Its notification and the widget's copy aren't redone for a change of order.
    expect((scheduleFocusSessionNotification as jest.Mock).mock.calls.length).toBe(scheduled);
    expect((writeFocusSession as jest.Mock).mock.calls.length).toBe(mirrored);
    expect((await savedState()).focusSession).toEqual(session);
  });

  it("paused: stays paused on its task, with its time left", async () => {
    const { result } = await renderStore();
    await start(result, "b");
    jest.setSystemTime(START.getTime() + 4 * MIN);
    await act(async () => result.current.pauseFocusSession());
    const session = result.current.state.focusSession!;
    expect(session).toMatchObject({ taskId: "b", status: "paused", pausedRemainingMs: 6 * MIN });

    await act(async () => result.current.makeTaskNext("b"));
    expect(order(result)).toBe("b a c");
    await act(async () => result.current.makeTaskNext("c"));
    expect(order(result)).toBe("c b a");
    expect(result.current.state.focusSession).toBe(session);
  });

  it("ended (time's up, waiting for its check-in): stays on its task", async () => {
    const { result } = await renderStore();
    await start(result, "a");
    await act(async () => {
      jest.advanceTimersByTime(10 * MIN + 100);
    });
    await flush();
    const session = result.current.state.focusSession!;
    expect(session).toMatchObject({ taskId: "a", status: "ended" });

    await act(async () => result.current.makeTaskNext("c"));
    await act(async () => result.current.moveTask("a", 2));
    expect(order(result)).toBe("c b a");
    expect(result.current.state.focusSession).toBe(session);
  });
});

describe("store: what says 'next' follows the new order", () => {
  it("the widget's snapshot, the coach's task and a 'start my next task' request all pick the new first open task", async () => {
    const { result } = await renderStore({ todayCompletions: ["a"] });
    expect(lastSnapshot().tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(planFocusStart(result.current.state)).toEqual({ type: "start", taskId: "b" });

    await act(async () => result.current.makeTaskNext("c"));
    await flush();

    expect(lastSnapshot().tasks).toEqual([
      { id: "a", text: "Alpha", done: true },
      { id: "c", text: "Charlie", done: false },
      { id: "b", text: "Bravo", done: false },
    ]);
    expect(nextOpenTask(result.current.state.tasks, result.current.state.todayCompletions)?.id).toBe("c");
    expect(planFocusStart(result.current.state)).toEqual({ type: "start", taskId: "c" });
  });

  it("a start request never replaces the timer on the old next task: it asks about the new one", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("a", { kind: "timer", minutes: 10, source: "row" }));
    expect(planFocusStart(result.current.state)).toEqual({ type: "show" });
    await act(async () => result.current.makeTaskNext("c"));
    expect(planFocusStart(result.current.state)).toEqual({ type: "confirm", taskId: "c" });
    // Back to the timed task being next: its own timer is already on.
    await act(async () => result.current.makeTaskNext("a"));
    expect(planFocusStart(result.current.state)).toEqual({ type: "show" });
  });
});

describe("store: the one-time reorder hint", () => {
  it("is not shown yet for data saved before 1.4, and once marked it stays marked (saved, and the same state after)", async () => {
    // Saved by 1.3: the field isn't there at all.
    const { result } = await renderStore({ reorderHintSeen: undefined });
    expect(result.current.state.reorderHintSeen).toBe(false);

    await act(async () => result.current.markReorderHintSeen());
    await flush();
    expect(result.current.state.reorderHintSeen).toBe(true);
    expect((await savedState()).reorderHintSeen).toBe(true);
    // Nothing else changed, and marking it again is a no-op.
    expect(order(result)).toBe("a b c");
    const marked = result.current.state;
    await act(async () => result.current.markReorderHintSeen());
    expect(result.current.state).toBe(marked);
  });

  it("a new install starts with it not shown; a reorder doesn't mark it", async () => {
    expect(buildInitialState(START).reorderHintSeen).toBe(false);
    const { result } = await renderStore();
    await act(async () => result.current.makeTaskNext("c"));
    expect(result.current.state.reorderHintSeen).toBe(false);
  });
});

// --- Principal tester (PR #90) ------------------------------------------------

/** The rule, written out another way: the open ids re-sequenced, dealt back into the open slots. */
function expectedOrder(ids: string[], done: string[], id: string, to: number): string[] {
  const openIds = ids.filter((item) => !done.includes(item));
  if (!openIds.includes(id)) return ids;
  const rest = openIds.filter((item) => item !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  const sequence = [...rest.slice(0, at), id, ...rest.slice(at)];
  let next = 0;
  return ids.map((item) => (done.includes(item) ? item : sequence[next++]));
}
const ids = (result: Store) => result.current.state.tasks.map((item) => item.id);

describe("store: every list of 1, 2 and 3 tasks, every done/open combination", () => {
  const LISTS = [[A], [A, B], [A, B, C]];
  const cases = LISTS.flatMap((tasks) => {
    const out: { tasks: Task[]; done: string[]; name: string }[] = [];
    for (let mask = 0; mask < 1 << tasks.length; mask += 1) {
      const done = tasks.filter((_, bit) => mask & (1 << bit)).map((item) => item.id);
      out.push({ tasks, done, name: tasks.map((item) => (done.includes(item.id) ? `${item.id}✓` : item.id)).join(" ") });
    }
    return out;
  });

  it.each(cases)("[$name]: makeTaskNext and moveTask follow the rule; a no-op is the same state", async ({ tasks, done }) => {
    const { result } = await renderStore({ tasks, todayCompletions: done });
    const all = [...tasks.map((item) => item.id), "nope"];
    const moves: { label: string; id: string; to: number; run: () => void }[] = [];
    for (const id of all) {
      moves.push({ label: `next ${id}`, id, to: 0, run: () => result.current.makeTaskNext(id) });
      for (const to of [-1, 0, 1, 2, 3]) {
        moves.push({ label: `move ${id} to ${to}`, id, to, run: () => result.current.moveTask(id, to) });
      }
    }
    // One after another, each from wherever the last one left the list.
    const check = async (move: (typeof moves)[number]) => {
      const before = result.current.state;
      const want = expectedOrder(ids(result), done, move.id, move.to);
      const changes = want.join() !== ids(result).join();
      await act(async () => move.run());
      const after = result.current.state;
      expect(ids(result)).toEqual(want);
      if (!changes) {
        expect(after).toBe(before);
        return;
      }
      expect(after).not.toBe(before);
      // Done tasks kept their slots; the completions are the very same array.
      expect(after.todayCompletions).toBe(before.todayCompletions);
      before.tasks.forEach((item, index) => {
        if (done.includes(item.id)) expect(after.tasks[index]).toBe(item);
      });
      // Today's record follows, with each task's done mark still its own.
      expect(after.history[TODAY].tasks.map((item) => [item.id, item.completed])).toEqual(
        want.map((id) => [id, done.includes(id)]),
      );
      expect(after.history[TODAY].completed).toBe(done.length);
      // After makeTaskNext the task is the first open one.
      if (move.to <= 0) {
        expect(after.tasks.find((item) => !done.includes(item.id))?.id).toBe(move.id);
      }
    };
    for (const move of moves) {
      try {
        await check(move);
      } catch (error) {
        // Say which move it was.
        (error as Error).message = `${move.label}: ${(error as Error).message}`;
        throw error;
      }
    }
    // With fewer than two open tasks nothing above ever changed the state.
    if (tasks.length - done.length < 2) expect(ids(result)).toEqual(tasks.map((item) => item.id));
  });
});

describe("store: a set day stays set through a reorder", () => {
  it("both actions reorder it, and what the lock forbids is still forbidden afterwards", async () => {
    const lockedAt = new Date(2026, 9, 10, 8, 30).toISOString();
    const { result } = await renderStore({
      tasks: [A, B],
      parkedTasks: [{ id: "p1", text: "Parked", parkedAt: lockedAt }],
      todayLocked: true,
      todayLockSource: "manual",
      todayLockedAt: lockedAt,
    });
    await act(async () => result.current.makeTaskNext("b"));
    expect(order(result)).toBe("b a");
    await act(async () => result.current.moveTask("b", 1));
    expect(order(result)).toBe("a b");
    await act(async () => result.current.moveTask("b", 0));
    expect(order(result)).toBe("b a");

    // Nothing that changes the plan got through with it.
    const set = result.current.state;
    await act(async () => result.current.addTask("Delta"));
    await act(async () => result.current.addTasks(["Echo"]));
    await act(async () => result.current.editTask("a", "Changed"));
    await act(async () => result.current.deleteTask("a"));
    await act(async () => result.current.notToday("b"));
    await act(async () => result.current.addParkedTask("p1"));
    await act(async () => result.current.lockToday());
    expect(result.current.state).toBe(set);
    expect(set.tasks.map((item) => item.text)).toEqual(["Bravo", "Alpha"]);
    expect(set).toMatchObject({ todayLocked: true, todayLockSource: "manual", todayLockedAt: lockedAt });
    expect(set.parkedTasks).toHaveLength(1);

    // What a set day does allow still works on the reordered list: ticking.
    await act(async () => result.current.toggleTask("a"));
    expect(order(result)).toBe("b a✓");
    // And now there is one open task: nothing left to reorder.
    const ticked = result.current.state;
    await act(async () => result.current.makeTaskNext("b"));
    await act(async () => result.current.moveTask("b", 1));
    expect(result.current.state).toBe(ticked);
    expect(ticked.todayLocked).toBe(true);
  });

  it("unlocking afterwards keeps the new order, and the day can be changed again", async () => {
    const { result } = await renderStore({ todayLocked: true, todayLockSource: "manual" });
    await act(async () => result.current.makeTaskNext("c"));
    await act(async () => result.current.unlockToday());
    expect(result.current.state.todayLocked).toBe(false);
    expect(order(result)).toBe("c a b");
    await act(async () => result.current.deleteTask("a"));
    expect(order(result)).toBe("c b");
  });
});

describe("store: the order is saved, and survives a relaunch", () => {
  it("a new launch reads back the reordered list, the done marks, today's record and the widget's snapshot", async () => {
    const first = await renderStore({ todayCompletions: ["b"] });
    await act(async () => first.result.current.moveTask("a", 1));
    await flush();
    expect(order(first.result)).toBe("c b✓ a");
    await first.unmount();
    (writeWidgetSnapshot as jest.Mock).mockClear();
    __resetStorageForTests();

    // The relaunch: nothing but what was saved.
    const second = await renderHook(() => useDailyTasks(), { wrapper });
    await flush();
    expect(second.result.current.ready).toBe(true);
    expect(order(second.result)).toBe("c b✓ a");
    expect(second.result.current.state.history[TODAY].tasks.map((item) => [item.id, item.completed])).toEqual([
      ["c", false],
      ["b", true],
      ["a", false],
    ]);
    expect(lastSnapshot().tasks.map((item) => `${item.id}${item.done ? "✓" : ""}`)).toEqual(["c", "b✓", "a"]);
    expect(nextOpenTask(second.result.current.state.tasks, second.result.current.state.todayCompletions)?.id).toBe("c");
    expect(planFocusStart(second.result.current.state)).toEqual({ type: "start", taskId: "c" });

    // And it can be reordered again from there.
    await act(async () => second.result.current.makeTaskNext("a"));
    await flush();
    expect(order(second.result)).toBe("a b✓ c");
    expect((await savedState()).tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("several moves in one go save the last order, not an earlier one", async () => {
    const { result } = await renderStore();
    await act(async () => {
      result.current.makeTaskNext("c");
      result.current.makeTaskNext("b");
      result.current.moveTask("c", 2);
    });
    await flush();
    expect(order(result)).toBe("b a c");
    expect((await savedState()).tasks.map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect((await savedState()).history[TODAY].tasks.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("store: the day after a reorder", () => {
  const TOMORROW = "2026-10-11";

  it("yesterday's record keeps the reordered list, and the open tasks wait for the rollover in that order", async () => {
    const { result } = await renderStore({ todayCompletions: ["b"] });
    await act(async () => result.current.makeTaskNext("c"));
    await flush();
    expect(order(result)).toBe("c b✓ a");

    // Past midnight; the next thing the user does runs the day change first.
    jest.setSystemTime(new Date(2026, 9, 11, 7, 0));
    await act(async () => result.current.addTask("Delta"));
    await flush();
    const state = result.current.state;
    expect(result.current.today).toBe(TOMORROW);
    expect(state.history[TODAY].tasks.map((item) => [item.id, item.completed])).toEqual([
      ["c", false],
      ["b", true],
      ["a", false],
    ]);
    expect(state.history[TODAY]).toMatchObject({ total: 3, completed: 1 });
    // The two open ones, in the order the user left them.
    expect(state.pendingRollover?.tasks.map((item) => item.id)).toEqual(["c", "a"]);
    expect(state.tasks.map((item) => item.text)).toEqual(["Delta"]);
    expect(state.todayCompletions).toEqual([]);
  });

  it("a reorder asked for just after midnight changes the day first: yesterday's list isn't touched", async () => {
    const { result } = await renderStore({ todayLocked: true, todayLockSource: "manual" });
    jest.setSystemTime(new Date(2026, 9, 11, 0, 0, 10));
    // Yesterday's rows are still on screen when the handle is let go.
    await act(async () => result.current.moveTask("a", 2));
    await act(async () => result.current.makeTaskNext("c"));
    await flush();
    const state = result.current.state;
    expect(result.current.today).toBe(TOMORROW);
    expect(state.history[TODAY].tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(state.history[TODAY]).toMatchObject({ locked: true, lockSource: "manual" });
    expect(state.pendingRollover?.tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    // The new day is empty and open; the move found nothing to move in it.
    expect(state.tasks).toEqual([]);
    expect(state.todayLocked).toBe(false);
    expect(state.history[TOMORROW]?.tasks ?? []).toEqual([]);
  });

  it("carried-over tasks can be reordered the next day like any others, keeping their mark", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.makeTaskNext("c"));
    jest.setSystemTime(new Date(2026, 9, 11, 7, 0));
    await act(async () => result.current.resolveRollover(["c", "a", "b"]));
    await flush();
    expect(result.current.today).toBe(TOMORROW);
    const carried = result.current.state.tasks;
    expect(carried.map((item) => item.text)).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(carried.every((item) => item.carriedOver)).toBe(true);

    await act(async () => result.current.makeTaskNext(carried[2].id));
    expect(result.current.state.tasks.map((item) => [item.text, item.carriedOver])).toEqual([
      ["Bravo", true],
      ["Charlie", true],
      ["Alpha", true],
    ]);
    expect(result.current.state.history[TOMORROW].tasks.map((item) => item.text)).toEqual(["Bravo", "Charlie", "Alpha"]);
    // Yesterday's record is as it was left.
    expect(result.current.state.history[TODAY].tasks.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });
});

describe("store: a timer and steps ride along", () => {
  it("the timed task stays timed through a relaunch after a reorder, and its steps stay its own", async () => {
    const steps = [{ id: "s1", text: "Shoes on", done: true }];
    const first = await renderStore({ tasks: [A, task("b", "Bravo", { steps }), C] });
    await act(async () =>
      first.result.current.startFocusSession("b", { kind: "timer", minutes: 10, source: "row" }),
    );
    await act(async () => first.result.current.makeTaskNext("c"));
    await act(async () => first.result.current.moveTask("b", 2));
    await flush();
    const session = first.result.current.state.focusSession!;
    expect(order(first.result)).toBe("c a b");
    await first.unmount();
    __resetStorageForTests();

    const second = await renderHook(() => useDailyTasks(), { wrapper });
    await flush();
    expect(order(second.result)).toBe("c a b");
    expect(second.result.current.state.focusSession).toMatchObject({
      id: session.id,
      taskId: "b",
      status: "running",
      endAt: session.endAt,
    });
    expect(second.result.current.state.tasks[2].steps).toEqual(steps);
    // "Start my next task" asks about the new next one rather than replacing the timer.
    expect(planFocusStart(second.result.current.state)).toEqual({ type: "confirm", taskId: "c" });
  });

  it("ticking the timed task off after it was moved ends its timer, not another task's", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.startFocusSession("a", { kind: "timer", minutes: 10, source: "row" }));
    await act(async () => result.current.moveTask("a", 2));
    expect(order(result)).toBe("b c a");
    await act(async () => result.current.toggleTask("b"));
    expect(result.current.state.focusSession).toMatchObject({ taskId: "a", status: "running" });
    await act(async () => result.current.toggleTask("a"));
    await flush();
    expect(result.current.state.focusSession).toBeNull();
    expect(order(result)).toBe("b✓ c a✓");
  });
});

describe("store: the hint flag in saved state", () => {
  it.each([
    ["missing (saved by 1.3)", undefined, false],
    ["false", false, false],
    ["true", true, true],
    ["not a boolean", "yes", false],
    ["null", null, false],
  ])("%s loads fine", async (_name, saved, loaded) => {
    const { result } = await renderStore({ reorderHintSeen: saved as never });
    expect(result.current.state.reorderHintSeen).toBe(loaded);
    // The rest of the day is all there.
    expect(order(result)).toBe("a b c");
    expect(result.current.state.hasSeenOnboarding).toBe(true);
  });

  it("stays marked through a relaunch and a day change", async () => {
    const first = await renderStore();
    await act(async () => first.result.current.markReorderHintSeen());
    await flush();
    await first.unmount();
    __resetStorageForTests();
    jest.setSystemTime(new Date(2026, 9, 11, 7, 0));
    const second = await renderHook(() => useDailyTasks(), { wrapper });
    await flush();
    expect(second.result.current.today).toBe("2026-10-11");
    expect(second.result.current.state.reorderHintSeen).toBe(true);
  });
});
