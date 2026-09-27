// The real DailyTasksProvider with a mocked Plus context: grandfathering, reset,
// and that AI ideas are only fetched for people with Plus.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { track } from "@/lib/daily-tasks/analytics";
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

let mockVersion = "1.0.10";
jest.mock("@/lib/daily-tasks/app-update", () => ({
  ...jest.requireActual("@/lib/daily-tasks/app-update"),
  getCurrentVersion: () => mockVersion,
}));

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

/** A paywall build where RevenueCat has answered: no entitlement. */
const PAYWALL_FREE: Partial<PlusContextValue> = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
  entitlementKnown: true,
};

/** A paywall build where RevenueCat hasn't answered yet. */
const PAYWALL_PENDING: Partial<PlusContextValue> = { ...PAYWALL_FREE, entitlementKnown: false };

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
  mockVersion = "1.0.10";
  (track as jest.Mock).mockClear();
  mockPlus = { ...PAYWALL_FREE };
  await AsyncStorage.clear();
});

describe("store: Plus grandfathering", () => {
  it("grandfathers a user whose build has no RevenueCat key", async () => {
    mockPlus = { paywallBuild: false, paywallEnabled: false, entitlementActive: false };
    const { result } = await renderStore({ plusGrandfathered: false });
    await waitFor(() => expect(result.current.state.plusGrandfathered).toBe(true));
  });

  it("doesn't grandfather on a build from the paywall version on, even without a key", async () => {
    mockVersion = "1.1.0";
    mockPlus = { paywallBuild: false, paywallEnabled: false, entitlementActive: false };
    const { result } = await renderStore({ plusGrandfathered: false });
    await act(async () => {});
    expect(result.current.state.plusGrandfathered).toBe(false);
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

  it("keeps an analytics opt-out through Reset all data and forgets the anonymous id", async () => {
    await AsyncStorage.setItem("daily-tasks/analytics-id", "anon_old");
    const { result } = await renderStore({ analyticsEnabled: false });
    await act(async () => result.current.resetAll());
    expect(result.current.state.hasSeenOnboarding).toBe(false);
    expect(result.current.state.analyticsEnabled).toBe(false);
    expect(await AsyncStorage.getItem("daily-tasks/analytics-id")).toBeNull();
  });
});

describe("store: while RevenueCat hasn't answered", () => {
  it("doesn't gate, but waits to auto-fetch AI ideas and to log app_opened until access is confirmed", async () => {
    mockPlus = { ...PAYWALL_PENDING };
    const hook = await renderStore({ plusGrandfathered: false });
    await act(async () => {});
    // A subscriber is never shown the paywall just because the check is running.
    expect(hook.result.current.hasPlus).toBe(true);
    expect(mockPlanRequests).toHaveLength(0);
    expect(track).not.toHaveBeenCalledWith("app_opened", expect.anything());

    // RevenueCat answers: no entitlement.
    mockPlus = { ...PAYWALL_FREE };
    await hook.rerender({});
    await act(async () => {});
    expect(hook.result.current.hasPlus).toBe(false);
    expect(track).toHaveBeenCalledWith("app_opened", { plus: false });
    expect(mockPlanRequests).toHaveLength(0);
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
