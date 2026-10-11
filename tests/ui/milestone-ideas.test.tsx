// "For your next milestone" in Ideas (1.4, PR #88) with the REAL store, AI
// client and screen; only the proxy's answer is faked. Which suggestions the
// group shows (the AI's or the built-in ones) as the path changes, what stays
// in the general list, the add rules, and the analytics event.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { IdeasSheet, type IdeaItem } from "@/components/daily-tasks/ideas-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import { localMilestoneIdeas, milestoneKey } from "@/lib/daily-tasks/milestone-ideas";
import { nextIncompleteMilestone } from "@/lib/daily-tasks/milestones";
import { MILESTONE_IDS, buildMilestones } from "@/lib/daily-tasks/momentum";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import {
  DEFAULT_AUTO_LOCK,
  DEFAULT_MOMENTUM_PROFILE,
  type AppState,
  type GeneratedTask,
  type MomentumMilestone,
  type MomentumPlan,
  type MomentumProfile,
  type Task,
} from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));
jest.mock("@/hooks/use-app-update", () => ({
  useAppUpdate: () => ({ update: null, dismiss: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/app-review", () => ({ requestAppReview: jest.fn(async () => false) }));
let mockEntitled = false;
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallBuild: true,
    paywallEnabled: true,
    entitlementActive: mockEntitled,
    entitlementKnown: true,
    openPaywall: jest.fn(() => true),
    paywallSource: null,
    purchaseCount: 0,
    winBackDue: false,
  }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
// The proxy: the plan route answers with `mockPlanAnswers` in turn; every
// other route is down. The app's own request code runs for real.
const mockPlanRequests: Record<string, unknown>[] = [];
const mockPlanAnswers: unknown[] = [];
jest.mock("@/lib/daily-tasks/ai-client", () => ({
  ...jest.requireActual("@/lib/daily-tasks/ai-client"),
  getMomentumAiProxyUrl: () => "https://proxy.test/api/momentum/plan",
  postToProxy: jest.fn(async ({ url, payload }: { url: string; payload: Record<string, unknown> }) => {
    if (url !== "https://proxy.test/api/momentum/plan") throw new Error("route down");
    mockPlanRequests.push(payload);
    const answer = mockPlanAnswers.shift();
    if (!answer) throw new Error("no answer queued");
    return answer;
  }),
}));
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
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

// Saturday 10 Oct 2026, 10 am local.
const NOW = new Date(2026, 9, 10, 10, 0);
const TODAY = "2026-10-10";
const THIS_MORNING = new Date(2026, 9, 10, 8, 0).toISOString();
const YESTERDAY = new Date(2026, 9, 9, 8, 0).toISOString();

const step = (id: string, title: string): MomentumMilestone => ({ id, title, description: "", completedAt: null });
const M1 = step(MILESTONE_IDS[0], "Run 1 km");
const M2 = step(MILESTONE_IDS[1], "Run 3 km");
const task = (id: string, text: string): Task => ({ id, text, createdAt: "", carriedOver: false });
const idea = (text: string, extra: Partial<GeneratedTask> = {}): GeneratedTask => ({
  id: `idea_${text}`,
  text,
  estimatedMinutes: 10,
  difficulty: "easy",
  reason: "",
  source: "ai",
  ...extra,
});
const IDEAS = ["Jog to the corner", "Lay out shoes", "Stretch calves"];

function plan(overrides: Partial<MomentumPlan>): MomentumPlan {
  return {
    id: "plan",
    goalTitle: "Run a 5K",
    generatedAt: THIS_MORNING,
    provider: "ai",
    pathSource: "ai",
    milestones: [M1, M2],
    taskPool: [],
    todaySuggestions: IDEAS.map((text) => idea(text)),
    promptSummary: "",
    version: 1,
    ...overrides,
  };
}
/** A plan made on this device: no AI, nothing marked. */
const templatePlan = (overrides: Partial<MomentumPlan> = {}) =>
  plan({
    provider: "template",
    pathSource: "user",
    todaySuggestions: IDEAS.map((text) => idea(text, { source: "template" })),
    ...overrides,
  });
/** What the proxy sends back: `marked` are the suggestions it says are for the milestone. */
const proxyAnswer = (marked: string[], milestoneTitles = ["Walk 10 minutes", "Walk 30 minutes", "Jog 1 km"]) => ({
  milestones: milestoneTitles.map((title) => ({ title, description: "" })),
  todaySuggestions: IDEAS.map((text) => ({
    text,
    estimatedMinutes: 10,
    difficulty: "easy",
    reason: "",
    ...(marked.includes(text) ? { forMilestone: true } : {}),
  })),
  taskPool: [],
});

let store: ReturnType<typeof useDailyTasks>;
function Probe() {
  store = useDailyTasks();
  return null;
}

/** Fake only the clock (local time), so RNTL's waits and the screen's timers still run. */
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

/** Open Today on Saturday morning with a save from earlier that morning. */
async function openToday(saved: Partial<AppState>, options: { plus?: boolean } = {}) {
  mockEntitled = options.plus === true;
  fakeClockAt(NOW);
  const state: AppState = {
    ...buildInitialState(new Date(2026, 9, 10, 7)),
    hasSeenOnboarding: true,
    plusGrandfathered: false,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    momentumProfile: PROFILE,
    tasks: [task("t0", "Read")],
    ...saved,
  };
  await AsyncStorage.setItem("daily-tasks/state/v1", JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  await render(
    <DailyTasksProvider>
      <Probe />
      <HomeScreen />
    </DailyTasksProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText(/^Task 1: |Add a task, slot 1/)).toBeOnTheScreen());
}

async function openIdeas() {
  await fireEvent.press(screen.getByTestId("need-ideas"));
  await waitFor(() => expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen());
}

const labelOf = (node: { props: Record<string, unknown> }) => node.props.accessibilityLabel as string;
const ideaText = (label: string) => label.replace(/^Add /, "").replace(/, added$/, "");
/** The suggestions in the milestone group, in order. */
const groupTexts = () => screen.queryAllByTestId(/^milestone-idea-/).map((node) => ideaText(labelOf(node)));
/** The milestone the group is for, or null when there is no group. */
const groupTitle = () => {
  const title = screen.queryByTestId("milestone-ideas-title");
  return title ? (title.props.children as string) : null;
};
/** Which of `candidates` are listed below the group, as general ideas. */
const generalTexts = (candidates: string[] = IDEAS) =>
  candidates.filter((text) =>
    within(screen.getByTestId("ideas-sheet"))
      .queryAllByRole("button", { name: new RegExp(`^(Add ${text}|${text}, added)$`) })
      .some((node) => !/^milestone-idea-/.test(String(node.props.testID ?? ""))),
  );
const builtIn = (milestone: MomentumMilestone) =>
  localMilestoneIdeas(milestone, TODAY)
    .slice(0, 2)
    .map((line) => line.text);
const todayTaskNames = () =>
  screen
    .queryAllByRole("checkbox")
    .map(labelOf)
    .filter((label) => /^Task \d: /.test(label ?? ""))
    .map((label) => label.replace(/^Task \d: /, ""));
/** The general ideas the store has for today (a free plan is rebuilt on this device at launch). */
const planIdeaTexts = () => (store.state.momentumPlan?.todaySuggestions ?? []).map((item) => item.text);
const milestoneEvents = () => (track as jest.Mock).mock.calls.filter(([name]) => name === "milestone_idea_added");

let announce: jest.SpyInstance;
beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  (track as jest.Mock).mockClear();
  mockPlanRequests.length = 0;
  mockPlanAnswers.length = 0;
  mockEntitled = false;
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});

afterEach(() => {
  announce.mockRestore();
  jest.useRealTimers();
});

describe("milestone suggestions: free (built-in, nothing sent)", () => {
  it("shows two built-in lines for the next open milestone; the general ideas stay as they were", async () => {
    await openToday({ momentumPlan: templatePlan(), completedMilestoneIds: [M1.id] });
    await openIdeas();
    expect(screen.getByLabelText("For your next milestone: Run 3 km")).toBeOnTheScreen();
    expect(groupTexts()).toEqual(builtIn(M2));
    for (const text of groupTexts()) expect(text).toContain("“Run 3 km”");
    // Built on this device, and the path is still the user's.
    expect(store.state.momentumPlan?.provider).toBe("template");
    expect(planIdeaTexts()).toHaveLength(3);
    expect(generalTexts(planIdeaTexts())).toEqual(planIdeaTexts());
    expect(mockPlanRequests).toEqual([]);
  });

  it.each([
    ["there is no goal path", { momentumPlan: null, momentumProfile: DEFAULT_MOMENTUM_PROFILE }],
    ["every milestone is reached", { momentumPlan: templatePlan(), completedMilestoneIds: [M1.id, M2.id] }],
  ])("no group when %s", async (_label, saved) => {
    await openToday(saved as Partial<AppState>);
    await openIdeas();
    expect(nextIncompleteMilestone(store.state.momentumPlan?.milestones ?? [], store.state.completedMilestoneIds)).toBeNull();
    expect(screen.queryByTestId("milestone-ideas")).toBeNull();
    expect(groupTexts()).toEqual([]);
  });

  it("adding one puts it on today, shows it as added, and records only that a built-in one was added", async () => {
    await openToday({ momentumPlan: templatePlan() });
    await openIdeas();
    const [first, second] = builtIn(M1);
    await fireEvent.press(screen.getByRole("button", { name: `Add ${first}` }));
    expect(todayTaskNames()).toEqual(["Read", first]);
    expect(screen.getByRole("button", { name: `${first}, added` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Add ${second}` })).toBeEnabled();
    // The kind only: never the milestone or the task's words.
    expect(milestoneEvents()).toEqual([["milestone_idea_added", { source: "local" }]]);

    // Tapping the added row again adds and records nothing.
    await fireEvent.press(screen.getByRole("button", { name: `${first}, added` }));
    expect(todayTaskNames()).toEqual(["Read", first]);
    expect(milestoneEvents()).toHaveLength(1);
  });

  it("a general idea added from the list below is not a milestone add", async () => {
    await openToday({ momentumPlan: templatePlan() });
    await openIdeas();
    const general = planIdeaTexts()[0];
    await fireEvent.press(screen.getByRole("button", { name: `Add ${general}` }));
    expect(todayTaskNames()).toEqual(["Read", general]);
    expect(milestoneEvents()).toEqual([]);
  });

  it("the last free slot: the add lands once and is recorded once, and the other row is then off", async () => {
    await openToday({ momentumPlan: templatePlan(), tasks: [task("t0", "Read"), task("t1", "Walk")] });
    await openIdeas();
    const [first, second] = builtIn(M1);
    await fireEvent.press(screen.getByRole("button", { name: `Add ${first}` }));
    expect(todayTaskNames()).toEqual(["Read", "Walk", first]);
    expect(screen.getByRole("button", { name: `Add ${second}` })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: `Add ${second}` }));
    expect(todayTaskNames()).toHaveLength(3);
    expect(milestoneEvents()).toEqual([["milestone_idea_added", { source: "local" }]]);
  });

  // KNOWN BUG (PR #88, app/(tabs)/index.tsx onAddMilestoneIdea): the guard reads
  // this render's slots and tasks, so a second tap before the redraw is counted
  // although the store refuses it (today is full). Routines got the same fix in
  // PR #86. `it.failing` passes while the bug is there: when it is fixed this
  // test fails, and `.failing` comes off.
  it.failing("a double tap on the last free slot adds once and records once", async () => {
    await openToday({ momentumPlan: templatePlan(), tasks: [task("t0", "Read"), task("t1", "Walk")] });
    await openIdeas();
    const [first] = builtIn(M1);
    const add = screen.getByRole("button", { name: `Add ${first}` });
    // Both taps before React re-renders.
    await act(async () => {
      fireEvent.press(add);
      fireEvent.press(add);
    });
    expect(todayTaskNames()).toEqual(["Read", "Walk", first]);
    expect(milestoneEvents()).toEqual([["milestone_idea_added", { source: "local" }]]);
  });
});

describe("milestone suggestions: Plus (the AI's, marked by the proxy)", () => {
  /** Yesterday's AI plan is saved, so today's fetch runs; the proxy marks `marked`. */
  async function openWithTodaysPlan(marked: string[], saved: Partial<AppState> = {}) {
    mockPlanAnswers.push(proxyAnswer(marked));
    await openToday({ momentumPlan: plan({ generatedAt: YESTERDAY }), ...saved }, { plus: true });
    await waitFor(() => expect(store.state.momentumPlan?.generatedAt).not.toBe(YESTERDAY));
  }

  it("asks for the next open milestone, groups what the proxy marked, and lists the rest below", async () => {
    await openWithTodaysPlan(["Lay out shoes"], { completedMilestoneIds: [M1.id] });
    expect(mockPlanRequests).toHaveLength(1);
    expect(mockPlanRequests[0].nextMilestone).toEqual({ title: "Run 3 km" });
    // The path is the user's: kept, so the mark still names their next step.
    expect(store.state.momentumPlan?.milestones.map((m) => m.title)).toEqual(["Run 1 km", "Run 3 km"]);

    await openIdeas();
    expect(groupTitle()).toBe("Run 3 km");
    expect(groupTexts()).toEqual(["Lay out shoes"]);
    expect(generalTexts()).toEqual(["Jog to the corner", "Stretch calves"]);
  });

  it("shows at most two in the group; the third stays a general idea", async () => {
    await openWithTodaysPlan(IDEAS);
    await openIdeas();
    expect(groupTexts()).toEqual(["Jog to the corner", "Lay out shoes"]);
    expect(generalTexts()).toEqual(["Stretch calves"]);
  });

  it("Add all adds the general ideas only, and is not a milestone add", async () => {
    await openWithTodaysPlan(["Jog to the corner"]);
    await openIdeas();
    await fireEvent.press(screen.getByRole("button", { name: "Add all ideas" }));
    expect(todayTaskNames()).toEqual(["Read", "Lay out shoes", "Stretch calves"]);
    expect(milestoneEvents()).toEqual([]);
    // Today is full now: the milestone suggestion can't be added.
    expect(screen.getByRole("button", { name: "Add Jog to the corner" })).toBeDisabled();
  });

  it("adding the AI's suggestion records source ai, with nothing else", async () => {
    await openWithTodaysPlan(["Jog to the corner"]);
    await openIdeas();
    await fireEvent.press(screen.getByRole("button", { name: "Add Jog to the corner" }));
    expect(todayTaskNames()).toEqual(["Read", "Jog to the corner"]);
    expect(screen.getByRole("button", { name: "Jog to the corner, added" })).toBeDisabled();
    expect(milestoneEvents()).toEqual([["milestone_idea_added", { source: "ai" }]]);
  });

  it("no marks from the proxy (an older one): built-in lines, every AI idea in the general list", async () => {
    await openWithTodaysPlan([]);
    await openIdeas();
    expect(groupTexts()).toEqual(builtIn(M1));
    expect(generalTexts()).toEqual(IDEAS);
  });

  it("reaching the milestone moves the group to the next one; the AI's idea goes back to the general list", async () => {
    await openWithTodaysPlan(["Jog to the corner"]);
    await act(async () => store.completeMilestone(M1.id));
    await openIdeas();
    expect(groupTitle()).toBe("Run 3 km");
    expect(groupTexts()).toEqual(builtIn(M2));
    expect(generalTexts()).toEqual(IDEAS);
    await fireEvent.press(screen.getByRole("button", { name: `Add ${builtIn(M2)[0]}` }));
    expect(milestoneEvents()).toEqual([["milestone_idea_added", { source: "local" }]]);
  });

  it("editing the milestone's title drops the AI's idea for the old wording", async () => {
    await openWithTodaysPlan(["Jog to the corner"]);
    await act(async () =>
      store.editMilestones([
        { id: M1.id, title: "Swim 10 lengths" },
        { id: M2.id, title: M2.title },
      ]),
    );
    await openIdeas();
    expect(groupTitle()).toBe("Swim 10 lengths");
    expect(groupTexts()).toEqual(builtIn(step(M1.id, "Swim 10 lengths")));
    expect(generalTexts()).toEqual(IDEAS);
  });

  it("a fresh path: the request names no milestone, and the new first step gets built-in lines", async () => {
    await openWithTodaysPlan(["Jog to the corner"]);
    // Even if this answer carried a mark, it was not asked for.
    mockPlanAnswers.push(proxyAnswer(["Jog to the corner"], ["Swim 10 lengths", "Swim 20 lengths", "Swim 1 km"]));
    await act(async () => store.suggestNewPath());
    await waitFor(() => expect(store.state.momentumPlan?.milestones[0].title).toBe("Swim 10 lengths"));
    expect(mockPlanRequests).toHaveLength(2);
    expect(mockPlanRequests[1].newPath).toBe(true);
    expect(mockPlanRequests[1]).not.toHaveProperty("nextMilestone");

    await openIdeas();
    const first = store.state.momentumPlan!.milestones[0];
    expect(first.id).toBe(M1.id);
    expect(groupTitle()).toBe("Swim 10 lengths");
    expect(groupTexts()).toEqual(builtIn(first));
    expect(generalTexts()).toEqual(IDEAS);
  });

  it("a starter path upgraded to the AI's path: the mark was for the old first step, so built-in lines", async () => {
    const starter = buildMilestones("Run a 5K");
    mockPlanAnswers.push(proxyAnswer(["Jog to the corner"]));
    await openToday(
      { momentumPlan: templatePlan({ pathSource: "template", milestones: starter, generatedAt: YESTERDAY }) },
      { plus: true },
    );
    await waitFor(() => expect(store.state.momentumPlan?.provider).toBe("ai"));
    expect(mockPlanRequests[0].nextMilestone).toMatchObject({ title: starter[0].title });
    // The plan carries the mark for the starter step it was asked about...
    expect(store.state.momentumPlan?.todaySuggestions[0].milestoneKey).toBe(milestoneKey(starter[0]));
    // ...but the path is now the AI's.
    expect(store.state.momentumPlan?.milestones[0]).toMatchObject({ id: starter[0].id, title: "Walk 10 minutes" });

    await openIdeas();
    expect(groupTitle()).toBe("Walk 10 minutes");
    expect(groupTexts()).toEqual(builtIn(store.state.momentumPlan!.milestones[0]));
    expect(generalTexts()).toEqual(IDEAS);
  });
});

describe("IdeasSheet: the milestone group's rules", () => {
  const ideas: IdeaItem[] = [{ id: "a", text: "Walk 20 minutes", estimatedMinutes: 20 }];
  const group = {
    title: "Run 3 km",
    ideas: [
      { id: "m_a", text: "Jog to the corner", estimatedMinutes: 10 },
      { id: "m_b", text: "Spend 15 minutes on “Run 3 km”", estimatedMinutes: 15 },
    ],
  };
  const props = () => ({
    visible: true,
    onClose: jest.fn(),
    goalTitle: "Run a 5K",
    source: { personalized: true, label: "Made for your goal" },
    ideas,
    addedTexts: new Set<string>(),
    remainingSlots: 2,
    adaptationReason: null,
    canRegenerate: true,
    regenerating: false,
    failureMessage: null,
    onAdd: jest.fn(),
    onAddAll: jest.fn(),
    onRegenerate: jest.fn(),
    milestoneGroup: group,
    onAddMilestoneIdea: jest.fn(),
  });
  const rows = () => screen.getAllByTestId(/^milestone-idea-/);

  it("with room: each row adds through the milestone handler, with its minutes shown", async () => {
    const p = props();
    await render(<IdeasSheet {...p} />);
    expect(screen.getByRole("header", { name: "For your next milestone: Run 3 km" })).toBeOnTheScreen();
    expect(within(rows()[1]).getByText("15 min")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Add Jog to the corner" }));
    expect(p.onAddMilestoneIdea).toHaveBeenCalledWith("Jog to the corner");
    expect(p.onAdd).not.toHaveBeenCalled();
  });

  it.each([
    ["today is full", { remainingSlots: 0 }],
    ["today is set", { locked: true }],
  ])("when %s every row is off and a tap adds nothing", async (_label, overrides) => {
    const p = props();
    await render(<IdeasSheet {...p} {...overrides} />);
    expect(rows()).toHaveLength(2);
    for (const row of rows()) {
      expect(row).toBeDisabled();
      await fireEvent.press(row);
    }
    expect(p.onAddMilestoneIdea).not.toHaveBeenCalled();
    expect(p.onAdd).not.toHaveBeenCalled();
  });

  it("one already on today's list (any case) shows as added and is off; the other can still be added", async () => {
    const p = props();
    await render(<IdeasSheet {...p} addedTexts={new Set(["jog to the corner"])} />);
    const added = screen.getByRole("button", { name: "Jog to the corner, added" });
    expect(added).toBeDisabled();
    await fireEvent.press(added);
    expect(p.onAddMilestoneIdea).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add Spend 15 minutes on “Run 3 km”" })).toBeEnabled();
  });

  it("no group in the Saved for later view, or with nothing to suggest", async () => {
    const { rerender } = await render(<IdeasSheet {...props()} savedOnly />);
    expect(screen.queryByTestId("milestone-ideas")).toBeNull();
    await rerender(<IdeasSheet {...props()} milestoneGroup={{ title: "Run 3 km", ideas: [] }} />);
    expect(screen.queryByTestId("milestone-ideas")).toBeNull();
    await rerender(<IdeasSheet {...props()} milestoneGroup={null} />);
    expect(screen.queryByTestId("milestone-ideas")).toBeNull();
  });
});
