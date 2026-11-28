// The night before (1.7), with the real store: the held list in the
// reducer (nothing filed at night, Add / Save / Let the rest go in the
// morning, let go when its day ends), the sheet (closing keeps everything,
// even half-typed; reopening brings it back; ticks are "first" only), and
// the morning card. Local-time fixtures (26 Nov 2026 is a Thursday).
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { NightBeforeSheet } from "@/components/daily-tasks/night-before-sheet";
import { NightMorningCard } from "@/components/daily-tasks/night-morning-card";
import { isFromLastNight, morningList } from "@/lib/daily-tasks/night-before";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, reducer, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type NightList, type Task } from "@/lib/daily-tasks/types";

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
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallBuild: true,
    paywallEnabled: true,
    entitlementActive: false,
    entitlementKnown: true,
    paywallSource: null,
    purchaseCount: 0,
    winBackDue: false,
    openPaywall: jest.fn(() => true),
  }),
}));
// No proxy: the simple on-device split.
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: jest.fn(() => null),
}));

const THU = "2026-11-26";
const FRI = "2026-11-27";
const SAT = "2026-11-28";
const AT = new Date(2026, 10, 27, 8).toISOString();
const KEY = "daily-tasks/state/v1";

const list = (texts: string[], picked: string[] = []): NightList => ({
  forDay: FRI,
  nightOf: THU,
  text: texts.join("\n"),
  items: texts.map((text, index) => ({ id: `n${index}`, text, picked: picked.includes(text) })),
  source: "local",
  createdAt: new Date(2026, 10, 26, 21).toISOString(),
});
const task = (id: string, text: string): Task => ({ id, text, createdAt: "", carriedOver: false });

function dayState(day: string, extra: Partial<AppState> = {}): AppState {
  const [y, m, d] = day.split("-").map(Number);
  return syncTodayHistory({ ...buildInitialState(new Date(y, m - 1, d, 9)), lastOpenedDate: day, ...extra }, day);
}
const take = (id: string, how: "add" | "save", today = FRI) =>
  ({ type: "takeNightItem", id, how, today, at: AT }) as const;

describe("the held list in the reducer", () => {
  it("at night it is held as it is: nothing in Saved for later, no draft, not on Today", () => {
    const held = reducer(dayState(THU), { type: "setNightList", list: list(["Call the dentist", "Buy milk"], ["Buy milk"]) });
    expect(held.nightList?.items).toHaveLength(2);
    expect(held.parkedTasks).toEqual([]);
    expect(held.tomorrowDraft).toBeNull();
    expect(held.tasks).toEqual([]);
  });

  it("survives the night's rollover into its day, and is let go when that day ends", () => {
    const held = reducer(dayState(THU), { type: "setNightList", list: list(["Call the dentist"]) });
    const friday = reducer(held, { type: "rollover", today: FRI });
    expect(friday.nightList?.items).toHaveLength(1);
    const saturday = reducer(friday, { type: "rollover", today: SAT });
    expect(saturday.nightList).toBeNull();
    // Never moved into Saved for later.
    expect(saturday.parkedTasks).toEqual([]);
  });

  it("Add puts a row on Today, tagged for its day; Save files it tagged; the rest is let go on finishing", () => {
    const friday = dayState(FRI, { nightList: list(["Call the dentist", "Buy milk", "Email Sam"]) });
    const added = reducer(friday, take("n0", "add"));
    expect(added.tasks).toEqual([expect.objectContaining({ text: "Call the dentist", nightFor: FRI })]);
    const saved = reducer(added, take("n1", "save"));
    expect(saved.parkedTasks).toEqual([expect.objectContaining({ text: "Buy milk", nightFor: FRI })]);
    expect(saved.nightList?.items.map((item) => item.text)).toEqual(["Email Sam"]);
    const done = reducer(saved, { type: "finishNightList" });
    expect(done.nightList).toBeNull();
    expect(done.parkedTasks.map((item) => item.text)).toEqual(["Buy milk"]);
    // The tag is for Friday only.
    expect(isFromLastNight(done.tasks[0].nightFor, SAT)).toBe(false);
  });

  it("Add follows Today's rules: no room or a set day changes nothing; the same words already there just clear the row", () => {
    const full = dayState(FRI, {
      tasks: [task("a", "One"), task("b", "Two"), task("c", "Three")],
      nightList: list(["Call the dentist", "two"]),
    });
    expect(reducer(full, take("n0", "add"))).toBe(full);
    const locked = dayState(FRI, { todayLocked: true, nightList: list(["Call the dentist"]) });
    expect(reducer(locked, take("n0", "add")).tasks).toEqual([]);
    const cleared = reducer(full, take("n1", "add"));
    expect(cleared.tasks).toHaveLength(3);
    expect(cleared.nightList?.items.map((item) => item.text)).toEqual(["Call the dentist"]);
  });

  it("not before its day (the night itself), and a typed-only dump is split for the morning", () => {
    const held = dayState(THU, { nightList: list(["Call the dentist"]) });
    expect(reducer(held, take("n0", "add", THU))).toBe(held);
    const typed = dayState(FRI, { nightList: { ...list([]), text: "Call the dentist\nBuy milk" } });
    const shown = morningList(typed.nightList, FRI)!;
    const next = reducer(typed, take(shown.items[1].id, "add"));
    expect(next.tasks.map((t) => t.text)).toEqual(["Buy milk"]);
    expect(next.nightList?.items.map((item) => item.text)).toEqual(["Call the dentist"]);
  });

  it("a saved item added from Saved for later keeps its tag", () => {
    const saved = reducer(dayState(FRI, { nightList: list(["Call the dentist"]) }), take("n0", "save"));
    const added = reducer(saved, { type: "addParkedTask", id: saved.parkedTasks[0].id, today: FRI });
    expect(added.tasks[0]).toMatchObject({ text: "Call the dentist", nightFor: FRI });
  });
});

