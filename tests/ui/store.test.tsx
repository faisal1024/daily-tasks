// Integration tests for the real DailyTasksProvider: AI plan request handling.
// The AI client is mocked so each request's timing and outcome is controlled.
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { FOREGROUND_RETRY_COOLDOWN_MS, MomentumAiError } from "@/lib/daily-tasks/ai-status";
import { countPerfectDays } from "@/lib/daily-tasks/review-prompt";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { MomentumPlan, MomentumProfile } from "@/lib/daily-tasks/types";

type Deferred = {
  resolve: (plan: MomentumPlan) => void;
  reject: (error: unknown) => void;
  goalTitle: string | null;
  /** Days in the history sent with the request (tells stale state from fresh). */
  historyDays: string[];
};
const mockRequests: Deferred[] = [];

jest.mock("@/lib/daily-tasks/momentum-ai", () => {
  const actual = jest.requireActual("@/lib/daily-tasks/momentum-ai");
  return {
    ...actual,
    getMomentumAiProxyUrl: () => "https://proxy.test/api/momentum/plan",
    requestMomentumAiPlan: ({
      profile,
      history,
    }: {
      profile: MomentumProfile;
      history: Record<string, unknown>;
    }) =>
      new Promise((resolve, reject) => {
        mockRequests.push({
          resolve,
          reject,
          goalTitle: profile.goalTitle,
          historyDays: Object.keys(history).sort(),
        });
      }),
  };
});
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const PROFILE: MomentumProfile = {
  name: "Alex",
  goalTitle: "Run a 5K",
  goalSource: "custom",
  timeAvailability: "30_min",
  experienceLevel: "beginner",
  struggleType: "consistency",
  motivation: null,
  preferredTime: null,
  cadence: null,
  onboardingCompletedAt: "2026-09-01T08:00:00.000Z",
};

function aiPlan(goalTitle: string, text: string): MomentumPlan {
  return {
    id: `plan_${text}`,
    goalTitle,
    generatedAt: new Date().toISOString(),
    provider: "ai",
    milestones: [],
    taskPool: [],
    todaySuggestions: [
      { id: text, text, estimatedMinutes: 15, difficulty: "easy", reason: "", source: "ai" },
    ],
    promptSummary: "",
    version: 1,
  };
}

/**
 * Capture AppState "change" listeners so a test can emit foreground events.
 *
 * jest-expo's AppState mock is already a jest.fn, so `jest.spyOn(...)` returns
 * that same mock and `mockRestore()` wipes its implementation (it then returns
 * undefined). Every later provider's cleanup calls `sub.remove()` on undefined,
 * which surfaces as an act() AggregateError in unrelated tests. So swap the
 * implementation and put the original one back instead.
 */
function listenToAppState() {
  const addEventListener = AppState.addEventListener as unknown as jest.Mock;
  const original = addEventListener.getMockImplementation();
  const listeners = new Set<(state: string) => void>();
  addEventListener.mockImplementation((_type: string, listener: (state: string) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  return {
    emit: (state: string) => [...listeners].forEach((listener) => listener(state)),
    restore: () => addEventListener.mockImplementation(original),
  };
}

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

async function seedAndRender(profile: MomentumProfile = PROFILE) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, momentumProfile: profile }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  // The auto-fetch for today's plan starts once the store is ready.
  await waitFor(() => expect(mockRequests.length).toBe(1));
  return hook;
}

beforeEach(async () => {
  mockRequests.length = 0;
  await AsyncStorage.clear();
});

