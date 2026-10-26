// PR #110 review fixes for the Sunday reset (1.6 H), with the real store,
// provider, card and sheet: finishing after midnight, the reminder's gate
// and Plus lapsing, Monday end to end (reset → morning copy → Use), Saved
// for later's cap, the notification tap, the sort's timeout, stepping aside
// and going to the background mid-dump. Local-time fixtures (25 Oct 2026 is
// a Sunday).
import type { ReactNode } from "react";
import { AppState as RNAppState, Pressable, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { SundayResetCard } from "@/components/daily-tasks/sunday-reset-card";
import { SundayResetProvider, useSundayReset } from "@/components/daily-tasks/sunday-reset-provider";
import { toDateKey } from "@/lib/daily-tasks/date";
import { requestBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { syncNotifications } from "@/lib/daily-tasks/notifications";
import type { ReminderContext, ReminderPlan } from "@/lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { SUNDAY_RESET_KIND, WEEK_SORT_TIMEOUT_MS } from "@/lib/daily-tasks/sunday-reset";
import { DEFAULT_AUTO_LOCK, MAX_PARKED_TASKS, type AppState, type DayRecord } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const mockResponseListeners: ((response: unknown) => void)[] = [];
jest.mock("expo-notifications", () => ({
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn((listener: (response: unknown) => void) => {
    mockResponseListeners.push(listener);
    return { remove: () => {} };
  }),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));
jest.mock("@/lib/daily-tasks/notifications", () => ({
  ...jest.requireActual("@/lib/daily-tasks/notifications"),
  syncNotifications: jest.fn(async () => {}),
}));
const mockPlus = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: true,
  entitlementKnown: true,
  paywallSource: null as string | null,
  purchaseCount: 0,
  winBackDue: false,
};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: jest.fn(() => true) }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/ai-helpers", () => ({
  ...jest.requireActual("@/lib/daily-tasks/ai-helpers"),
  requestBrainDump: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: jest.fn(() => null),
}));

const proxyUrl = getMomentumAiProxyUrl as jest.Mock;
const brainDump = requestBrainDump as jest.Mock;
const sync = syncNotifications as jest.Mock;

const KEY = "daily-tasks/state/v1";
const SUNDAY_6PM = new Date(2026, 9, 25, 18, 0);

function fakeClockAt(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
}

const dayRecord = (date: string, total: number, completed: number): DayRecord => ({
  date,
  total,
  completed,
  locked: false,
  lockSource: null,
  tasks: [],
  reflection: null,
  reflectionResult: null,
});

let latest: ReturnType<typeof useDailyTasks>;
let reset: ReturnType<typeof useSundayReset>;
function Probe(): ReactNode {
  latest = useDailyTasks();
  reset = useSundayReset();
  return (
    <Pressable testID="step-aside" onPress={() => reset.stepAside()}>
      <Text>{reset.isOpen ? "open" : "closed"}</Text>
    </Pressable>
  );
}
const tree = () => (
  <DailyTasksProvider>
    <SundayResetProvider>
      <Probe />
      <SundayResetCard firstRunActive={false} />
    </SundayResetProvider>
  </DailyTasksProvider>
);

async function open(at: Date, saved: Partial<AppState> = {}, earlier = true) {
  fakeClockAt(at);
  const before = toDateKey(new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1));
  const state: AppState = {
    ...buildInitialState(at),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    history: earlier ? { [before]: dayRecord(before, 3, 2) } : {},
    ...saved,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  const view = await render(tree());
  await waitFor(() => expect(latest.ready).toBe(true));
  return view;
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const parkedTexts = () => latest.state.parkedTasks.map((item) => item.text);
const parked = (texts: string[]) =>
  texts.map((text, i) => ({ id: `p${i}`, text, parkedAt: new Date(2026, 9, 20, 9, 0).toISOString() }));

async function toThree(dump: string) {
  await press("sunday-reset-start");
  await waitFor(() => expect(screen.getByTestId("sunday-reset-wins")).toBeOnTheScreen());
  await press("sunday-reset-next");
  await waitFor(() => expect(screen.getByTestId("sunday-reset-dump")).toBeOnTheScreen());
  await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), dump);
  await press("sunday-reset-sort");
  await waitFor(() => expect(screen.getByTestId("sunday-reset-set")).toBeOnTheScreen());
}

/** What the store last asked the scheduler for, planned as the scheduler would at `now`. */
async function plannedAt(now: Date, over: Partial<ReminderContext> = {}): Promise<ReminderPlan> {
  const input = sync.mock.calls.at(-1)?.[0] as ReminderContext & { strategy: (context: ReminderContext) => Promise<ReminderPlan> };
  return input.strategy({ ...input, now, pending: [], lastDeliveredAt: null, ...over });
}

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockResponseListeners.length = 0;
  mockPlus.entitlementActive = true;
  mockPlus.entitlementKnown = true;
  proxyUrl.mockReturnValue(null);
});

