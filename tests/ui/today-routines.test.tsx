// "Today's routines" on Today (1.3, PR #86) with the REAL store and screen:
// which day's routines show (the owner's Weekdays-on-a-Friday case), one add
// leaving both Today's card and Ideas, analytics by source and only for an
// add that lands, and Edit opening the routines sheet with its save note.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { track } from "@/lib/daily-tasks/analytics";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Routine, type Task } from "@/lib/daily-tasks/types";

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
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallBuild: true,
    paywallEnabled: true,
    entitlementActive: false,
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
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

const WEEKDAYS = [1, 2, 3, 4, 5];
const routine = (id: string, text: string, days: number[], paused = false): Routine => ({
  id,
  text,
  days,
  paused,
  createdAt: "2026-09-30T08:00:00.000Z",
});
const task = (id: string, text: string): Task => ({ id, text, createdAt: "", carriedOver: false });

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

/** Open Today at `now` (local) with a save from that same morning. */
async function openToday(now: Date, saved: Partial<AppState>) {
  fakeClockAt(now);
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7);
  const state: AppState = {
    ...buildInitialState(morning),
    hasSeenOnboarding: true,
    plusGrandfathered: false,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    ...saved,
  };
  await AsyncStorage.setItem("daily-tasks/state/v1", JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  await render(
    <DailyTasksProvider>
      <HomeScreen />
    </DailyTasksProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText(/^Task 1: |Add a task, slot 1/)).toBeOnTheScreen());
}

// Friday 2 Oct 2026, 10 am local: the owner's case.
const FRIDAY_10AM = new Date(2026, 9, 2, 10, 0);

const card = () => within(screen.getByTestId("today-routines"));
const cardTexts = () =>
  screen
    .queryAllByRole("button", { name: /^Add .+ to today$/ })
    .map((node) => (node.props.accessibilityLabel as string).replace(/^Add (.+) to today$/, "$1"));
const todayTaskNames = () =>
  screen
    .queryAllByRole("checkbox")
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label) => /^Task \d: /.test(label ?? ""))
    .map((label) => label.replace(/^Task \d: /, "").replace(/, routine$/, ""));
const addedEvents = () => (track as jest.Mock).mock.calls.filter(([name]) => name === "routine_added_today");

let announce: jest.SpyInstance;
beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  (track as jest.Mock).mockClear();
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});

afterEach(() => {
  announce.mockRestore();
  jest.useRealTimers();
});

describe("Today's routines: which day's routines show (real store)", () => {
  // The owner's report: a Weekdays routine on Friday 2026-10-02 must show.
  it("a Weekdays routine shows on Friday 2026-10-02; a weekends one doesn't", async () => {
    await openToday(FRIDAY_10AM, {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stand-up notes", WEEKDAYS), routine("r2", "Long run", [0, 6])],
    });
    expect(screen.getByTestId("today-routines")).toBeOnTheScreen();
    expect(cardTexts()).toEqual(["Stand-up notes"]);
  });

  it.each([
    { label: "shows on Monday 5 Oct", now: new Date(2026, 9, 5, 10, 0), shown: true },
    { label: "is hidden on Saturday 3 Oct", now: new Date(2026, 9, 3, 10, 0), shown: false },
    { label: "is hidden on Sunday 4 Oct", now: new Date(2026, 9, 4, 10, 0), shown: false },
  ])("a Weekdays routine $label", async ({ now, shown }) => {
    await openToday(now, {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stand-up notes", WEEKDAYS)],
    });
    if (shown) expect(cardTexts()).toEqual(["Stand-up notes"]);
    else expect(screen.queryByTestId("today-routines")).toBeNull();
  });
});