describe("store: AI plan requests", () => {
  it("applies a successful AI plan", async () => {
    const { result } = await seedAndRender();
    expect(result.current.state.momentumPlanStatus).toBe("loading");
    await act(async () => mockRequests[0].resolve(aiPlan("Run a 5K", "Run 1 mile")));
    expect(result.current.state.momentumPlanStatus).toBe("ready");
    expect(result.current.state.momentumPlan?.todaySuggestions[0].text).toBe("Run 1 mile");
  });

  it("keeps the current AI ideas when a later refresh fails", async () => {
    const { result } = await seedAndRender();
    await act(async () => mockRequests[0].resolve(aiPlan("Run a 5K", "Run 1 mile")));
    await act(async () => {
      void result.current.requestMomentumPlan();
    });
    await act(async () => mockRequests[1].reject(new MomentumAiError("timeout", "timed out")));
    expect(result.current.state.momentumPlanStatus).toBe("error");
    expect(result.current.state.momentumPlanError).toBe("timeout");
    expect(result.current.state.momentumPlan?.provider).toBe("ai");
    expect(result.current.state.momentumPlan?.todaySuggestions[0].text).toBe("Run 1 mile");
  });

  it("only the newest request may update state (an older one finishing late is ignored)", async () => {
    const { result } = await seedAndRender();
    await act(async () => {
      void result.current.requestMomentumPlan();
    });
    expect(mockRequests).toHaveLength(2);

    // The newer request wins...
    await act(async () => mockRequests[1].resolve(aiPlan("Run a 5K", "Newer idea")));
    // ...and the older one finishing afterwards changes nothing.
    await act(async () => mockRequests[0].resolve(aiPlan("Run a 5K", "Stale idea")));
    expect(result.current.state.momentumPlan?.todaySuggestions[0].text).toBe("Newer idea");
    expect(result.current.state.momentumPlanStatus).toBe("ready");
  });

  it("a stale request can't turn 'loading' off while the newer one is in flight", async () => {
    const { result } = await seedAndRender();
    await act(async () => {
      void result.current.requestMomentumPlan();
    });
    await act(async () => mockRequests[0].reject(new MomentumAiError("network", "offline")));
    expect(result.current.state.momentumPlanStatus).toBe("loading");
    expect(result.current.state.momentumPlanError).toBeNull();
  });

  it("drops a plan for a goal that changed while it was loading", async () => {
    const { result } = await seedAndRender();
    await act(async () => {
      result.current.updateMomentumProfile({ ...PROFILE, goalTitle: "Learn guitar" });
    });
    // The goal change starts a fresh request for the new goal.
    await waitFor(() => expect(mockRequests).toHaveLength(2));
    expect(mockRequests[1].goalTitle).toBe("Learn guitar");

    // The original (Run a 5K) request finishing late is ignored...
    await act(async () => mockRequests[0].resolve(aiPlan("Run a 5K", "Run 1 mile")));
    expect(
      result.current.state.momentumPlan?.todaySuggestions.some((t) => t.text === "Run 1 mile"),
    ).toBe(false);
    // ...and doesn't end the new request's loading state early.
    expect(result.current.state.momentumPlanStatus).toBe("loading");

    // The new goal's plan is applied when it arrives.
    await act(async () => mockRequests[1].resolve(aiPlan("Learn guitar", "Practice chords")));
    expect(result.current.state.momentumPlanStatus).toBe("ready");
    expect(result.current.state.momentumPlan?.goalTitle).toBe("Learn guitar");
    expect(result.current.state.momentumPlan?.todaySuggestions[0].text).toBe("Practice chords");
  });

  it("drops a late plan for the old goal even when no newer request replaced it", async () => {
    const { result } = await seedAndRender();
    // An incomplete profile doesn't auto-fetch, so the Run a 5K request stays the
    // latest one and only the goal check can reject its plan.
    await act(async () => {
      result.current.updateMomentumProfile({
        ...PROFILE,
        goalTitle: "Learn guitar",
        onboardingCompletedAt: null,
      });
    });
    expect(mockRequests).toHaveLength(1);
    await act(async () => mockRequests[0].resolve(aiPlan("Run a 5K", "Run 1 mile")));
    expect(result.current.state.momentumPlan?.goalTitle).not.toBe("Run a 5K");
    expect(result.current.state.momentumPlan?.provider).not.toBe("ai");
    expect(result.current.state.momentumPlanStatus).toBe("ready");
  });

  it("ignores a failure for the old goal (no error shown for the new goal)", async () => {
    const { result } = await seedAndRender();
    await act(async () => {
      result.current.updateMomentumProfile({
        ...PROFILE,
        goalTitle: "Learn guitar",
        onboardingCompletedAt: null,
      });
    });
    await act(async () => mockRequests[0].reject(new MomentumAiError("timeout", "timed out")));
    expect(result.current.state.momentumPlanStatus).toBe("ready");
    expect(result.current.state.momentumPlanError).toBeNull();
  });

  it("retries a transient failure on foreground once the cooldown has passed (same day)", async () => {
    const appState = listenToAppState();
    fakeClockAt(new Date(2026, 8, 26, 10, 0));
    try {
      const { result } = await seedAndRender();
      await act(async () => mockRequests[0].reject(new MomentumAiError("timeout", "timed out")));
      expect(result.current.state.momentumPlanStatus).toBe("error");

      // Within the cooldown: no retry.
      await act(async () => appState.emit("active"));
      expect(mockRequests).toHaveLength(1);

      jest.setSystemTime(Date.now() + FOREGROUND_RETRY_COOLDOWN_MS);
      await act(async () => appState.emit("active"));
      expect(mockRequests).toHaveLength(2);
      await act(async () => mockRequests[1].resolve(aiPlan("Run a 5K", "Retried idea")));
      expect(result.current.state.momentumPlanStatus).toBe("ready");
      expect(result.current.state.momentumPlan?.todaySuggestions[0].text).toBe("Retried idea");
    } finally {
      jest.useRealTimers();
      appState.restore();
    }
  });

  it("doesn't retry yesterday's failure on foreground after the day changed (the rollover fetch is the only new request)", async () => {
    const appState = listenToAppState();
    fakeClockAt(new Date(2026, 8, 26, 10, 0));
    try {
      const { result } = await seedAndRender();
      await act(async () => mockRequests[0].reject(new MomentumAiError("timeout", "timed out")));
      expect(result.current.state.momentumPlanStatus).toBe("error");

      // A new day: the rollover owns the refresh, so no retry for yesterday.
      jest.setSystemTime(new Date(2026, 8, 27, 10, 0));
      await act(async () => appState.emit("active"));
      await waitFor(() => expect(result.current.today).toBe("2026-09-27"));
      // Exactly one new request: the rollover's fetch for the new day. Without
      // the day check, a retry built from yesterday's state fires instead and
      // (being "loading") suppresses the rollover fetch.
      await waitFor(() => expect(mockRequests).toHaveLength(2));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(mockRequests).toHaveLength(2);
      // ...and it's made from the rolled-over state (today's record exists), not
      // a stale retry that would block the rollover fetch while "loading".
      expect(mockRequests[1].historyDays).toContain("2026-09-27");
      await act(async () => mockRequests[1].resolve(aiPlan("Run a 5K", "New day idea")));
      expect(result.current.state.momentumPlan?.todaySuggestions[0].text).toBe("New day idea");
    } finally {
      jest.useRealTimers();
      appState.restore();
    }
  });

  it("counts today in history once all three tasks are done (what the rating policy reads)", async () => {
    const { result } = await seedAndRender();
    await act(async () => result.current.addTasks(["Walk", "Stretch", "Hydrate"]));
    for (const task of result.current.state.tasks) {
      await act(async () => result.current.toggleTask(task.id));
    }
    const today = result.current.today;
    expect(result.current.state.history[today]).toMatchObject({ total: 3, completed: 3 });
    expect(countPerfectDays(result.current.state.history)).toBe(1);
  });

  it("records the review prompt time", async () => {
    const { result } = await seedAndRender();
    expect(result.current.state.lastReviewPromptAt).toBeNull();
    await act(async () => result.current.markReviewPrompted());
    expect(Number.isNaN(Date.parse(result.current.state.lastReviewPromptAt ?? ""))).toBe(false);
  });
});

