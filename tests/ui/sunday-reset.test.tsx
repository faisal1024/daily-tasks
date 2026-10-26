// The Sunday reset (1.6 H, PR #110) with the REAL store and the real card,
// row and sheet: when the Today card shows, what the free intro does, what
// closing the dump step keeps, which three become the next day's draft, and
// that an evening close the same night leaves them alone. Local-time
// fixtures only (25 Oct 2026 is a Sunday), so it reads the same in any zone.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { SundayResetCard, SundayResetRow } from "@/components/daily-tasks/sunday-reset-card";
import { SundayResetProvider } from "@/components/daily-tasks/sunday-reset-provider";
import { toDateKey } from "@/lib/daily-tasks/date";
import { requestBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { sanitizeProps, track } from "@/lib/daily-tasks/analytics";
import type { EveningClose } from "@/lib/daily-tasks/evening";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { SHEET_SWAP_DELAY_MS } from "@/lib/daily-tasks/sheet-swap";
import { DEFAULT_AUTO_LOCK, type AppState, type DayRecord } from "@/lib/daily-tasks/types";

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
jest.mock("@/lib/daily-tasks/notifications", () => ({
  ...jest.requireActual("@/lib/daily-tasks/notifications"),
  syncNotifications: jest.fn(async () => {}),
}));
const mockOpenPaywall = jest.fn((_source: string) => true);
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
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
// The week's sort goes through the brain-dump route: here it is the test's.
jest.mock("@/lib/daily-tasks/ai-helpers", () => ({
  ...jest.requireActual("@/lib/daily-tasks/ai-helpers"),
  requestBrainDump: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: jest.fn(() => null),
}));

const tracked = track as jest.Mock;
const proxyUrl = getMomentumAiProxyUrl as jest.Mock;
const brainDump = requestBrainDump as jest.Mock;
const resetEvents = () => tracked.mock.calls.filter((call) => call[0] === "sunday_reset").map((call) => call[1]);

const KEY = "daily-tasks/state/v1";
const SUNDAY = "2026-10-25";
const SUNDAY_6PM = new Date(2026, 9, 25, 18, 0);

/** Fake only the clock; real timers keep RNTL's waits working. */
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
function Probe(): ReactNode {
  latest = useDailyTasks();
  return null;
}
const tree = (kind: "card" | "row" = "card", firstRunActive = false) => (
  <DailyTasksProvider>
    <SundayResetProvider>
      <Probe />
      {kind === "card" ? <SundayResetCard firstRunActive={firstRunActive} /> : <SundayResetRow />}
    </SundayResetProvider>
  </DailyTasksProvider>
);

/** A state the app could have saved at `at`, with a planned day the evening before unless told otherwise. */
async function save(at: Date, saved: Partial<AppState> = {}, earlier = true) {
  const before = toDateKey(new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1));
  const state: AppState = {
    ...buildInitialState(at),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    history: earlier ? { [before]: dayRecord(before, 3, 2) } : {},
    ...saved,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
}

async function open(at: Date, saved: Partial<AppState> = {}, kind: "card" | "row" = "card", earlier = true) {
  fakeClockAt(at);
  await save(at, saved, earlier);
  const view = await render(tree(kind));
  await waitFor(() => expect(latest.ready).toBe(true));
  return view;
}

const close = (overrides: Partial<EveningClose> = {}): EveningClose => ({
  note: "A good day.",
  because: "Picking up where today left off.",
  tomorrow: ["Evening one", "Evening two"],
  memory: null,
  source: "local",
  ...overrides,
});

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const card = () => screen.queryByTestId("sunday-reset-card");
const intro = () => screen.queryByTestId("sunday-reset-intro");
const sheet = () => screen.queryByTestId("sunday-reset-sheet");
// A row's label is "Task. Reason" when it has one (VoiceOver hears both): the task part.
const candidates = () =>
  screen.queryAllByTestId("sunday-reset-candidate").map((node) => (node.props.accessibilityLabel as string).split(". ")[0]);
const parkedTexts = () => latest.state.parkedTasks.map((item) => item.text);

/** Plus, the sheet open on step 1 (from the Today card). */
async function startReset() {
  await open(SUNDAY_6PM);
  await press("sunday-reset-start");
  await waitFor(() => expect(screen.getByTestId("sunday-reset-wins")).toBeOnTheScreen());
}
async function toDump() {
  await press("sunday-reset-next");
  await waitFor(() => expect(screen.getByTestId("sunday-reset-dump")).toBeOnTheScreen());
}

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockPlus.entitlementActive = true;
  mockPlus.entitlementKnown = true;
  mockPlus.paywallSource = null;
  proxyUrl.mockReturnValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the Today card", () => {
  it("shows to Plus on Sunday from 5 PM, with its 'shown' event once", async () => {
    await open(new Date(2026, 9, 25, 16, 59));
    expect(card()).toBeNull();
    await screen.unmount();

    __resetStorageForTests();
    await open(new Date(2026, 9, 25, 17, 0));
    expect(card()).toBeOnTheScreen();
    expect(resetEvents()).toEqual([{ step: "card", action: "shown", source: "today" }]);
  });

  it("not on Saturday or Monday evening", async () => {
    await open(new Date(2026, 9, 24, 19, 0));
    expect(card()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await open(new Date(2026, 9, 26, 19, 0));
    expect(card()).toBeNull();
  });

  it("not on the first-run day: nothing planned on an earlier day, or first run still going", async () => {
    await open(SUNDAY_6PM, {}, "card", false);
    expect(card()).toBeNull();
    expect(intro()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    fakeClockAt(SUNDAY_6PM);
    await save(SUNDAY_6PM);
    await render(tree("card", true));
    await waitFor(() => expect(latest.ready).toBe(true));
    expect(card()).toBeNull();
    expect(intro()).toBeNull();
  });

  it("nothing while Plus is still being checked, not even the free intro (and nothing stamped)", async () => {
    mockPlus.entitlementActive = false;
    mockPlus.entitlementKnown = false;
    await open(SUNDAY_6PM);
    expect(card()).toBeNull();
    expect(intro()).toBeNull();
    expect(latest.state.sundayReset?.freeIntroWeek ?? null).toBeNull();
    expect(resetEvents()).toEqual([]);
  });

  it("× hides it for the week, says so, and a relaunch the same evening doesn't bring it back", async () => {
    await open(SUNDAY_6PM);
    await press("sunday-reset-dismiss");
    expect(card()).toBeNull();
    expect(latest.state.sundayReset?.dismissedWeek).toBe(SUNDAY);
    expect(resetEvents()).toContainEqual({ step: "card", action: "dismissed", source: "today" });
    await act(async () => {}); // let the save land
    await screen.unmount();
    __resetStorageForTests();
    await render(tree());
    await waitFor(() => expect(latest.ready).toBe(true));
    expect(card()).toBeNull();
  });

  it("is hidden once this week's reset is done, and back the next Sunday", async () => {
    await open(SUNDAY_6PM, { sundayReset: { reminder: true, doneWeek: SUNDAY, dismissedWeek: null, freeIntroWeek: null } });
    expect(card()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await open(new Date(2026, 10, 1, 18, 0), { sundayReset: { reminder: true, doneWeek: SUNDAY, dismissedWeek: null, freeIntroWeek: null } });
    expect(card()).toBeOnTheScreen();
  });
});

describe("the free intro", () => {
  beforeEach(() => {
    mockPlus.entitlementActive = false;
  });

  it("shows once Plus is confirmed absent, is stamped with its week, and stays up that week", async () => {
    await open(SUNDAY_6PM);
    expect(intro()).toBeOnTheScreen();
    expect(card()).toBeNull();
    expect(resetEvents()).toEqual([{ step: "intro", action: "shown", source: "today" }]);
    await waitFor(() => expect(latest.state.sundayReset?.freeIntroWeek).toBe(SUNDAY));
    await act(async () => {});
    await screen.unmount();
    __resetStorageForTests();
    await render(tree());
    await waitFor(() => expect(latest.ready).toBe(true));
    expect(intro()).toBeOnTheScreen();
  });

  it("never shows in a later week", async () => {
    await open(new Date(2026, 10, 1, 19, 0), {
      sundayReset: { reminder: true, doneWeek: null, dismissedWeek: null, freeIntroWeek: SUNDAY },
    });
    expect(intro()).toBeNull();
    expect(resetEvents()).toEqual([]);
  });

  it("See Plus opens the paywall for the Sunday reset; no purchase, no reset", async () => {
    const view = await open(SUNDAY_6PM);
    await press("sunday-reset-start");
    expect(mockOpenPaywall).toHaveBeenCalledWith("sunday_reset");
    expect(tracked).toHaveBeenCalledWith("plus_gate_hit", { feature: "sunday_reset" });
    expect(resetEvents()).toContainEqual({ step: "intro", action: "plus", source: "today" });

    // The paywall comes up and is closed without buying.
    mockPlus.paywallSource = "sunday_reset";
    await view.rerender(tree());
    mockPlus.paywallSource = null;
    await view.rerender(tree());
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, SHEET_SWAP_DELAY_MS + 100)));
    expect(sheet()).toBeNull();
  });

  it("buying from it opens the reset", async () => {
    const view = await open(SUNDAY_6PM);
    await press("sunday-reset-start");
    expect(mockOpenPaywall).toHaveBeenCalledWith("sunday_reset");

    mockPlus.paywallSource = "sunday_reset";
    await view.rerender(tree());
    // Bought, then the paywall closes.
    mockPlus.entitlementActive = true;
    mockPlus.paywallSource = null;
    await view.rerender(tree());
    await waitFor(() => expect(screen.getByTestId("sunday-reset-wins")).toBeOnTheScreen(), { timeout: SHEET_SWAP_DELAY_MS + 2000 });
  });

  it("Progress's row opens the same paywall for a free user, any day", async () => {
    await open(new Date(2026, 9, 28, 12, 0), {}, "row");
    await press("sunday-reset-row");
    expect(mockOpenPaywall).toHaveBeenCalledWith("sunday_reset");
    expect(sheet()).toBeNull();
  });
});