describe("Today's routines: one add, both places (real store)", () => {
  it("Add on Today's card puts it on the list, leaves the card and Ideas, tracks source today, says so", async () => {
    await openToday(FRIDAY_10AM, {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stretch", WEEKDAYS), routine("r2", "Plan the week", [5])],
    });
    expect(cardTexts()).toEqual(["Stretch", "Plan the week"]);

    await fireEvent.press(card().getByRole("button", { name: "Add Stretch to today" }));
    expect(todayTaskNames()).toEqual(["Read", "Stretch"]);
    expect(cardTexts()).toEqual(["Plan the week"]);
    expect(addedEvents()).toEqual([["routine_added_today", { source: "today" }]]);
    expect(announce).toHaveBeenCalledWith("Added Stretch to today");

    await fireEvent.press(screen.getByTestId("need-ideas"));
    const ideas = within(screen.getByTestId("ideas-sheet"));
    expect(ideas.queryByRole("button", { name: "Add Stretch" })).toBeNull();
    expect(ideas.getByRole("button", { name: "Add Plan the week" })).toBeOnTheScreen();
  });

  it("Add in Ideas takes it off Today's card too, tracked with source ideas", async () => {
    await openToday(FRIDAY_10AM, {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stretch", WEEKDAYS), routine("r2", "Plan the week", [5])],
    });
    await fireEvent.press(screen.getByTestId("need-ideas"));
    await fireEvent.press(within(screen.getByTestId("ideas-sheet")).getByRole("button", { name: "Add Stretch" }));
    expect(addedEvents()).toEqual([["routine_added_today", { source: "ideas" }]]);
    expect(todayTaskNames()).toEqual(["Read", "Stretch"]);
    expect(cardTexts()).toEqual(["Plan the week"]);
  });

  it("a typed task with the same words (any case, extra spaces) hides it from the card", async () => {
    await openToday(FRIDAY_10AM, {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stretch", WEEKDAYS)],
    });
    expect(cardTexts()).toEqual(["Stretch"]);
    await fireEvent.press(screen.getByRole("button", { name: "Add a task, slot 2" }));
    await fireEvent(screen.getByLabelText("New task"), "submitEditing", { nativeEvent: { text: "  STRETCH " } });
    expect(todayTaskNames()).toHaveLength(2);
    expect(screen.queryByTestId("today-routines")).toBeNull();
    expect(addedEvents()).toEqual([]);
  });
});

describe("Today's routines: only an add that lands counts (real store)", () => {
  async function doubleTapStretch() {
    await openToday(FRIDAY_10AM, {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stretch", WEEKDAYS), routine("r2", "Plan the week", [5])],
    });
    const add = card().getByRole("button", { name: "Add Stretch to today" });
    // Both taps before React re-renders.
    await act(async () => {
      fireEvent.press(add);
      fireEvent.press(add);
    });
  }

  it("a double tap on Add puts it on today once", async () => {
    await doubleTapStretch();
    expect(todayTaskNames()).toEqual(["Read", "Stretch"]);
    expect(cardTexts()).toEqual(["Plan the week"]);
  });

  // KNOWN BUG (PR #86 review): the store judges "lands" from stateRef, which
  // only updates on render, so the second tap of a double tap is also counted
  // (tracked and announced twice) though the reducer refuses it. `it.failing`
  // until store.tsx's addRoutineToToday sees its own earlier add; then make it `it`.
  it.failing("a double tap on Add tracks once and announces once", async () => {
    await doubleTapStretch();
    expect(addedEvents()).toEqual([["routine_added_today", { source: "today" }]]);
    expect(announce.mock.calls.filter(([text]) => text === "Added Stretch to today")).toHaveLength(1);
  });

  it("Add tapped on Friday's card just after midnight (now Saturday, not due): no task, no event, no announcement", async () => {
    await openToday(new Date(2026, 9, 2, 23, 58), {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stretch", WEEKDAYS)],
    });
    const add = card().getByRole("button", { name: "Add Stretch to today" });
    // Before the minute tick re-renders: the store runs the day change first.
    jest.setSystemTime(new Date(2026, 9, 3, 0, 0, 10));
    await fireEvent.press(add);
    expect(todayTaskNames()).not.toContain("Stretch");
    expect(addedEvents()).toEqual([]);
    expect(announce).not.toHaveBeenCalledWith("Added Stretch to today");
  });
});

describe("Today's routines: Edit (real store)", () => {
  it("Edit opens the routines sheet; a routine saved there due today says it can be added now, then shows on the card", async () => {
    await openToday(FRIDAY_10AM, {
      tasks: [task("t0", "Read")],
      routines: [routine("r1", "Stretch", WEEKDAYS)],
    });
    await fireEvent.press(card().getByRole("button", { name: "Edit routines" }));
    await waitFor(() => expect(screen.getByTestId("routines-sheet")).toBeOnTheScreen(), { timeout: 2000 });

    await fireEvent.press(screen.getByRole("button", { name: "Add a routine" }));
    await fireEvent.changeText(screen.getByLabelText("Routine"), "Water plants");
    await fireEvent.press(screen.getByRole("radio", { name: "Weekdays" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save routine" }));

    const notes = screen.getAllByTestId(/^routine-saved-note-/);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(/Shows on Today — you can add it now\.$/);
    expect(
      within(screen.getByTestId(notes[0].props.testID.replace("routine-saved-note-", "routine-row-"))).getByText(
        "Water plants",
      ),
    ).toBeOnTheScreen();
    expect(announce.mock.calls.filter(([text]) => /^Saved\./.test(text))).toEqual([
      ["Saved. Shows on Today — you can add it now."],
    ]);

    await fireEvent.press(screen.getByRole("button", { name: "Close routines" }));
    await waitFor(() => expect(cardTexts()).toEqual(["Stretch", "Water plants"]));
  });
});
