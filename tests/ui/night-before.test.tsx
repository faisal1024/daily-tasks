// The night before (1.7), with the real store: the lists in the reducer
// (nothing filed at night, two lists one per day, Add / Save / Add the ones
// marked first / Let the rest go in the morning, let go when its day ends),
// the sheet (the words saved after a pause or on leaving, closing keeps
// everything, words added after Edit become rows, a sort that lands after
// closing still counts, one sort at a time), and the morning card.
// Local-time fixtures (26 Nov 2026 is a Thursday).
import type { ReactNode } from "react";
import { Alert, AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { NightBeforeSheet } from "@/components/daily-tasks/night-before-sheet";
import { NightMorningCard } from "@/components/daily-tasks/night-morning-card";
import { requestBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { FREE_AI_DUMPS, freeAiDumpsLeft } from "@/lib/daily-tasks/free-uses";
import { isFromLastNight, morningList, NIGHT_AI_MAX_ROWS, NIGHT_TEXT_SAVE_MS } from "@/lib/daily-tasks/night-before";
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
// No proxy (the simple on-device split) unless a test says so.
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: jest.fn(() => null),
}));
jest.mock("@/lib/daily-tasks/ai-helpers", () => ({
  ...jest.requireActual("@/lib/daily-tasks/ai-helpers"),
  requestBrainDump: jest.fn(),
}));

const THU = "2026-11-26";
const FRI = "2026-11-27";
const SAT = "2026-11-28";
const AT = new Date(2026, 10, 27, 8).toISOString();
const KEY = "daily-tasks/state/v1";

const list = (texts: string[], picked: string[] = [], extra: Partial<NightList> = {}): NightList => ({
  forDay: FRI,
  nightOf: THU,
  text: texts.join("\n"),
  items: texts.map((text, index) => ({ id: `n${index}`, text, picked: picked.includes(text) })),
  source: "local",
  sortedText: texts.join("\n"),
  createdAt: new Date(2026, 10, 26, 21).toISOString(),
  ...extra,
});
const task = (id: string, text: string): Task => ({ id, text, createdAt: "", carriedOver: false });
const on = (state: AppState, day = FRI) => state.nightLists?.find((l) => l.forDay === day) ?? null;

function dayState(day: string, extra: Partial<AppState> = {}): AppState {
  const [y, m, d] = day.split("-").map(Number);
  return syncTodayHistory({ ...buildInitialState(new Date(y, m - 1, d, 9)), lastOpenedDate: day, ...extra }, day);
}
const take = (id: string, how: "add" | "save", today = FRI) =>
  ({ type: "takeNightItem", id, how, today, at: AT }) as const;