let restoreAppState: () => void = () => {};
afterEach(() => {
  restoreAppState();
  restoreAppState = () => {};
  jest.useRealTimers();
});

describe("finishing after midnight", () => {
  it("fills the day planned when it sorted (Monday), not the day after the clock's new day", async () => {
    await open(new Date(2026, 9, 25, 23, 58));
    await toThree("Book the dentist\nFinish the slides");
    jest.setSystemTime(new Date(2026, 9, 26, 0, 2));
    await press("sunday-reset-set");
    expect(latest.state.tomorrowDraft).toMatchObject({ forDate: "2026-10-26", from: "reset" });
    expect(latest.state.sundayReset?.doneWeek).toBe("2026-10-25");
  });
});

describe("the Sunday notification from the store", () => {
  it("is planned with Plus and gone at the next rewrite once Plus lapses", async () => {
    const view = await open(new Date(2026, 9, 21, 12, 0));
    await waitFor(() => expect(sync).toHaveBeenCalled());
    const withPlus = await plannedAt(new Date(2026, 9, 21, 12, 0));
    expect(withPlus.filter((item) => item.kind === SUNDAY_RESET_KIND).map((item) => item.fireAt)).toEqual([
      new Date(2026, 9, 25, 18, 0),
    ]);

    mockPlus.entitlementActive = false;
    sync.mockClear();
    view.rerender(tree());
    await waitFor(() => expect(sync).toHaveBeenCalled());
    const lapsed = await plannedAt(new Date(2026, 9, 21, 12, 0));
    expect(lapsed.some((item) => item.kind === SUNDAY_RESET_KIND)).toBe(false);
  });

  it("has the card's gate: none before a planned day (the first-run day)", async () => {
    await open(new Date(2026, 9, 21, 12, 0), {}, false);
    await waitFor(() => expect(sync).toHaveBeenCalled());
    expect(sync.mock.calls.at(-1)?.[0].sundayReset).toBeUndefined();
    expect((await plannedAt(new Date(2026, 9, 21, 12, 0))).some((item) => item.kind === SUNDAY_RESET_KIND)).toBe(false);
  });

  it("finished on a Sunday afternoon, the next one is the Sunday after", async () => {
    await open(new Date(2026, 9, 25, 15, 0), { sundayReset: { reminder: true, doneWeek: "2026-10-25", dismissedWeek: null, freeIntroWeek: null } });
    await waitFor(() => expect(sync).toHaveBeenCalled());
    const plan = await plannedAt(new Date(2026, 9, 25, 15, 0));
    expect(plan.filter((item) => item.kind === SUNDAY_RESET_KIND).map((item) => item.fireAt)).toEqual([
      new Date(2026, 10, 1, 18, 0),
    ]);
  });
});

describe("Monday, end to end", () => {
  it("the reset's three are Monday's morning words (also in Nag mode), then Use takes them out of Saved for later", async () => {
    await open(SUNDAY_6PM, { parkedTasks: parked(["Renew passport"]) });
    await toThree("Book the dentist\nFinish the slides");
    await press("sunday-reset-set");
    const three = ["Book the dentist", "Finish the slides", "Renew passport"];
    expect(latest.state.tomorrowDraft?.tasks).toEqual(three);
    expect(parkedTexts()).toEqual(["Renew passport", "Book the dentist", "Finish the slides"]);

    await waitFor(() => expect(sync.mock.calls.at(-1)?.[0].draft?.from).toBe("reset"));
    for (const style of ["calm", "nag"] as const) {
      const input = sync.mock.calls.at(-1)?.[0] as ReminderContext;
      const plan = await plannedAt(new Date(2026, 9, 25, 20, 0), {
        settings: { ...input.settings, style, nagConfirmed: true },
      });
      const monday = plan.find((item) => item.id.startsWith("daily-tasks:2026-10-26:morning"));
      expect(monday).toMatchObject({ title: "Your three for Monday", body: three.join(" · ") });
    }

    jest.setSystemTime(new Date(2026, 9, 26, 8, 0));
    await act(async () => latest.applyTomorrowDraft(three, three));
    expect(latest.state.tasks.map((task) => task.text)).toEqual(three);
    expect(parkedTexts()).toEqual([]);
    expect(latest.state.tomorrowDraft).toBeNull();
  });
});

describe("Saved for later's cap", () => {
  it("saves only what fits, says how many didn't, and never pushes the oldest out", async () => {
    const full = Array.from({ length: MAX_PARKED_TASKS - 1 }, (_, i) => `Saved thing ${i}`);
    await open(SUNDAY_6PM, { parkedTasks: parked(full) });
    await toThree("Alpha task\nBeta task\nGamma task");
    expect(screen.getByTestId("sunday-reset-overflow")).toHaveTextContent("2 didn't fit. Saved for later is full.");
    expect(parkedTexts()).toHaveLength(MAX_PARKED_TASKS);
    expect(parkedTexts()[0]).toBe("Saved thing 0");
    expect(parkedTexts().at(-1)).toBe("Alpha task");
    // The list stays short: eight rows, the rest a line.
    expect(screen.getAllByTestId("sunday-reset-candidate").length).toBeLessThanOrEqual(8);
    expect(screen.getByTestId("sunday-reset-more")).toHaveTextContent(/^\+\d+ more in Saved for later$/);
  });
});

