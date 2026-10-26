// Settings > "What your coach remembers" (1.5 C): everyone sees the basic
// memory in plain sentences; Plus also sees and edits the coach's notes;
// "Clear memory" asks first, then empties the notes and starts the basic
// memory again from tomorrow (history stays). Nothing here goes to analytics.
import { Alert, type AlertButton } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import {
  CoachMemorySection,
  CLEAR_MEMORY_MESSAGE,
  CLEAR_MEMORY_MESSAGE_PLUS,
  CLEAR_MEMORY_TITLE,
  MEMORY_CLEARED_NOTE,
  NO_COACH_NOTES,
} from "@/components/daily-tasks/coach-memory-section";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { track } from "@/lib/daily-tasks/analytics";
import { MAX_COACH_MEMORY } from "@/lib/daily-tasks/coach-memory";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, DayRecord } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const FREE = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: true, paywallSource: null as string | null };
const PLUS = { ...FREE, entitlementActive: true };
let mockPlus: typeof FREE;
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: jest.fn(() => true), restore: jest.fn(), redeemCode: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/announce", () => ({ announcePolitely: jest.fn() }));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const KEY = "daily-tasks/state/v1";
const TODAY = "2026-10-12";
const NOTES = "Mornings go best. Likes short tasks.";

/** A finished day (local date key), built like the app builds it. */
function pastDay(date: string, done: number, open: number): DayRecord {
  const tasks = [
    ...Array.from({ length: done }, (_unused, index) => ({ id: `${date}-d${index}`, text: `Read ${index}`, createdAt: `${date}T08:00:00.000Z`, carriedOver: false })),
    ...Array.from({ length: open }, (_unused, index) => ({ id: `${date}-o${index}`, text: `Plan ${index}`, createdAt: `${date}T08:00:00.000Z`, carriedOver: false })),
  ];
  const state = {
    ...buildInitialState(new Date(2026, 9, 1, 8)),
    tasks,
    todayCompletions: tasks.slice(0, done).map((task) => task.id),
    lastOpenedDate: date,
  };
  return syncTodayHistory(state, date).history[date];
}

const BASIC_LINE = "In the last 30 days, you finished 4 of 6 tasks.";

async function seed(extra: Partial<AppState> = {}, { withHistory = true }: { withHistory?: boolean } = {}) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 9, 12, 8)),
    hasSeenOnboarding: true,
    history: withHistory ? { "2026-10-09": pastDay("2026-10-09", 2, 1), "2026-10-10": pastDay("2026-10-10", 2, 1) } : {},
    ...extra,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}

const saved = async (): Promise<AppState> => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null");

async function renderSection() {
  await render(
    <DailyTasksProvider>
      <CoachMemorySection />
    </DailyTasksProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("coach-memory-section")).toBeOnTheScreen());
}

let alert: jest.SpyInstance;
const lastAlert = () => alert.mock.calls[alert.mock.calls.length - 1] as [string, string, AlertButton[]];
const pressAlert = (text: string) => act(async () => lastAlert()[2].find((button) => button.text === text)!.onPress?.());
const clearButton = () => screen.queryByRole("button", { name: "Clear memory" });