// --- Phase 3: parked brain-dump items, task steps, lock time -----------------

async function seedWith(overrides: Record<string, unknown> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({
      ...buildInitialState(),
      hasSeenOnboarding: true,
      momentumProfile: PROFILE,
      ...overrides,
    }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await waitFor(() => expect(mockRequests.length).toBe(1));
  return hook;
}

async function savedState() {
  return JSON.parse((await AsyncStorage.getItem("daily-tasks/state/v1")) ?? "null");
}

describe("store: brain dump parking", () => {
  it("parks leftovers, skipping ones already on today's list, and saves them", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.addTasks(["Call mum"]));
    await act(async () => result.current.parkTasks(["call mum", "Buy shoes", "Water plants"]));
    expect(result.current.state.parkedTasks.map((p) => p.text)).toEqual(["Buy shoes", "Water plants"]);
    await waitFor(async () =>
      expect((await savedState())?.parkedTasks.map((p: { text: string }) => p.text)).toEqual([
        "Buy shoes",
        "Water plants",
      ]),
    );
  });

  it("addParkedTask moves an item onto today's list and out of parked", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.parkTasks(["Buy shoes", "Water plants"]));
    const id = result.current.state.parkedTasks[0].id;
    await act(async () => result.current.addParkedTask(id));
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Buy shoes"]);
    expect(result.current.state.parkedTasks.map((p) => p.text)).toEqual(["Water plants"]);
    // Today's history is kept in sync like any other add.
    expect(result.current.state.history[result.current.today]?.total).toBe(1);
  });

  it("addParkedTask is a no-op (item stays parked) when the day is locked or full", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.parkTasks(["Buy shoes"]));
    const id = result.current.state.parkedTasks[0].id;

    await act(async () => result.current.addTasks(["A", "B", "C"]));
    await act(async () => result.current.addParkedTask(id));
    expect(result.current.state.tasks).toHaveLength(3);
    expect(result.current.state.parkedTasks.map((p) => p.id)).toEqual([id]);

    await act(async () => result.current.deleteTask(result.current.state.tasks[2].id));
    await act(async () => result.current.lockToday());
    await act(async () => result.current.addParkedTask(id));
    expect(result.current.state.tasks).toHaveLength(2);
    expect(result.current.state.parkedTasks.map((p) => p.id)).toEqual([id]);
  });

  it("addParkedTask ignores an unknown id; removeParkedTask removes one", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.parkTasks(["Buy shoes", "Swim"]));
    await act(async () => result.current.addParkedTask("nope"));
    expect(result.current.state.tasks).toHaveLength(0);
    await act(async () => result.current.removeParkedTask(result.current.state.parkedTasks[0].id));
    expect(result.current.state.parkedTasks.map((p) => p.text)).toEqual(["Swim"]);
  });

  it("parked items survive an app restart", async () => {
    const first = await seedWith();
    await act(async () => first.result.current.parkTasks(["Buy shoes"]));
    await waitFor(async () => expect((await savedState())?.parkedTasks).toHaveLength(1));
    await first.unmount();

    mockRequests.length = 0;
    const hook = await renderHook(() => useDailyTasks(), { wrapper });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.state.parkedTasks.map((p) => p.text)).toEqual(["Buy shoes"]);
  });
});