describe("the notification tap", () => {
  it("opens the reset itself", async () => {
    await open(new Date(2026, 9, 25, 18, 1));
    expect(mockResponseListeners.length).toBeGreaterThan(0);
    await act(async () => {
      for (const listener of mockResponseListeners) {
        listener({
          actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
          notification: {
            date: 1,
            request: {
              identifier: "daily-tasks:2026-10-25:sunday_reset:1800",
              content: { data: { kind: "sunday_reset" } },
            },
          },
        });
      }
    });
    await waitFor(() => expect(screen.getByTestId("sunday-reset-wins")).toBeOnTheScreen());
    expect(reset.isOpen).toBe(true);
  });

  it("does nothing for another notification", async () => {
    await open(new Date(2026, 9, 25, 18, 1));
    await act(async () => {
      for (const listener of mockResponseListeners) {
        listener({
          actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
          notification: { date: 2, request: { identifier: "daily-tasks:2026-10-25:morning:1000", content: { data: { kind: "morning" } } } },
        });
      }
    });
    expect(screen.queryByTestId("sunday-reset-wins")).toBeNull();
    expect(reset.isOpen).toBe(false);
  });
});

describe("the sort's timeout", () => {
  it("asks the brain-dump route with the reset's timeout, and falls back to the simple split when it gives up", async () => {
    proxyUrl.mockReturnValue("https://proxy.test/api/momentum/plan");
    brainDump.mockRejectedValue(Object.assign(new Error("AI request timed out."), { kind: "timeout" }));
    await open(SUNDAY_6PM);
    await toThree("Book the dentist\nFinish the slides");
    expect(brainDump).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: WEEK_SORT_TIMEOUT_MS, today: "2026-10-25", forDay: "Monday" }),
    );
    expect(screen.getByTestId("sunday-reset-three-hint")).toHaveTextContent(/^Couldn't reach your coach/);
    expect(parkedTexts()).toEqual(["Book the dentist", "Finish the slides"]);
  });
});

describe("stepping aside and the background", () => {
  it("stepAside closes the sheet as × does, saving a typed dump", async () => {
    await open(SUNDAY_6PM);
    await press("sunday-reset-start");
    await press("sunday-reset-next");
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Water the plants");
    expect(reset.isOpen).toBe(true);
    await press("step-aside");
    await waitFor(() => expect(reset.isOpen).toBe(false));
    expect(parkedTexts()).toEqual(["Water the plants"]);
  });

  it("going to the background mid-dump saves it; sorting afterwards replaces it, not doubles it", async () => {
    // Capture AppState listeners the way store-open-edit.test.tsx does (no spyOn/restore).
    const addEventListener = RNAppState.addEventListener as unknown as jest.Mock;
    const original = addEventListener.getMockImplementation();
    const listeners = new Set<(status: string) => void>();
    addEventListener.mockImplementation((_type: string, listener: (status: string) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    restoreAppState = () => addEventListener.mockImplementation(original);
    await open(SUNDAY_6PM);
    // Only the sheet's own listener (registered when it opens).
    const before = new Set(listeners);
    await press("sunday-reset-start");
    const sheetListeners = () => [...listeners].filter((listener) => !before.has(listener));
    expect(sheetListeners().length).toBeGreaterThan(0);
    await press("sunday-reset-next");
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dent");
    await act(async () => sheetListeners().forEach((listener) => listener("background")));
    expect(parkedTexts()).toEqual(["Book the dent"]);
    await act(async () => sheetListeners().forEach((listener) => listener("active")));
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-set")).toBeOnTheScreen());
    expect(parkedTexts()).toEqual(["Book the dentist"]);
  });
});

describe("reopened after finishing", () => {
  it("ticks the three it set before", async () => {
    await open(SUNDAY_6PM, { parkedTasks: parked(["Renew passport", "Call Sam", "Read a chapter"]) });
    await toThree("");
    // First time: the oldest saved, ticked; untick to keep just one.
    await press("sunday-reset-set");
    const first = latest.state.tomorrowDraft?.tasks;
    expect(first?.length).toBeGreaterThan(0);
    await press("sunday-reset-finish");
    await waitFor(() => expect(reset.isOpen).toBe(false));

    await act(async () => reset.start("progress"));
    await press("sunday-reset-next");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-set")).toBeOnTheScreen());
    const ticked = screen
      .getAllByTestId("sunday-reset-candidate")
      .filter((node) => node.props.accessibilityState?.checked)
      .map((node) => (node.props.accessibilityLabel as string).split(". ")[0]);
    expect(ticked).toEqual(first);
  });
});