describe("the lists in the reducer", () => {
  it("at night a list is held as it is: nothing in Saved for later, no draft, not on Today", () => {
    const held = reducer(dayState(THU), { type: "setNightList", list: list(["Call the dentist", "Buy milk"], ["Buy milk"]) });
    expect(on(held)?.items).toHaveLength(2);
    expect(held.parkedTasks).toEqual([]);
    expect(held.tomorrowDraft).toBeNull();
    expect(held.tasks).toEqual([]);
  });

  it("tonight's list never touches this morning's undecided one; each goes at its own day's end", () => {
    const morning = list(["Old one"], [], { forDay: FRI, nightOf: THU });
    const friday = dayState(FRI, { nightLists: [morning] });
    const tonight = reducer(friday, { type: "setNightList", list: list(["New one"], [], { forDay: SAT, nightOf: FRI }) });
    expect(on(tonight, FRI)).toBe(morning);
    expect(on(tonight, SAT)?.items.map((i) => i.text)).toEqual(["New one"]);
    const saturday = reducer(tonight, { type: "rollover", today: SAT });
    expect(on(saturday, FRI)).toBeNull();
    expect(on(saturday, SAT)?.items).toHaveLength(1);
    expect(saturday.parkedTasks).toEqual([]);
  });

  it("Add puts a row on Today, tagged for its day; Save files it tagged; the rest is let go on finishing", () => {
    const friday = dayState(FRI, { nightLists: [list(["Call the dentist", "Buy milk", "Email Sam"])] });
    const added = reducer(friday, take("n0", "add"));
    expect(added.tasks).toEqual([expect.objectContaining({ text: "Call the dentist", nightFor: FRI })]);
    const saved = reducer(added, take("n1", "save"));
    expect(saved.parkedTasks).toEqual([expect.objectContaining({ text: "Buy milk", nightFor: FRI })]);
    expect(on(saved)?.items.map((item) => item.text)).toEqual(["Email Sam"]);
    expect(on(saved)?.taken).toBe(2);
    const done = reducer(saved, { type: "finishNightList", today: FRI });
    expect(on(done)).toBeNull();
    expect(done.parkedTasks.map((item) => item.text)).toEqual(["Buy milk"]);
    expect(isFromLastNight(done.tasks[0].nightFor, SAT)).toBe(false);
  });

  it("Add the ones marked first: in order, up to Today's room", () => {
    const friday = dayState(FRI, {
      tasks: [task("a", "One")],
      nightLists: [list(["A", "B", "C", "D"], ["B", "C", "D"])],
    });
    const next = reducer(friday, { type: "addNightFirst", today: FRI, at: AT });
    expect(next.tasks.map((t) => t.text)).toEqual(["One", "B", "C"]);
    expect(on(next)?.items.map((i) => i.text)).toEqual(["A", "D"]);
  });

  it("Add follows Today's rules: no room or a set day changes nothing; the same words already there just clear the row", () => {
    const full = dayState(FRI, {
      tasks: [task("a", "One"), task("b", "Two"), task("c", "Three")],
      nightLists: [list(["Call the dentist", "two"])],
    });
    expect(reducer(full, take("n0", "add"))).toBe(full);
    const locked = dayState(FRI, { todayLocked: true, nightLists: [list(["Call the dentist"])] });
    expect(reducer(locked, take("n0", "add")).tasks).toEqual([]);
    const cleared = reducer(full, take("n1", "add"));
    expect(cleared.tasks).toHaveLength(3);
    expect(on(cleared)?.items.map((item) => item.text)).toEqual(["Call the dentist"]);
  });

  it("not before its day; words typed after the list was made are rows in the morning", () => {
    const held = dayState(THU, { nightLists: [list(["Call the dentist"])] });
    expect(reducer(held, take("n0", "add", THU))).toBe(held);
    const edited = dayState(FRI, { nightLists: [{ ...list(["Call the dentist"]), text: "Call the dentist\nCall mum" }] });
    const shown = morningList(edited.nightLists, FRI)!;
    expect(shown.items.map((i) => i.text)).toEqual(["Call the dentist", "Call mum"]);
    const next = reducer(edited, take(shown.items[1].id, "add"));
    expect(next.tasks.map((t) => t.text)).toEqual(["Call mum"]);
    expect(on(next)?.items.map((item) => item.text)).toEqual(["Call the dentist"]);
  });

  it("a row's tag survives Saved for later, and Not today", () => {
    const saved = reducer(dayState(FRI, { nightLists: [list(["Call the dentist"])] }), take("n0", "save"));
    const added = reducer(saved, { type: "addParkedTask", id: saved.parkedTasks[0].id, today: FRI });
    expect(added.tasks[0]).toMatchObject({ text: "Call the dentist", nightFor: FRI });
    const back = reducer(added, { type: "notToday", id: added.tasks[0].id, today: FRI, at: AT });
    expect(back.parkedTasks[0]).toMatchObject({ text: "Call the dentist", nightFor: FRI });
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
  const held = () => on(latest.state);

  async function openSheet(extra: Partial<AppState> = {}) {
    jest.useFakeTimers({
      now: new Date(2026, 10, 26, 21, 0),
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
    });
    const state: AppState = {
      ...buildInitialState(new Date(2026, 10, 26, 21)),
      hasSeenOnboarding: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      ...extra,
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, THU)));
    const view = await render(sheet(true));
    await waitFor(() => expect(latest.ready).toBe(true));
    return view;
  }
  async function makeList(text = "Call the dentist\nBuy milk\nEmail Sam") {
    await fireEvent.changeText(screen.getByTestId("night-before-input"), text);
    await fireEvent.press(screen.getByTestId("night-before-sort"));
    await waitFor(() => expect(screen.getByTestId("night-before-review-title")).toBeTruthy());
  }

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    onClose.mockClear();
    onDone.mockClear();
    await AsyncStorage.clear();
  });

  it("saves the words after a pause, not on every keystroke, and at once on closing (nothing filed)", async () => {
    await openSheet();
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Call the den");
    expect(held()).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, NIGHT_TEXT_SAVE_MS + 50));
    });
    expect(held()).toMatchObject({ forDay: FRI, nightOf: THU, text: "Call the den", items: [] });
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Call the dentist");
    await fireEvent.press(screen.getByTestId("night-before-close"));
    expect(onClose).toHaveBeenCalled();
    expect(held()?.text).toBe("Call the dentist");
    expect(latest.state.parkedTasks).toEqual([]);
  });

  it("going to the background saves the words at once (a swipe-kill keeps them)", async () => {
    const listeners: ((status: string) => void)[] = [];
    jest.spyOn(RNAppState, "addEventListener").mockImplementation((_type, handler) => {
      listeners.push(handler as (status: string) => void);
      return { remove: () => {} } as ReturnType<typeof RNAppState.addEventListener>;
    });
    await openSheet();
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Buy milk");
    expect(held()).toBeNull();
    await act(async () => {
      for (const listener of listeners) listener("background");
    });
    expect(held()?.text).toBe("Buy milk");
  });

  it("makes a list with nothing marked; a mark is 'Do first' only; closing keeps it; reopening shows it", async () => {
    const view = await openSheet();
    await makeList();
    const rows = screen.getAllByTestId("night-before-row");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(rows[1]);
    expect(held()?.items.map((item) => item.picked)).toEqual([false, true, false]);
    expect(screen.getByTestId("night-before-row-first")).toHaveTextContent("Do first");
    await fireEvent.press(screen.getByTestId("night-before-close"));
    expect(held()?.items).toHaveLength(3);
    expect(latest.state.parkedTasks).toEqual([]);
    expect(latest.state.tomorrowDraft).toBeNull();
    await view.rerender(sheet(false));
    await view.rerender(sheet(true));
    expect(screen.getByTestId("night-before-review-title")).toBeTruthy();
    expect(screen.getAllByTestId("night-before-row")[1].props.accessibilityState).toMatchObject({ checked: true });
  });

  it("words added after Edit are never lost: closing turns them into rows, ticks kept", async () => {
    const view = await openSheet();
    await makeList("Call the dentist\nBuy milk");
    await fireEvent.press(screen.getAllByTestId("night-before-row")[0]);
    await fireEvent.press(screen.getByTestId("night-before-edit"));
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Call the dentist\nBuy milk\nCall mum");
    await fireEvent.press(screen.getByTestId("night-before-close"));
    expect(held()?.items.map((item) => [item.text, item.picked])).toEqual([
      ["Call the dentist", true],
      ["Buy milk", false],
      ["Call mum", false],
    ]);
    await view.rerender(sheet(false));
    await view.rerender(sheet(true));
    expect(screen.getAllByTestId("night-before-row")).toHaveLength(3);
  });

  it("Edit with the words unchanged goes back to the list without sorting again", async () => {
    await openSheet();
    await makeList();
    const ids = held()?.items.map((item) => item.id);
    await fireEvent.press(screen.getByTestId("night-before-edit"));
    await fireEvent.press(screen.getByTestId("night-before-sort"));
    expect(screen.getByTestId("night-before-review-title")).toBeTruthy();
    expect(held()?.items.map((item) => item.id)).toEqual(ids);
  });

  it("Keep till morning marks tonight kept, offers the reminder once, and Done hands back", async () => {
    await openSheet();
    await makeList();
    await fireEvent.press(screen.getByTestId("night-before-keep"));
    expect(screen.getByTestId("night-before-done-line").props.children).toBe(
      "3 items kept till morning. In the morning, add what you want to Today or save it for later. The rest is let go.",
    );
    expect(latest.state.nightBefore?.doneFor).toBe(THU);
    expect(screen.getByText("Want a reminder to do this each evening at 8:30 PM?")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("night-before-nudge-no"));
    expect(latest.state.nightBefore).toMatchObject({ reminder: false, reminderAsked: true });
    await fireEvent.press(screen.getByTestId("night-before-finish"));
    expect(onDone).toHaveBeenCalled();
    expect(held()?.items).toHaveLength(3);
  });

  it("a sort that lands after closing still makes the rows (the words are the ones sorted); one sort at a time", async () => {
    (getMomentumAiProxyUrl as jest.Mock).mockReturnValue("https://proxy.test/api/momentum/plan");
    let answer: (value: unknown) => void = () => {};
    (requestBrainDump as jest.Mock).mockImplementation(
      () => new Promise((resolve) => {
        answer = resolve;
      }),
    );
    try {
      await openSheet();
      await fireEvent.changeText(screen.getByTestId("night-before-input"), "dentist\nmilk");
      await fireEvent.press(screen.getByTestId("night-before-sort"));
      await waitFor(() => expect(requestBrainDump).toHaveBeenCalledTimes(1));
      await fireEvent.press(screen.getByTestId("night-before-close"));
      expect(held()).toMatchObject({ text: "dentist\nmilk", items: [] });
      await act(async () => answer({ picks: ["Call the dentist"], parked: ["Buy milk"], source: "ai" }));
      await waitFor(() => expect(held()?.items.map((item) => item.text)).toEqual(["Call the dentist", "Buy milk"]));
      expect(held()?.sortedText).toBe("dentist\nmilk");
      expect(requestBrainDump).toHaveBeenCalledTimes(1);
    } finally {
      (getMomentumAiProxyUrl as jest.Mock).mockReturnValue(null);
      (requestBrainDump as jest.Mock).mockReset();
    }
  });

  it("a dump longer than the AI path can give back is split on the device: every line kept, no free sort spent", async () => {
    (getMomentumAiProxyUrl as jest.Mock).mockReturnValue("https://proxy.test/api/momentum/plan");
    try {
      await openSheet();
      const lines = Array.from({ length: NIGHT_AI_MAX_ROWS + 7 }, (_, i) => `Thing ${i + 1}`);
      await makeList(lines.join("\n"));
      expect(requestBrainDump).not.toHaveBeenCalled();
      expect(held()?.items).toHaveLength(lines.length);
      expect(await freeAiDumpsLeft()).toBe(FREE_AI_DUMPS);
    } finally {
      (getMomentumAiProxyUrl as jest.Mock).mockReturnValue(null);
    }
  });

  it("writing tonight's list leaves this morning's undecided list alone", async () => {
    const morning = list(["Old one"], [], { forDay: THU, nightOf: "2026-11-25" });
    await openSheet({ nightLists: [morning] });
    await makeList("New one");
    expect(on(latest.state, THU)?.items.map((i) => i.text)).toEqual(["Old one"]);
    expect(held()?.items.map((i) => i.text)).toEqual(["New one"]);
  });
});