describe("store: task steps", () => {
  it("sets, toggles and clears steps on a task, and saves them", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.addTasks(["Clean kitchen", "Walk"]));
    const [clean, walk] = result.current.state.tasks;
    await act(async () => result.current.setTaskSteps(clean.id, ["Clear counter", "Wipe", "Sweep"]));
    const steps = result.current.state.tasks[0].steps ?? [];
    expect(steps.map((s) => s.text)).toEqual(["Clear counter", "Wipe", "Sweep"]);
    expect(result.current.state.tasks[1].steps).toBeUndefined();

    await act(async () => result.current.toggleTaskStep(clean.id, steps[1].id));
    expect(result.current.state.tasks[0].steps?.map((s) => s.done)).toEqual([false, true, false]);
    // Steps don't complete the task.
    expect(result.current.isCompleted(clean.id)).toBe(false);
    await waitFor(async () =>
      expect((await savedState())?.tasks[0].steps.map((s: { done: boolean }) => s.done)).toEqual([
        false,
        true,
        false,
      ]),
    );

    await act(async () => result.current.clearTaskSteps(clean.id));
    expect(result.current.state.tasks[0].steps).toBeUndefined();
    expect(result.current.state.tasks[1].id).toBe(walk.id);
  });

  it("editing a task's text drops its steps; saving the same text keeps them", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.addTasks(["Clean kitchen", "Walk"]));
    const [clean, walk] = result.current.state.tasks;
    await act(async () => result.current.setTaskSteps(clean.id, ["a", "b"]));
    await act(async () => result.current.setTaskSteps(walk.id, ["c", "d"]));
    await act(async () => result.current.editTask(clean.id, "  Clean kitchen  "));
    expect(result.current.state.tasks[0].steps).toHaveLength(2);
    await act(async () => result.current.editTask(clean.id, "Clean bathroom"));
    expect(result.current.state.tasks[0]).not.toHaveProperty("steps");
    expect(result.current.state.tasks[0].text).toBe("Clean bathroom");
    expect(result.current.state.tasks[1].steps).toHaveLength(2);
  });

  it("drops steps from a slow break-down if the task was edited meanwhile", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.addTasks(["Clean kitchen"]));
    const id = result.current.state.tasks[0].id;
    await act(async () => result.current.editTask(id, "Clean bathroom"));
    await act(async () => result.current.setTaskSteps(id, ["a", "b"], "Clean kitchen"));
    expect(result.current.state.tasks[0]).not.toHaveProperty("steps");
    await act(async () => result.current.setTaskSteps(id, ["a", "b"], "Clean bathroom"));
    expect(result.current.state.tasks[0].steps).toHaveLength(2);
  });

  it("a carried-over task keeps the steps and ticks made after its last other change", async () => {
    const appState = listenToAppState();
    fakeClockAt(new Date(2026, 8, 26, 10, 0));
    try {
      const { result } = await seedWith({ lastOpenedDate: "2026-09-26" });
      await act(async () => result.current.addTasks(["Clean kitchen"]));
      const id = result.current.state.tasks[0].id;
      // Only step actions after the add: history must be synced by them.
      await act(async () => result.current.setTaskSteps(id, ["Clear counter", "Wipe", "Sweep"]));
      const stepId = result.current.state.tasks[0].steps![1].id;
      await act(async () => result.current.toggleTaskStep(id, stepId));

      jest.setSystemTime(new Date(2026, 8, 27, 8, 0));
      await act(async () => appState.emit("active"));
      await waitFor(() => expect(result.current.state.pendingRollover).not.toBeNull());
      await act(async () => result.current.resolveRollover([id]));

      const carried = result.current.state.tasks.find((t) => t.text === "Clean kitchen");
      expect(carried?.carriedOver).toBe(true);
      expect(carried?.steps?.map((st) => [st.text, st.done])).toEqual([
        ["Clear counter", false],
        ["Wipe", true],
        ["Sweep", false],
      ]);
    } finally {
      jest.useRealTimers();
      appState.restore();
    }
  });

  it("step checklists still work after the day is locked", async () => {
    const { result } = await seedWith();
    await act(async () => result.current.addTasks(["Clean"]));
    const id = result.current.state.tasks[0].id;
    await act(async () => result.current.setTaskSteps(id, ["a", "b"]));
    await act(async () => result.current.lockToday());
    await act(async () =>
      result.current.toggleTaskStep(id, result.current.state.tasks[0].steps![0].id),
    );
    expect(result.current.state.tasks[0].steps?.[0].done).toBe(true);
  });
});

