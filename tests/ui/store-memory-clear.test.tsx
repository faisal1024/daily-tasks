// 1.5 C: "Clear memory" while an AI plan request is on its way. The answer
// was built on what was cleared, so it is dropped, and today's plan is
// fetched again (the auto-fetch's day + goal key is reset).
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider, reducer, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, MomentumPlan, MomentumProfile } from "@/lib/daily-tasks/types";

const mockPending: ((plan: MomentumPlan) => void)[] = [];
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: () => "https://proxy.test/api/momentum/plan",
  requestMomentumAiPlan: () => new Promise<MomentumPlan>((resolve) => mockPending.push(resolve)),
}));
const mockPlus: Partial<PlusContextValue> = { paywallBuild: false, paywallEnabled: false, entitlementActive: false };
jest.mock("@/lib/daily-tasks/plus-context", () => ({ usePlus: () => mockPlus }));
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

const aiPlan = (id: string): MomentumPlan => ({
  id,
  goalTitle: "Run a 5K",
  generatedAt: new Date().toISOString(),
  provider: "ai",
  milestones: [
    { id: "milestone_start", title: "Run 1 km", description: "", completedAt: null },
    { id: "milestone_middle", title: "Run 3 km", description: "", completedAt: null },
    { id: "milestone_finish", title: "Run 5 km", description: "", completedAt: null },
  ],
  taskPool: [],
  todaySuggestions: [{ id: `${id}-1`, text: "Jog for 10 minutes", estimatedMinutes: 10, difficulty: "easy", reason: "r", source: "ai" }],
  promptSummary: "",
  version: 1,
});

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

async function renderStore(saved: Partial<AppState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, plusGrandfathered: true, momentumProfile: PROFILE, ...saved }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  mockPending.length = 0;
  await AsyncStorage.clear();
});

describe("store: Clear memory during an AI plan request", () => {
  it("drops the answer that was on its way, then fetches today's plan again and keeps that one", async () => {
    const { result } = await renderStore({ coachMemory: "Mornings work best." });
    // The auto-fetch for today's plan is on its way.
    await waitFor(() => expect(mockPending).toHaveLength(1));
    expect(result.current.state.momentumPlanStatus).toBe("loading");

    await act(async () => result.current.clearCoachMemory());
    await act(async () => mockPending[0](aiPlan("stale")));
    expect(result.current.state.momentumPlan?.id).not.toBe("stale");
    expect(result.current.state.momentumPlanError).toBeNull();

    // Asked again, once, now without what was cleared.
    await waitFor(() => expect(mockPending).toHaveLength(2));
    await act(async () => mockPending[1](aiPlan("fresh")));
    await waitFor(() => expect(result.current.state.momentumPlan?.id).toBe("fresh"));
    expect(result.current.state.momentumPlanStatus).toBe("ready");
    expect(mockPending).toHaveLength(2);
  });

  it("a request started after the clearing is kept", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockPending).toHaveLength(1));
    await act(async () => mockPending[0](aiPlan("first")));
    await waitFor(() => expect(result.current.state.momentumPlan?.id).toBe("first"));
    await act(async () => result.current.clearCoachMemory());
    let request: Promise<void> | undefined;
    await act(async () => {
      request = result.current.requestMomentumPlan();
    });
    await waitFor(() => expect(mockPending).toHaveLength(2));
    await act(async () => {
      mockPending[1](aiPlan("after"));
      await request;
    });
    expect(result.current.state.momentumPlan?.id).toBe("after");
  });
});

describe("reducer: requestMomentumPlanDropped", () => {
  const dropped = { type: "requestMomentumPlanDropped" } as Parameters<typeof reducer>[1];

  it("leaves loading: ready with the plan already shown, idle with none, and no error either way", () => {
    const base = buildInitialState();
    const withPlan = { ...base, momentumPlan: aiPlan("shown"), momentumPlanStatus: "loading" as const, momentumPlanError: null };
    expect(reducer(withPlan, dropped)).toMatchObject({ momentumPlanStatus: "ready", momentumPlanError: null });
    expect(reducer(withPlan, dropped).momentumPlan?.id).toBe("shown");
    const none = { ...base, momentumPlan: null, momentumPlanStatus: "loading" as const };
    expect(reducer(none, dropped)).toMatchObject({ momentumPlanStatus: "idle", momentumPlanError: null, momentumPlan: null });
  });
});
