// 1.5 A on Today: how first run ends for each path (steps -> onFinish ->
// the record, the toast, VoiceOver, no paywall), the nudge card and widget tip
// wiring, and Unlock on the status line. Mock store, local-time fixtures.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Alert, Platform, type AlertButton } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { track } from "@/lib/daily-tasks/analytics";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { FIRST_DAYS_KEY, saveFirstDays, startFirstDays } from "@/lib/daily-tasks/first-days";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, NotificationPermissionState, Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

type MockStore = ReturnType<typeof makeStore>;
let mockStore: MockStore;

jest.mock("@/lib/daily-tasks/store", () => ({ useDailyTasks: () => mockStore }));
jest.mock("@/hooks/use-app-update", () => ({
  useAppUpdate: () => ({ update: null, dismiss: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/app-review", () => ({ requestAppReview: jest.fn(async () => true) }));
jest.mock("@/lib/daily-tasks/ai-helpers", () => ({
  ...jest.requireActual("@/lib/daily-tasks/ai-helpers"),
  sortBrainDump: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/announce", () => ({ announcePolitely: jest.fn() }));
const mockOpenPaywall = jest.fn(() => true);
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallEnabled: true, openPaywall: mockOpenPaywall, paywallSource: null, purchaseCount: 0 }),
}));
jest.mock("@/components/daily-tasks/rollover-modal", () => ({ RolloverModal: () => null }));

const TODAY = "2026-09-26";
const originalOS = Platform.OS;

function makeStore(overrides: Partial<AppState> = {}, extra: Record<string, unknown> = {}) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 8, 26)),
    hasSeenOnboarding: true,
    reorderHintSeen: true,
    ...overrides,
  };
  const completed = state.todayCompletions.filter((id) => state.tasks.some((t) => t.id === id));
  return {
    ready: true,
    state,
    today: TODAY,
    completedCount: completed.length,
    remainingSlots: 3 - state.tasks.length,
    isCompleted: (id: string) => state.todayCompletions.includes(id),
    addTask: jest.fn(),
    addTasks: jest.fn(),
    addSuggestions: jest.fn((texts: string[]) => texts.length),
    editTask: jest.fn(),
    deleteTask: jest.fn(),
    notToday: jest.fn(),
    moveTask: jest.fn(),
    makeTaskNext: jest.fn(),
    markReorderHintSeen: jest.fn(),
    toggleTask: jest.fn(),
    lockToday: jest.fn(),
    unlockToday: jest.fn(() => true),
    noteOpenEdit: jest.fn(),
    resolveRollover: jest.fn(),
    markOnboardingSeen: jest.fn(),
    requestNotificationPermission: jest.fn(async (): Promise<NotificationPermissionState> => "granted"),
    notificationPermission: "undetermined" as NotificationPermissionState,
    setNotificationsEnabled: jest.fn(),
    setNotificationEnabled: jest.fn(),
    completeMomentumOnboarding: jest.fn(),
    setTodayReflection: jest.fn(),
    setTodayReflectionResult: jest.fn(),
    requestMomentumPlan: jest.fn(async () => {}),
    journeyLevel: 1,
    markReviewPrompted: jest.fn(),
    markReviewDue: jest.fn(),
    clearReviewDue: jest.fn(),
    plusConfirmed: true,
    plusPending: false,
    daysShowedUp: 0,
    setEveningClose: jest.fn(),
    applyTomorrowDraft: jest.fn(),
    dismissTomorrowDraft: jest.fn(),
    claimCoachRequest: jest.fn(),
    setCoachNotes: jest.fn(),
    markCoachNoteLogged: jest.fn(),
    parkTasks: jest.fn(),
    removeParkedTask: jest.fn(),
    addParkedTask: jest.fn(),
    setTaskSteps: jest.fn(),
    toggleTaskStep: jest.fn(),
    clearTaskSteps: jest.fn(),
    hasPlus: false,
    ...extra,
  };
}

const button = (name: string) => screen.getByRole("button", { name });
const tasks = (...texts: string[]): Task[] =>
  texts.map((text, i) => ({ id: `t${i}`, text, createdAt: "", carriedOver: false }));
const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await act(async () => {});
};
const storedRecord = async () => JSON.parse((await AsyncStorage.getItem(FIRST_DAYS_KEY)) ?? "null");
const completedEvents = () =>
  (track as jest.Mock).mock.calls.filter(([name]) => name === "onboarding_completed").map(([, props]) => props);