describe("store: when today was locked", () => {
  it("records the manual lock time and clears it on unlock", async () => {
    fakeClockAt(new Date(2026, 8, 26, 9, 41));
    try {
      const { result } = await seedWith({ lastOpenedDate: "2026-09-26" });
      await act(async () => result.current.addTasks(["Walk"]));
      await act(async () => result.current.lockToday());
      expect(result.current.state.todayLockSource).toBe("manual");
      expect(result.current.state.todayLockedAt).toBe(new Date(2026, 8, 26, 9, 41).toISOString());
      await act(async () => result.current.unlockToday());
      expect(result.current.state.todayLockedAt).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("records the configured auto-lock time, even when the app notices later", async () => {
    fakeClockAt(new Date(2026, 8, 26, 12, 17));
    try {
      const { result } = await seedWith({
        lastOpenedDate: "2026-09-26",
        autoLock: { enabled: true, hour: 12, minute: 0 },
        tasks: [
          {
            id: "t1",
            text: "Walk",
            createdAt: new Date(2026, 8, 26, 8, 0).toISOString(),
            carriedOver: false,
          },
        ],
      });
      await waitFor(() => expect(result.current.state.todayLocked).toBe(true));
      expect(result.current.state.todayLockSource).toBe("auto");
      expect(result.current.state.todayLockedAt).toBe(new Date(2026, 8, 26, 12, 0).toISOString());
    } finally {
      jest.useRealTimers();
    }
  });

  it("a new day starts unlocked with no lock time", async () => {
    const appState = listenToAppState();
    fakeClockAt(new Date(2026, 8, 26, 10, 0));
    try {
      const { result } = await seedWith({ lastOpenedDate: "2026-09-26" });
      await act(async () => result.current.addTasks(["Walk"]));
      await act(async () => result.current.lockToday());
      expect(result.current.state.todayLockedAt).not.toBeNull();
      jest.setSystemTime(new Date(2026, 8, 27, 8, 0));
      await act(async () => appState.emit("active"));
      await waitFor(() => expect(result.current.today).toBe("2026-09-27"));
      expect(result.current.state.todayLocked).toBe(false);
      expect(result.current.state.todayLockedAt).toBeNull();
    } finally {
      jest.useRealTimers();
      appState.restore();
    }
  });
});
