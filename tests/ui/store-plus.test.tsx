// The real DailyTasksProvider with a mocked Plus context: grandfathering, reset,
// and that AI ideas are only fetched for people with Plus.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, MomentumProfile } from "@/lib/daily-tasks/types";

const mockPlanRequests: unknown[] = [];
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: () => "https://proxy.test/api/momentum/plan",
  requestMomentumAiPlan: (params: unknown) => {
    mockPlanRequests.push(params);
    // Settle at once (as a failure) so nothing is left pending after a test.
    return Promise.reject(new Error("stubbed"));
  },
}));

let mockPlus: Partial<PlusContextValue>;
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

/** A paywall build where the user has no entitlement (yet). */
const PAYWALL_FREE: Partial<PlusContextValue> = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <DailyTasksProvider>{children}</DailyTasksProvider>
);

async function renderStore(saved: Partial<AppState>) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, momentumProfile: PROFILE, ...saved }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  mockPlanRequests.length = 0;
  mockPlus = { ...PAYWALL_FREE };
  await AsyncStorage.clear();
});

describe("store: Plus grandfathering", () => {
  it("grandfathers a user whose build has no RevenueCat key", async () => {
    mockPlus = { paywallBuild: false, paywallEnabled: false, entitlementActive: false };
    const { result } = await renderStore({ plusGrandfathered: false });
    await waitFor(() => expect(result.current.state.plusGrandfathered).toBe(true));
  });

  it("doesn't grandfather a new user on a paywall build, even if the SDK failed to start", async () => {
    // paywallEnabled false = broken SDK: they get access now, but not for good.
    mockPlus = { paywallBuild: true, paywallEnabled: false, entitlementActive: false };
    const { result } = await renderStore({ plusGrandfathered: false });
    expect(result.current.hasPlus).toBe(true);
    await act(async () => {});
    expect(result.current.state.plusGrandfathered).toBe(false);
  });

  it("keeps an early supporter's Plus through Reset all data", async () => {
    const { result } = await renderStore({ plusGrandfathered: true });
    expect(result.current.hasPlus).toBe(true);
    await act(async () => result.current.resetAll());
    expect(result.current.state.hasSeenOnboarding).toBe(false);
    expect(result.current.state.plusGrandfathered).toBe(true);
    expect(result.current.hasPlus).toBe(true);
  });
});

describe("store: AI ideas are a Plus feature", () => {
  it("never requests an AI plan without Plus, automatically or on demand", async () => {
    const { result } = await renderStore({ plusGrandfathered: false });
    expect(result.current.hasPlus).toBe(false);
    await act(async () => result.current.requestMomentumPlan());
    expect(mockPlanRequests).toHaveLength(0);
    expect(result.current.state.momentumPlanStatus).not.toBe("loading");
  });

  it("fetches the AI plan once the entitlement is active", async () => {
    mockPlus = { ...PAYWALL_FREE, entitlementActive: true };
    const { result } = await renderStore({ plusGrandfathered: false });
    expect(result.current.hasPlus).toBe(true);
    await waitFor(() => expect(mockPlanRequests).toHaveLength(1));
  });

  it("fetches today's plan when the entitlement arrives after launch", async () => {
    // RevenueCat answers after the store is ready: the day's fetch must not be spent.
    const hook = await renderStore({ plusGrandfathered: false });
    await act(async () => {});
    expect(mockPlanRequests).toHaveLength(0);
    mockPlus = { ...PAYWALL_FREE, entitlementActive: true };
    await hook.rerender({});
    await waitFor(() => expect(mockPlanRequests).toHaveLength(1));
  });
});