describe("the sheet", () => {
  it("closing the dump step with typed text saves it for later; closing with nothing saves nothing", async () => {
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist\nFinish the slides");
    await press("sunday-reset-close");
    expect(parkedTexts()).toEqual(["Book the dentist", "Finish the slides"]);
    expect(resetEvents()).toContainEqual({ step: "dump", action: "close", source: "today" });
    expect(latest.state.sundayReset?.doneWeek ?? null).toBeNull();
    expect(latest.state.tomorrowDraft).toBeNull();

    // Reopened: a fresh start, and an empty close adds nothing.
    await press("sunday-reset-start");
    await toDump();
    await press("sunday-reset-close");
    expect(parkedTexts()).toEqual(["Book the dentist", "Finish the slides"]);
  });

  it("closing at the first step saves and plans nothing", async () => {
    await startReset();
    await press("sunday-reset-close");
    expect(parkedTexts()).toEqual([]);
    expect(latest.state.tomorrowDraft).toBeNull();
    expect(resetEvents()).toContainEqual({ step: "wins", action: "close", source: "today" });
  });

  it("the three become tomorrow's draft marked as the reset's, the dump is all saved, and the week is done", async () => {
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist\nFinish the slides\nCall Sam\nWater the plants");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-three-hint")).toBeOnTheScreen());
    // The suggestion first, then the rest of the dump.
    expect(candidates()).toEqual(["Book the dentist", "Finish the slides", "Call Sam", "Water the plants"]);
    expect(screen.getByRole("checkbox", { name: "Water the plants" }).props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    expect(screen.getByText("Monday's three")).toBeOnTheScreen();

    // Swap one for the user's own.
    await fireEvent.press(screen.getByRole("checkbox", { name: "Call Sam" }));
    await fireEvent.changeText(screen.getByTestId("sunday-reset-own"), "Plan the trip");
    await press("sunday-reset-own-add");
    await press("sunday-reset-set");

    expect(latest.state.tomorrowDraft).toMatchObject({
      forDate: "2026-10-26",
      tasks: ["Plan the trip", "Book the dentist", "Finish the slides"],
      from: "reset",
      source: "local",
    });
    expect(latest.state.sundayReset?.doneWeek).toBe(SUNDAY);
    // Everything from the dump is in Saved for later, whether picked or not.
    expect(parkedTexts()).toEqual(["Book the dentist", "Finish the slides", "Call Sam", "Water the plants"]);
    expect(screen.getByTestId("sunday-reset-done")).toBeOnTheScreen();

    await press("sunday-reset-finish");
    expect(card()).toBeNull();
  });

  it("an evening close the same night keeps the reset's three; one on a later night drafts as usual", async () => {
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist\nFinish the slides");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-set")).toBeOnTheScreen());
    await press("sunday-reset-set");
    const draft = latest.state.tomorrowDraft;
    expect(draft).toMatchObject({ forDate: "2026-10-26", from: "reset" });

    await act(async () => latest.setEveningClose(close(), SUNDAY, "good"));
    expect(latest.state.tomorrowDraft).toEqual(draft);
    expect(latest.state.eveningClose).toMatchObject({ date: SUNDAY, result: "good" });

    // Monday night's close drafts Tuesday: that is the evening close's own.
    await act(async () => latest.setEveningClose(close(), "2026-10-26", "good"));
    expect(latest.state.tomorrowDraft).toMatchObject({ forDate: "2026-10-27", tasks: ["Evening one", "Evening two"] });
    expect(latest.state.tomorrowDraft).not.toHaveProperty("from");
  });

  it("an evening close with nothing to draft still leaves the reset's three", async () => {
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-set")).toBeOnTheScreen());
    await press("sunday-reset-set");
    await act(async () => latest.setEveningClose(close({ tomorrow: [] }), SUNDAY, "hard"));
    expect(latest.state.tomorrowDraft).toMatchObject({ forDate: "2026-10-26", tasks: ["Book the dentist"], from: "reset" });
  });

  it("a reset from Progress on another day plans the next day", async () => {
    // Wednesday noon: the row, not the card.
    await open(new Date(2026, 9, 28, 12, 0), {}, "row");
    await press("sunday-reset-row");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-wins")).toBeOnTheScreen());
    expect(resetEvents()).toContainEqual({ step: "card", action: "start", source: "progress" });
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Renew the passport");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByText("Thursday's three")).toBeOnTheScreen());
    await press("sunday-reset-set");
    expect(latest.state.tomorrowDraft).toMatchObject({ forDate: "2026-10-29", tasks: ["Renew the passport"], from: "reset" });
    // The week it counts toward is the one that began on Sunday the 25th.
    expect(latest.state.sundayReset?.doneWeek).toBe(SUNDAY);
  });

  it("with nothing typed and nothing saved, Skip leads to a Finish that plans nothing", async () => {
    await startReset();
    await toDump();
    expect(screen.getByTestId("sunday-reset-sort")).toHaveTextContent("Skip");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-set")).toBeOnTheScreen());
    expect(screen.getByTestId("sunday-reset-three-hint")).toHaveTextContent(/^Nothing saved yet\./);
    await press("sunday-reset-set");
    expect(latest.state.tomorrowDraft).toBeNull();
    expect(latest.state.sundayReset?.doneWeek).toBe(SUNDAY);
    expect(resetEvents()).toContainEqual({ step: "three", action: "set", count: 0, source: "today" });
  });

  it("the coach's reworded saved item shows as the saved words, and is not saved twice", async () => {
    proxyUrl.mockReturnValue("https://proxy.test/api/momentum/plan");
    brainDump.mockResolvedValue({
      picks: ["Call dentist book cleaning", "Mow the lawn"],
      parked: ["Wash the car"],
      reasons: ["Quick win", ""],
      source: "ai",
    });
    await open(SUNDAY_6PM, {
      parkedTasks: [{ id: "p1", text: "Call the dentist to book a cleaning", parkedAt: "2026-10-20T08:00:00.000Z" }],
    });
    await press("sunday-reset-start");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-wins")).toBeOnTheScreen());
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "mow lawn\nwash car");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-three-hint")).toBeOnTheScreen());
    expect(brainDump).toHaveBeenCalledWith(
      expect.objectContaining({ forDay: "Monday", saved: ["Call the dentist to book a cleaning"], text: "mow lawn\nwash car" }),
    );
    expect(candidates().slice(0, 2)).toEqual(["Call the dentist to book a cleaning", "Mow the lawn"]);
    expect(screen.getByTestId("sunday-reset-three-hint")).toHaveTextContent(/^Your coach suggests these/);
    expect(parkedTexts()).toEqual(["Call the dentist to book a cleaning", "Mow the lawn", "Wash the car"]);
  });

  it("when the coach can't be reached it says so and still offers a simple start", async () => {
    proxyUrl.mockReturnValue("https://proxy.test/api/momentum/plan");
    brainDump.mockRejectedValue(new Error("offline"));
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-three-hint")).toBeOnTheScreen());
    expect(screen.getByTestId("sunday-reset-three-hint")).toHaveTextContent(/^Couldn't reach your coach/);
    expect(candidates()).toEqual(["Book the dentist"]);
  });

  it("a sort that lands after the sheet was closed changes nothing", async () => {
    proxyUrl.mockReturnValue("https://proxy.test/api/momentum/plan");
    let land: (value: unknown) => void = () => {};
    brainDump.mockReturnValue(new Promise((resolve) => (land = resolve)));
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist");
    await press("sunday-reset-sort");
    await waitFor(() => expect(brainDump).toHaveBeenCalled());
    await press("sunday-reset-close");
    await act(async () => land({ picks: ["Book the dentist"], parked: ["Water the plants"], source: "ai" }));
    expect(latest.state.tomorrowDraft).toBeNull();
    expect(latest.state.sundayReset?.doneWeek ?? null).toBeNull();
    expect(parkedTexts()).not.toContain("Water the plants");
  });

  // PR #110 review finding, not fixed here: close() only saves a typed dump
  // while the stage is "dump", but pressing Next moves to "sorting" at once
  // and the sort can take seconds on a slow connection. Closing then (or the
  // Android back button) drops the sort's result (right: the sheet is gone)
  // AND never saves the text they typed: components/daily-tasks/sunday-reset-sheet.tsx:101-108
  // ("A week's dump typed but not sorted yet is saved, never lost.").
  it("closing while the week is being sorted still saves what was typed", async () => {
    proxyUrl.mockReturnValue("https://proxy.test/api/momentum/plan");
    brainDump.mockReturnValue(new Promise(() => {}));
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Book the dentist\nFinish the slides");
    await press("sunday-reset-sort");
    await waitFor(() => expect(brainDump).toHaveBeenCalled());
    await press("sunday-reset-close");
    expect(parkedTexts()).toEqual(["Book the dentist", "Finish the slides"]);
  });
});

