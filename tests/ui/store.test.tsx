// Integration tests for the real DailyTasksProvider: AI plan request handling.
// The AI client is mocked so each request's timing and outcome is controlled.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { MomentumAiError } from "@/lib/daily-tasks/ai-status";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { MomentumPlan, MomentumProfile } from "@/lib/daily-tasks/types";

type Deferred = {
  resolve: (plan: MomentumPlan) => void;
  reject: (error: unknown) => void;
  goalTitle: string | null;
};
const mockRequests: Deferred[] = [];

jest.mock("@/lib/daily-tasks/momentum-ai", () => {
  const actual = jest.requireActual("@/lib/daily-tasks/momentum-ai");
  return {
    ...actual,
    getMomentumAiProxyUrl: () => "https://proxy.test/api/momentum/plan",
    requestMomentumAiPlan: ({ profile }: { profile: MomentumProfile }) =>
      new Promise((resolve, reject) => {
        mockRequests.push({ resolve, reject, goalTitle: profile.goalTitle });
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
    // Resolve the original (Run a 5K) request after the goal changed.
    await act(async () => mockRequests[0].resolve(aiPlan("Run a 5K", "Run 1 mile")));
    expect(result.current.state.momentumPlan?.goalTitle).not.toBe("Run a 5K");
    expect(
      result.current.state.momentumPlan?.todaySuggestions.some((t) => t.text === "Run 1 mile"),
    ).toBe(false);
  });

  it("records the review prompt time", async () => {
    const { result } = await seedAndRender();
    expect(result.current.state.lastReviewPromptAt).toBeNull();
    await act(async () => result.current.markReviewPrompted());
    expect(Number.isNaN(Date.parse(result.current.state.lastReviewPromptAt ?? ""))).toBe(false);
  });
});