describe("the sheet", () => {
  let latest: ReturnType<typeof useDailyTasks>;
  function Probe(): ReactNode {
    latest = useDailyTasks();
    return null;
  }
  const onClose = jest.fn();
  const onDone = jest.fn();
  const sheet = (visible: boolean) => (
    <DailyTasksProvider>
      <Probe />
      <NightBeforeSheet visible={visible} target={{ forDate: FRI, nightOf: THU }} source="today" onClose={onClose} onDone={onDone} />
    </DailyTasksProvider>
  );

  async function openSheet() {
    jest.useFakeTimers({
      now: new Date(2026, 10, 26, 21, 0),
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
    });
    const state: AppState = {
      ...buildInitialState(new Date(2026, 10, 26, 21)),
      hasSeenOnboarding: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, THU)));
    const view = await render(sheet(true));
    await waitFor(() => expect(latest.ready).toBe(true));
    return view;
  }
  async function makeList() {
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Call the dentist\nBuy milk\nEmail Sam");
    await fireEvent.press(screen.getByTestId("night-before-sort"));
    await waitFor(() => expect(screen.getByTestId("night-before-review-title")).toBeTruthy());
  }

  afterEach(async () => {
    jest.useRealTimers();
    onClose.mockClear();
    onDone.mockClear();
    await AsyncStorage.clear();
  });

  it("holds what's typed as it's typed, and closing keeps it (nothing filed)", async () => {
    await openSheet();
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Call the den");
    expect(latest.state.nightList).toMatchObject({ forDay: FRI, nightOf: THU, text: "Call the den", items: [] });
    await fireEvent.press(screen.getByTestId("night-before-close"));
    expect(onClose).toHaveBeenCalled();
    expect(latest.state.nightList?.text).toBe("Call the den");
    expect(latest.state.parkedTasks).toEqual([]);
  });

  it("makes a list with nothing ticked; ticks only mark 'first'; closing on the list asks nothing and keeps it", async () => {
    const view = await openSheet();
    await makeList();
    const rows = screen.getAllByTestId("night-before-row");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(rows[1]);
    expect(latest.state.nightList?.items.map((item) => item.picked)).toEqual([false, true, false]);
    expect(screen.getByTestId("night-before-row-first")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("night-before-close"));
    expect(onClose).toHaveBeenCalled();
    expect(latest.state.nightList?.items).toHaveLength(3);
    expect(latest.state.parkedTasks).toEqual([]);
    expect(latest.state.tomorrowDraft).toBeNull();
    // Reopened the same night: the list as it was, to edit.
    await view.rerender(sheet(false));
    await view.rerender(sheet(true));
    expect(screen.getByTestId("night-before-review-title")).toBeTruthy();
    expect(screen.getAllByTestId("night-before-row")[1].props.accessibilityState).toMatchObject({ checked: true });
  });

  it("Keep till morning marks tonight kept, offers the nudge once, and Done hands back", async () => {
    await openSheet();
    await makeList();
    await fireEvent.press(screen.getByTestId("night-before-keep"));
    expect(screen.getByTestId("night-before-done-line").props.children).toBe(
      "Kept till morning: 3 items. Then add what you want to Today, or save it for later.",
    );
    expect(latest.state.nightBefore?.doneFor).toBe(THU);
    await fireEvent.press(screen.getByTestId("night-before-nudge-no"));
    expect(latest.state.nightBefore).toMatchObject({ reminder: false, reminderAsked: true });
    await fireEvent.press(screen.getByTestId("night-before-finish"));
    expect(onDone).toHaveBeenCalled();
    expect(latest.state.nightList?.items).toHaveLength(3);
  });
});

describe("the morning card", () => {
  it("ticked-first rows lead, every row says From last night, Add is off without room", async () => {
    const onTake = jest.fn(() => "done" as const);
    const onFinish = jest.fn();
    await render(
      <NightMorningCard list={list(["A", "B", "C"], ["C"])} room={0} locked={false} onTake={onTake} onFinish={onFinish} />,
    );
    const rows = screen.getAllByTestId("night-morning-row");
    expect(rows).toHaveLength(3);
    expect(screen.getAllByText(/From last night/)).toHaveLength(3);
    expect(screen.getByLabelText("C, from last night, marked first")).toBeTruthy();
    expect(screen.getByTestId("night-morning-blocked").props.children).toBe("Today's three are set. Save it for later instead.");
    expect(screen.getAllByTestId("night-morning-add")[0].props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getAllByTestId("night-morning-save")[0]);
    expect(onTake).toHaveBeenCalledWith("n2", "save");
    expect(screen.getByLabelText("Let the other 3 go")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("night-morning-finish"));
    expect(onFinish).toHaveBeenCalled();
  });
});