const cardEvents = () =>
  (track as jest.Mock).mock.calls.filter(([name]) => name === "first_days_card").map(([, props]) => props);

async function dump(text: string) {
  await fireEvent.changeText(screen.getByLabelText("What's on your mind today"), text);
  await fireEvent.press(button("Pick my three"));
}

let announce: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  Platform.OS = "ios";
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  (sortBrainDump as jest.Mock).mockResolvedValue({
    result: { picks: ["Walk", "Call mum", "Report"], parked: ["Groceries"], source: "ai" },
    notice: null,
  });
});

afterEach(() => {
  Platform.OS = originalOS;
  announce.mockRestore();
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("first run ends (1.5): each path", () => {
  it("'I'll add my own': ends at once, writes the cards' record, says nothing, no paywall", async () => {
    mockStore = makeStore({ hasSeenOnboarding: false });
    await render(<HomeScreen />);
    await fireEvent.press(button("I'll add my own"));
    expect(screen.queryByTestId(/^first-run-/)).toBeNull();
    expect(mockStore.markOnboardingSeen).toHaveBeenCalledTimes(1);
    expect(mockStore.addTasks).not.toHaveBeenCalled();
    expect(completedEvents()).toEqual([{ source: "own", count: 0 }]);
    await waitFor(async () =>
      expect(await storedRecord()).toEqual({ nudgeFrom: TODAY, nudgeDeclines: 0, widgetTip: "waiting" }),
    );
    expect(screen.queryByTestId("today-toast")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/picked/));
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("a dump with nothing to pick: keeps it all in Ideas, ends first run, no 'picked' note, no paywall", async () => {
    (sortBrainDump as jest.Mock).mockResolvedValue({
      result: { picks: [], parked: ["Note to self"], source: "ai" },
      notice: null,
    });
    mockStore = makeStore({ hasSeenOnboarding: false });
    await render(<HomeScreen />);
    await dump("note to self");
    expect(screen.queryByTestId(/^first-run-/)).toBeNull();
    expect(mockStore.addTasks).not.toHaveBeenCalled();
    expect(mockStore.parkTasks).toHaveBeenCalledWith(["Note to self"]);
    expect(mockStore.markOnboardingSeen).toHaveBeenCalledTimes(1);
    expect(completedEvents()).toEqual([{ source: "own", count: 0 }]);
    await waitFor(async () => expect((await storedRecord())?.nudgeFrom).toBe(TODAY));
    expect(screen.queryByTestId("today-toast")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(announce.mock.calls.map(([text]) => text)).toEqual(["Picking your three"]);
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("using the picks: a double tap ends first run once; the toast and VoiceOver say 'Your three are picked.'", async () => {
    mockStore = makeStore({ hasSeenOnboarding: false });
    await render(<HomeScreen />);
    await dump("walk, call mum, report");
    const use = button("Use these three");
    await act(async () => {
      void fireEvent.press(use);
      void fireEvent.press(use);
    });
    expect(mockStore.addTasks).toHaveBeenCalledTimes(1);
    expect(mockStore.addTasks).toHaveBeenCalledWith(["Walk", "Call mum", "Report"]);
    expect(mockStore.parkTasks).toHaveBeenCalledWith(["Groceries"]);
    expect(mockStore.markOnboardingSeen).toHaveBeenCalledTimes(1);
    expect(completedEvents()).toEqual([{ source: "dump", count: 3 }]);
    expect(screen.getByTestId("today-toast")).toHaveTextContent(/Your three are picked\.$/);
    // VoiceOver hears it a moment later, so the closing screen doesn't cut it off.
    await waitFor(() => expect(announce).toHaveBeenCalledWith("Your three are picked."));
    expect(announce.mock.calls.filter(([text]) => text === "Your three are picked.")).toHaveLength(1);
    expect(await storedRecord()).toEqual({ nudgeFrom: TODAY, nudgeDeclines: 0, widgetTip: "waiting" });
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("two picks, and one pick, are named as they are", async () => {
    mockStore = makeStore({ hasSeenOnboarding: false });
    await render(<HomeScreen />);
    await dump("walk, call mum, report");
    await fireEvent.press(screen.getByRole("checkbox", { name: "Report" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Call mum" }));
    await fireEvent.press(button("Use this one"));
    expect(screen.getByTestId("today-toast")).toHaveTextContent(/Your one for today is picked\.$/);
    expect(completedEvents()).toEqual([{ source: "dump", count: 1 }]);
  });

  it("a relaunch with tasks already on today finishes without asking, counts them, and says nothing", async () => {
    mockStore = makeStore({ hasSeenOnboarding: false, tasks: tasks("Walk", "Swim") });
    await render(<HomeScreen />);
    expect(screen.queryByTestId(/^first-run-/)).toBeNull();
    expect(sortBrainDump).not.toHaveBeenCalled();
    expect(mockStore.markOnboardingSeen).toHaveBeenCalledTimes(1);
    expect(mockStore.addTasks).not.toHaveBeenCalled();
    expect(completedEvents()).toEqual([{ source: "dump", count: 2 }]);
    await waitFor(async () => expect((await storedRecord())?.nudgeFrom).toBe(TODAY));
    expect(screen.queryByTestId("today-toast")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(announce).not.toHaveBeenCalled();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("once first run has ended, the nudge card appears on Today (and was not asked about before)", async () => {
    mockStore = makeStore({ hasSeenOnboarding: false });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(button("I'll add my own"));
    expect(mockStore.requestNotificationPermission).not.toHaveBeenCalled();
    // The store marks onboarding seen; Today re-renders.
    mockStore = makeStore({ hasSeenOnboarding: true });
    await rerender(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("nudge-card")).toBeOnTheScreen());
    expect(cardEvents()).toEqual([{ kind: "nudge", action: "shown" }]);
  });
});

describe("Today cards", () => {
  const record = (over = {}) => saveFirstDays({ ...startFirstDays(TODAY), ...over });

  it("Yes while allowed turns reminders and the morning reminder on", async () => {
    await record();
    mockStore = makeStore();
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId("nudge-card-yes"));
    expect(mockStore.requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(mockStore.setNotificationsEnabled).toHaveBeenCalledWith(true);
    expect(mockStore.setNotificationEnabled).toHaveBeenCalledWith("morning", true);
    await waitFor(() => expect(screen.queryByTestId("nudge-card")).toBeNull());
    expect(cardEvents()).toContainEqual({ kind: "nudge", action: "yes", outcome: "granted" });
  });

  it.each(["denied", "undetermined"] as const)("Yes turns nothing on when iOS answers %s", async (answer) => {
    await record();
    mockStore = makeStore({}, { requestNotificationPermission: jest.fn(async () => answer) });
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId("nudge-card-yes"));
    await waitFor(() => expect(screen.queryByTestId("nudge-card")).toBeNull());
    expect(mockStore.setNotificationsEnabled).not.toHaveBeenCalled();
    expect(mockStore.setNotificationEnabled).not.toHaveBeenCalled();
    expect(cardEvents()).toContainEqual({ kind: "nudge", action: "yes", outcome: answer });
  });

  it("Not now never asks iOS or turns anything on", async () => {
    await record();
    mockStore = makeStore();
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId("nudge-card-not-now"));
    expect(screen.queryByTestId("nudge-card")).toBeNull();
    expect(mockStore.requestNotificationPermission).not.toHaveBeenCalled();
    expect(mockStore.setNotificationsEnabled).not.toHaveBeenCalled();
    expect(await storedRecord()).toMatchObject({ nudgeFrom: "2026-09-29", nudgeDeclines: 1 });
  });

  it.each(["granted", "denied"] as const)("no nudge card when notifications are already %s", async (permission) => {
    await record();
    mockStore = makeStore({}, { notificationPermission: permission });
    await render(<HomeScreen />);
    await flush();
    expect(screen.queryByTestId("nudge-card")).toBeNull();
  });

  it("an install that updated from 1.4 (no record) sees neither card, even on a finished day", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk", "Stretch", "Hydrate"),
      todayCompletions: ["t0", "t1", "t2"],
    });
    await render(<HomeScreen />);
    await flush();
    expect(screen.queryByTestId("nudge-card")).toBeNull();
    expect(screen.queryByTestId("widget-tip")).toBeNull();
    expect(cardEvents()).toEqual([]);
    expect(await AsyncStorage.getItem(FIRST_DAYS_KEY)).toBeNull();
  });

  it("no card is behind first run", async () => {
    await record();
    mockStore = makeStore({ hasSeenOnboarding: false });
    await render(<HomeScreen />);
    await flush();
    expect(screen.getByTestId("first-run-dump")).toBeOnTheScreen();
    expect(screen.queryByTestId("nudge-card")).toBeNull();
  });

  it("the widget tip comes after the first finished day (not while the nudge is up), on iOS only", async () => {
    const finished = { tasks: tasks("Walk", "Stretch", "Hydrate"), todayCompletions: ["t0", "t1", "t2"] };
    await record();
    mockStore = makeStore(finished);
    const { rerender } = await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("nudge-card")).toBeOnTheScreen());
    expect(screen.queryByTestId("widget-tip")).toBeNull();

    mockStore = makeStore(finished, { notificationPermission: "granted" });
    await rerender(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("widget-tip")).toBeOnTheScreen());
    expect(screen.queryByTestId("nudge-card")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Dismiss widget tip" }));
    expect(screen.queryByTestId("widget-tip")).toBeNull();
    expect((await storedRecord()).widgetTip).toBe("done");
  });

  it("no widget tip on Android, finished day or not", async () => {
    Platform.OS = "android";
    await record({ nudgeFrom: null });
    mockStore = makeStore(
      { tasks: tasks("Walk", "Stretch", "Hydrate"), todayCompletions: ["t0", "t1", "t2"] },
      { notificationPermission: "granted" },
    );
    await render(<HomeScreen />);
    await flush();
    expect(screen.queryByTestId("widget-tip")).toBeNull();
  });
});

describe("Unlock on Today's status line (1.5)", () => {
  const MANUAL = { todayLocked: true, todayLockSource: "manual" as const };
  const AUTO = {
    todayLocked: true,
    todayLockSource: "auto" as const,
    // Local noon: reads "12:00 PM" in every time zone.
    todayLockedAt: new Date(2026, 8, 26, 12, 0).toISOString(),
  };
  const dayEvents = () => (track as jest.Mock).mock.calls.filter(([name]) => name === "day_unlocked");
  let alert: jest.SpyInstance;

  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => alert.mockRestore());

  async function openUnlock() {
    const line = screen.getByTestId("status-line");
    await fireEvent.press(within(line).getByRole("button", { name: "Unlock today" }));
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
    return { title, message, buttons };
  }

  it("a day locked automatically says when, in the line and in the dialog; Unlock is preferred, Keep locked cancels", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), ...AUTO });
    await render(<HomeScreen />);
    expect(within(screen.getByTestId("status-line")).getByText("Locked automatically at 12:00 PM. 1 to go.")).toBeOnTheScreen();
    const { title, message, buttons } = await openUnlock();
    expect(title).toBe("Unlock today?");
    expect(message).toBe("Today was locked automatically at 12:00 PM. Unlocking keeps it open for the rest of today.");
    expect(buttons.map(({ text, style, isPreferred }) => ({ text, style, isPreferred: isPreferred ?? false }))).toEqual([
      { text: "Keep locked", style: "cancel", isPreferred: false },
      { text: "Unlock", style: "default", isPreferred: true },
    ]);
  });

  it("Unlock unlocks once, tracks day_unlocked {source: today} once, shows the note and says it", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), ...MANUAL });
    await render(<HomeScreen />);
    const { buttons } = await openUnlock();
    expect(mockStore.unlockToday).not.toHaveBeenCalled();
    expect(dayEvents()).toEqual([]);
    await act(async () => buttons.find((b) => b.text === "Unlock")?.onPress?.());
    expect(mockStore.unlockToday).toHaveBeenCalledTimes(1);
    expect(dayEvents()).toEqual([["day_unlocked", { source: "today" }]]);
    expect(screen.getByTestId("today-toast")).toHaveTextContent(/Today is unlocked\.$/);
    expect(announcePolitely).toHaveBeenCalledTimes(1);
    expect(announcePolitely).toHaveBeenCalledWith("Today is unlocked.");
  });

  it("Keep locked does nothing", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), ...MANUAL });
    await render(<HomeScreen />);
    const { buttons } = await openUnlock();
    await act(async () => buttons.find((b) => b.text === "Keep locked")?.onPress?.());
    expect(mockStore.unlockToday).not.toHaveBeenCalled();
    expect(dayEvents()).toEqual([]);
    expect(announcePolitely).not.toHaveBeenCalled();
    expect(screen.queryByTestId("today-toast")).toBeNull();
  });

  it("an Unlock that unlocked nothing (the alert sat open past midnight) isn't tracked, shown or said", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), ...MANUAL }, { unlockToday: jest.fn(() => false) });
    await render(<HomeScreen />);
    const { buttons } = await openUnlock();
    await act(async () => buttons.find((b) => b.text === "Unlock")?.onPress?.());
    expect(mockStore.unlockToday).toHaveBeenCalledTimes(1);
    expect(dayEvents()).toEqual([]);
    expect(announcePolitely).not.toHaveBeenCalled();
    expect(screen.queryByTestId("today-toast")).toBeNull();
  });
});