describe("analytics", () => {
  it("sends ids and counts only: step, action, source, count, never a word of the dump", async () => {
    await startReset();
    await toDump();
    await fireEvent.changeText(screen.getByTestId("sunday-reset-dump"), "Confidential merger plan\nCall Sam");
    await press("sunday-reset-sort");
    await waitFor(() => expect(screen.getByTestId("sunday-reset-set")).toBeOnTheScreen());
    await press("sunday-reset-set");

    const events = resetEvents();
    expect(events).toEqual([
      { step: "card", action: "shown", source: "today" },
      { step: "card", action: "start", source: "today" },
      { step: "wins", action: "shown", source: "today" },
      { step: "wins", action: "next", source: "today" },
      { step: "dump", action: "next", source: "today" },
      { step: "dump", action: "saved", count: 2, source: "today" },
      { step: "three", action: "set", count: 2, source: "today" },
    ]);
    const STEPS = ["card", "intro", "wins", "dump", "three", "done"];
    const ACTIONS = ["shown", "start", "next", "skip", "saved", "close", "dismissed", "plus", "set"];
    for (const event of events) {
      expect(Object.keys(event).every((key) => ["step", "action", "source", "count"].includes(key))).toBe(true);
      expect(STEPS).toContain(event.step);
      expect(ACTIONS).toContain(event.action);
      expect(["today", "progress"]).toContain(event.source);
      // The allowlist keeps every one of them.
      expect(sanitizeProps(event)).toEqual(event);
    }
    expect(JSON.stringify(tracked.mock.calls)).not.toMatch(/merger|Sam|dentist/i);
  });
});
