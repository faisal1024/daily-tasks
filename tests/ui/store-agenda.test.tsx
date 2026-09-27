// The real DailyTasksProvider: "Plan around my calendar" toggles, and the AI
// plan request reads today's agenda only while it's on.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { readTodayAgenda } from "@/lib/daily-tasks/agenda";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState, claimFirstAiSort, clearState } from "@/lib/daily-tasks/storage";
import type { AppState, MomentumProfile } from "@/lib/daily-tasks/types";

const mockPlanRequests: { agenda?: string[] }[] = [];
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: () => "https://proxy.test/api/momentum/plan",
  requestMomentumAiPlan: (params: { agenda?: string[] }) => {
    mockPlanRequests.push(params);
    return Promise.reject(new Error("stubbed"));
  },
}));
jest.mock("@/lib/daily-tasks/agenda", () => ({
  ...jest.requireActual("@/lib/daily-tasks/agenda"),
  readTodayAgenda: jest.fn(async () => ["09:30 Dentist"]),
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

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

async function renderStore(saved: Partial<AppState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({
      ...buildInitialState(),
      hasSeenOnboarding: true,
      plusGrandfathered: true,
      momentumProfile: PROFILE,
      ...saved,
    }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  // The auto-fetch for today's plan runs once the store is ready.
  await waitFor(() => expect(mockPlanRequests).toHaveLength(1));
  return hook;
}

beforeEach(async () => {
  mockPlanRequests.length = 0;
  (readTodayAgenda as jest.Mock).mockClear();
  await AsyncStorage.clear();
});

describe("store: agenda", () => {
  it("is off by default: the plan request doesn't read the calendar", async () => {
    const { result } = await renderStore();
    expect(result.current.state.agendaEnabled).toBe(false);
    expect(readTodayAgenda).not.toHaveBeenCalled();
    expect(mockPlanRequests[0].agenda).toEqual([]);
  });

  it("setAgendaEnabled toggles it, and the next plan request carries today's agenda", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.setAgendaEnabled(true));
    expect(result.current.state.agendaEnabled).toBe(true);

    await act(async () => {
      await result.current.requestMomentumPlan();
    });
    expect(readTodayAgenda).toHaveBeenCalledTimes(1);
    expect(mockPlanRequests.at(-1)?.agenda).toEqual(["09:30 Dentist"]);

    await act(async () => result.current.setAgendaEnabled(false));
    expect(result.current.state.agendaEnabled).toBe(false);
    await act(async () => {
      await result.current.requestMomentumPlan();
    });
    expect(readTodayAgenda).toHaveBeenCalledTimes(1);
    expect(mockPlanRequests.at(-1)?.agenda).toEqual([]);
  });

  it("reads the agenda on the auto-fetch when it was saved on", async () => {
    await renderStore({ agendaEnabled: true });
    expect(readTodayAgenda).toHaveBeenCalled();
    expect(mockPlanRequests[0].agenda).toEqual(["09:30 Dentist"]);
  });
});

describe("storage: claimFirstAiSort", () => {
  it("is true once per install, then false, even after Reset all data", async () => {
    expect(await claimFirstAiSort()).toBe(true);
    expect(await claimFirstAiSort()).toBe(false);
    await clearState();
    expect(await claimFirstAiSort()).toBe(false);
  });

  it("is false when storage fails (no free AI sort rather than a crash)", async () => {
    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
    expect(await claimFirstAiSort()).toBe(false);
    spy.mockRestore();
  });
});
