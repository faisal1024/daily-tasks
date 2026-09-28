// The goal path (momentumPlan.milestones) belongs to the user: daily plan
// rebuilds keep it; only a goal change, an edit, or "new path" replaces it.
// Real DailyTasksProvider; the AI client is a controllable deferred.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { MomentumAiError } from "@/lib/daily-tasks/ai-status";
import { MILESTONE_IDS } from "@/lib/daily-tasks/momentum";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, MomentumMilestone, MomentumPlan, MomentumProfile } from "@/lib/daily-tasks/types";

type Deferred = { resolve: (plan: MomentumPlan) => void; reject: (error: unknown) => void };
const mockRequests: Deferred[] = [];

jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: () => "https://proxy.test/api/momentum/plan",
  requestMomentumAiPlan: () =>
    new Promise((resolve, reject) => {
      mockRequests.push({ resolve, reject });
    }),
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

const step = (id: string, title: string): MomentumMilestone => ({ id, title, description: "", completedAt: null });

/** The user's current path (template ids, custom titles). */
const MY_PATH = [
  step(MILESTONE_IDS[0], "Walk 10 minutes"),
  step(MILESTONE_IDS[1], "Jog 1 mile"),
  step(MILESTONE_IDS[2], "Jog 3 miles"),
];

function plan(goalTitle: string, milestones: MomentumMilestone[], idea: string, generatedAt = new Date().toISOString()): MomentumPlan {
  return {
    id: `plan_${idea}`,
    goalTitle,
    generatedAt,
    provider: "ai",
    milestones,
    taskPool: [],
    todaySuggestions: [{ id: idea, text: idea, estimatedMinutes: 15, difficulty: "easy", reason: "", source: "ai" }],
    promptSummary: "",
    version: 1,
  };
}

/** What the AI sends back: a different path each time. */
const aiPath = (tag: string) => MILESTONE_IDS.map((id, i) => step(id, `${tag} ${i + 1}`));

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

/** Yesterday's plan is saved, so today's auto-fetch starts once ready (with Plus). */
async function renderStore(saved: Partial<AppState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({
      ...buildInitialState(),
      hasSeenOnboarding: true,
      momentumProfile: PROFILE,
      momentumPlan: plan("Run a 5K", MY_PATH, "Yesterday", "2020-01-01T08:00:00.000Z"),
      completedMilestoneIds: [MILESTONE_IDS[0], MILESTONE_IDS[1]],
      ...saved,
    }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

const titles = (state: AppState) => state.momentumPlan?.milestones.map((m) => m.title);

beforeEach(async () => {
  mockRequests.length = 0;
  // No RevenueCat key: an early user with Plus.
  mockPlus = { paywallBuild: false, paywallEnabled: false, entitlementActive: false };
  await AsyncStorage.clear();
});

describe("store: the path stays put across plan rebuilds", () => {
  it("the daily AI refresh brings new ideas but keeps the path and its ticks", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));
    await act(async () => mockRequests[0].resolve(plan("Run a 5K", aiPath("AI"), "Today idea")));

    expect(result.current.state.momentumPlan?.todaySuggestions[0].text).toBe("Today idea");
    expect(titles(result.current.state)).toEqual(["Walk 10 minutes", "Jog 1 mile", "Jog 3 miles"]);
    expect(result.current.momentumMilestones.map((m) => m.done)).toEqual([true, true, false]);
  });

  it("a settings change (which rebuilds the plan) keeps the path", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));
    await act(async () => mockRequests[0].resolve(plan("Run a 5K", aiPath("AI"), "Today idea")));
    await act(async () => result.current.setMomentumSetting("suggestionTone", "direct"));
    expect(titles(result.current.state)).toEqual(["Walk 10 minutes", "Jog 1 mile", "Jog 3 miles"]);
    expect(result.current.state.completedMilestoneIds).toEqual([MILESTONE_IDS[0], MILESTONE_IDS[1]]);
  });

  it("a failed refresh keeps the path too", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));
    await act(async () => mockRequests[0].reject(new MomentumAiError("timeout", "timed out")));
    expect(result.current.state.momentumPlanStatus).toBe("error");
    expect(titles(result.current.state)).toEqual(["Walk 10 minutes", "Jog 1 mile", "Jog 3 miles"]);
  });

  it("changing the goal replaces the path and clears its ticks", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));
    await act(async () => mockRequests[0].resolve(plan("Run a 5K", aiPath("AI"), "Today idea")));
    await act(async () => result.current.updateMomentumProfile({ ...PROFILE, goalTitle: "Learn guitar" }));

    expect(result.current.state.momentumPlan?.goalTitle).toBe("Learn guitar");
    expect(titles(result.current.state)).not.toContain("Walk 10 minutes");
    expect(result.current.state.completedMilestoneIds).toEqual([]);
  });

  // BUG (PR #61): a goal change (or onboarding) builds the local starter path
  // first; the new goal's AI plan then has the same goal title, so keepPath
  // keeps the generic starter steps and a Plus user never sees an AI path
  // unless they tap "Suggest a new path". Flip to `it` once fixed.
  it.failing("the new goal's first AI plan brings its own path", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));
    await act(async () => mockRequests[0].resolve(plan("Run a 5K", aiPath("AI"), "Today idea")));
    await act(async () => result.current.updateMomentumProfile({ ...PROFILE, goalTitle: "Learn guitar" }));
    await waitFor(() => expect(mockRequests).toHaveLength(2));
    await act(async () => mockRequests[1].resolve(plan("Learn guitar", aiPath("Guitar"), "Chords")));
    expect(titles(result.current.state)).toEqual(["Guitar 1", "Guitar 2", "Guitar 3"]);
  });
});