describe("the morning card", () => {
  const card = (props: Partial<Parameters<typeof NightMorningCard>[0]> = {}) => (
    <NightMorningCard
      list={list(["A", "B", "C"], ["C"])}
      room={0}
      locked={false}
      onTake={jest.fn(() => "done" as const)}
      onAddFirst={jest.fn(() => 0)}
      onFinish={jest.fn()}
      {...props}
    />
  );

  it("marked rows lead, every row says From last night, Add is off without room and says why", async () => {
    await render(card());
    expect(screen.getAllByTestId("night-morning-row")).toHaveLength(3);
    expect(screen.getAllByText(/From last night/)).toHaveLength(3);
    expect(screen.getByLabelText("C, from last night, marked do first")).toBeTruthy();
    expect(screen.getByTestId("night-morning-blocked").props.children).toBe("Today's three are set. Save it for later instead.");
    const add = screen.getAllByTestId("night-morning-add")[0];
    expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    expect(add.props.accessibilityHint).toBe("Today's three are set. Save it for later instead.");
    expect(screen.queryByTestId("night-morning-add-first")).toBeNull();
  });

  it("Add the ones marked first shows with room; Save when full says so", async () => {
    const onAddFirst = jest.fn(() => 1);
    const onTake = jest.fn(() => "full" as const);
    await render(card({ room: 2, onAddFirst, onTake }));
    expect(screen.getByTestId("night-morning-add-first")).toHaveTextContent("Add the one marked first");
    await fireEvent.press(screen.getByTestId("night-morning-add-first"));
    expect(onAddFirst).toHaveBeenCalled();
    await fireEvent.press(screen.getAllByTestId("night-morning-save")[0]);
    expect(onTake).toHaveBeenCalledWith("n2", "save");
    expect(screen.getByTestId("night-morning-blocked").props.children).toBe("Saved for later is full. Add it to Today, or let it go.");
  });

  it("Let all 3 go asks first; Cancel keeps them", async () => {
    const onFinish = jest.fn();
    const alert = jest.spyOn(Alert, "alert");
    await render(card({ onFinish }));
    expect(screen.getByTestId("night-morning-finish")).toHaveTextContent("Let all 3 go");
    await fireEvent.press(screen.getByTestId("night-morning-finish"));
    expect(alert).toHaveBeenCalledWith("Let 3 go?", "They won't be saved.", expect.any(Array));
    expect(onFinish).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === "Let go")?.onPress?.();
    expect(onFinish).toHaveBeenCalled();
    alert.mockRestore();
  });
});