beforeEach(async () => {
  jest.clearAllMocks();
  mockPlus = { ...PLUS };
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.useFakeTimers({
    now: new Date(2026, 9, 12, 8, 30),
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  alert.mockRestore();
  jest.useRealTimers();
});

describe("What your coach remembers", () => {
  it("free: sees the basic memory in plain sentences, and no coach notes even if a note is saved", async () => {
    mockPlus = { ...FREE };
    await seed({ coachMemory: NOTES });
    await renderSection();
    expect(screen.getByText(BASIC_LINE)).toBeOnTheScreen();
    expect(screen.getByText("What your coach remembers")).toBeOnTheScreen();
    expect(screen.queryByTestId("coach-memory-notes")).toBeNull();
    expect(screen.queryByText(NOTES)).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit your coach's notes" })).toBeNull();
  });

  it("with nothing to remember: 'Nothing yet', no notes for free, and no Clear memory button", async () => {
    mockPlus = { ...FREE };
    await seed({}, { withHistory: false });
    await renderSection();
    expect(screen.getByText("Nothing yet. After a few days with your three, patterns show up here.")).toBeOnTheScreen();
    expect(clearButton()).toBeNull();
  });

  it("Plus: sees the basic memory and the coach's notes, or says there are none yet", async () => {
    await seed({ coachMemory: NOTES });
    await renderSection();
    expect(screen.getByText(BASIC_LINE)).toBeOnTheScreen();
    expect(screen.getByText(NOTES)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Edit your coach's notes" })).toBeOnTheScreen();
  });

  it("Plus with no notes yet: says so and can still write some", async () => {
    await seed({ coachMemory: null });
    await renderSection();
    expect(screen.getByText(NO_COACH_NOTES)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Edit your coach's notes" }));
    await fireEvent.changeText(screen.getByLabelText("Your coach's notes"), "  Prefers evenings.  ");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await saved()).coachMemory).toBe("Prefers evenings."));
    expect(screen.getByText("Prefers evenings.")).toBeOnTheScreen();
  });

  it("Plus: edit starts from the saved notes, Save keeps the change, Cancel throws it away", async () => {
    await seed({ coachMemory: NOTES });
    await renderSection();
    await fireEvent.press(screen.getByRole("button", { name: "Edit your coach's notes" }));
    const input = screen.getByLabelText("Your coach's notes");
    expect(input.props.value).toBe(NOTES);
    expect(input.props.maxLength).toBe(MAX_COACH_MEMORY);
    await fireEvent.changeText(input, "Thrown away");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(NOTES)).toBeOnTheScreen();
    expect((await saved()).coachMemory).toBe(NOTES);

    await fireEvent.press(screen.getByRole("button", { name: "Edit your coach's notes" }));
    expect(screen.getByLabelText("Your coach's notes").props.value).toBe(NOTES);
    await fireEvent.changeText(screen.getByLabelText("Your coach's notes"), "Kept.");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await saved()).coachMemory).toBe("Kept."));
    expect(screen.queryByLabelText("Your coach's notes")).toBeNull();
  });

  it("Plus: saving a blank note clears the notes", async () => {
    await seed({ coachMemory: NOTES });
    await renderSection();
    await fireEvent.press(screen.getByRole("button", { name: "Edit your coach's notes" }));
    await fireEvent.changeText(screen.getByLabelText("Your coach's notes"), "   \n ");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await saved()).coachMemory).toBeNull());
    expect(screen.getByText(NO_COACH_NOTES)).toBeOnTheScreen();
  });

  describe("Clear memory", () => {
    it("asks first, in these words, and Cancel changes nothing", async () => {
      await seed({ coachMemory: NOTES });
      await renderSection();
      await fireEvent.press(clearButton()!);
      expect(alert).toHaveBeenCalledTimes(1);
      const [title, message, buttons] = lastAlert();
      expect(title).toBe(CLEAR_MEMORY_TITLE);
      expect(message).toBe(CLEAR_MEMORY_MESSAGE_PLUS);
      expect(buttons.map((button) => button.text)).toEqual(["Cancel", "Clear"]);
      expect(buttons[0].style).toBe("cancel");
      expect(buttons[1].style).toBe("destructive");
      await pressAlert("Cancel");
      const after = await saved();
      expect(after.coachMemory).toBe(NOTES);
      expect(after.memoryClearedAt ?? null).toBeNull();
      expect(screen.getByText(BASIC_LINE)).toBeOnTheScreen();
      expect(announcePolitely).not.toHaveBeenCalled();
    });

    it("Plus: confirming deletes the notes, sets memoryClearedAt to today and starts the basic memory again", async () => {
      await seed({ coachMemory: NOTES });
      await renderSection();
      await fireEvent.press(clearButton()!);
      await pressAlert("Clear");
      await waitFor(async () => expect((await saved()).memoryClearedAt).toBe(TODAY));
      const after = await saved();
      expect(after.coachMemory).toBeNull();
      // History and streak data stay.
      expect(Object.keys(after.history)).toEqual(expect.arrayContaining(["2026-10-09", "2026-10-10"]));
      expect(after.history["2026-10-09"].tasks).toHaveLength(3);
      expect(screen.getByText("Nothing since you cleared it. After a few days with your three, patterns show up here.")).toBeOnTheScreen();
      expect(screen.queryByText(BASIC_LINE)).toBeNull();
      expect(screen.getByText(NO_COACH_NOTES)).toBeOnTheScreen();
      expect(announcePolitely).toHaveBeenCalledWith(MEMORY_CLEARED_NOTE);
      expect(MEMORY_CLEARED_NOTE).toBe("Memory cleared.");
      // Nothing left to clear: the button goes.
      expect(clearButton()).toBeNull();
    });

    it("closes an open edit when the memory is cleared", async () => {
      await seed({ coachMemory: NOTES });
      await renderSection();
      await fireEvent.press(screen.getByRole("button", { name: "Edit your coach's notes" }));
      await fireEvent.press(clearButton()!);
      await pressAlert("Clear");
      await waitFor(() => expect(screen.queryByLabelText("Your coach's notes")).toBeNull());
    });

    it("free: a shorter message with no mention of notes; confirming sets memoryClearedAt", async () => {
      mockPlus = { ...FREE };
      await seed();
      await renderSection();
      await fireEvent.press(clearButton()!);
      expect(lastAlert()[1]).toBe(CLEAR_MEMORY_MESSAGE);
      expect(CLEAR_MEMORY_MESSAGE).not.toMatch(/notes/i);
      await pressAlert("Clear");
      await waitFor(async () => expect((await saved()).memoryClearedAt).toBe(TODAY));
      expect(screen.getByText("Nothing since you cleared it. After a few days with your three, patterns show up here.")).toBeOnTheScreen();
    });

    it("an earlier clearing is honoured on load: only days after it are summed", async () => {
      await seed({ memoryClearedAt: "2026-10-09" });
      await renderSection();
      expect(screen.getByText("Since you cleared it, you finished 2 of 3 tasks.")).toBeOnTheScreen();
    });
  });

  it("sends nothing to analytics: viewing, editing, saving and clearing", async () => {
    await seed({ coachMemory: NOTES });
    await renderSection();
    await fireEvent.press(screen.getByRole("button", { name: "Edit your coach's notes" }));
    await fireEvent.changeText(screen.getByLabelText("Your coach's notes"), "New note");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await fireEvent.press(clearButton()!);
    await pressAlert("Clear");
    await waitFor(async () => expect((await saved()).memoryClearedAt).toBe(TODAY));
    const memoryEvents = (track as jest.Mock).mock.calls.filter((call) => /memory|coach/i.test(String(call[0])) || /memory|notes/i.test(JSON.stringify(call[1] ?? {})));
    expect(memoryEvents).toEqual([]);
  });
});