describe("store: editMilestones", () => {
  it("renames, removes and adds steps; a removed step's tick goes with it; later refreshes keep the edit", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));

    await act(async () =>
      result.current.editMilestones([
        { id: MILESTONE_IDS[0], title: "  Walk 15 minutes ", description: "Every morning" },
        // MILESTONE_IDS[1] (ticked) removed
        { id: MILESTONE_IDS[2], title: "Jog 3 miles" },
        { title: "Race day" },
      ]),
    );
    const state = result.current.state;
    expect(titles(state)).toEqual(["Walk 15 minutes", "Jog 3 miles", "Race day"]);
    expect(state.momentumPlan?.milestones[0].description).toBe("Every morning");
    expect(state.momentumPlan?.milestones[2].id).not.toBe(MILESTONE_IDS[1]);
    expect(state.completedMilestoneIds).toEqual([MILESTONE_IDS[0]]);
    expect(result.current.momentumMilestones.map((m) => m.done)).toEqual([true, false, false]);

    // The in-flight daily refresh lands after the edit: the edit stays.
    await act(async () => mockRequests[0].resolve(plan("Run a 5K", aiPath("AI"), "Today idea")));
    expect(titles(result.current.state)).toEqual(["Walk 15 minutes", "Jog 3 miles", "Race day"]);
  });

  it("ignores an all-blank edit (the path is never emptied)", async () => {
    const { result } = await renderStore();
    await act(async () => result.current.editMilestones([{ id: MILESTONE_IDS[0], title: "   " }]));
    expect(titles(result.current.state)).toEqual(["Walk 10 minutes", "Jog 1 mile", "Jog 3 miles"]);
    expect(result.current.state.completedMilestoneIds).toHaveLength(2);
  });
});

describe("store: suggestNewPath with Plus", () => {
  it("the next AI plan replaces the path and clears its ticks; the one after that doesn't", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));
    await act(async () => mockRequests[0].resolve(plan("Run a 5K", aiPath("AI"), "Today idea")));

    await act(async () => result.current.suggestNewPath());
    expect(result.current.state.pathRefreshPending).toBe(true);
    expect(mockRequests).toHaveLength(2);
    await act(async () => mockRequests[1].resolve(plan("Run a 5K", aiPath("Fresh"), "Another idea")));

    expect(titles(result.current.state)).toEqual(["Fresh 1", "Fresh 2", "Fresh 3"]);
    expect(result.current.state.completedMilestoneIds).toEqual([]);
    expect(result.current.state.pendingMilestoneCelebration).toBeNull();
    expect(result.current.state.pathRefreshPending).toBe(false);

    // A later refresh is an ordinary one again: the new path stays.
    await act(async () => {
      void result.current.requestMomentumPlan();
    });
    await act(async () => mockRequests[2].resolve(plan("Run a 5K", aiPath("Later"), "Third idea")));
    expect(titles(result.current.state)).toEqual(["Fresh 1", "Fresh 2", "Fresh 3"]);
  });

  it("a failed request clears the flag and keeps the path, so the next daily refresh can't replace it", async () => {
    const { result } = await renderStore();
    await waitFor(() => expect(mockRequests).toHaveLength(1));
    await act(async () => mockRequests[0].resolve(plan("Run a 5K", aiPath("AI"), "Today idea")));

    await act(async () => result.current.suggestNewPath());
    await act(async () => mockRequests[1].reject(new MomentumAiError("network", "offline")));
    expect(result.current.state.pathRefreshPending).toBe(false);
    expect(titles(result.current.state)).toEqual(["Walk 10 minutes", "Jog 1 mile", "Jog 3 miles"]);
    expect(result.current.state.completedMilestoneIds).toHaveLength(2);

    await act(async () => {
      void result.current.requestMomentumPlan();
    });
    await act(async () => mockRequests[2].resolve(plan("Run a 5K", aiPath("Later"), "Third idea")));
    expect(titles(result.current.state)).toEqual(["Walk 10 minutes", "Jog 1 mile", "Jog 3 miles"]);
    expect(result.current.state.completedMilestoneIds).toHaveLength(2);
  });
});

describe("store: suggestNewPath without Plus", () => {
  it("goes back to the starter path for the goal, clears its ticks, and makes no AI request", async () => {
    mockPlus = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: true };
    const { result } = await renderStore({ plusGrandfathered: false });
    expect(result.current.hasPlus).toBe(false);

    await act(async () => result.current.suggestNewPath());
    expect(mockRequests).toHaveLength(0);
    expect(titles(result.current.state)).toEqual(["Start small", "Repeat the rhythm", expect.any(String)]);
    expect(result.current.state.momentumPlan?.milestones.map((m) => m.id)).toEqual([...MILESTONE_IDS]);
    expect(result.current.state.momentumPlan?.milestones[0].description).toContain("Run a 5K");
    expect(result.current.state.completedMilestoneIds).toEqual([]);
    expect(result.current.state.pathRefreshPending).toBeFalsy();
  });
});
