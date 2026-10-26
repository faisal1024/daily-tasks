// 1.6 G, in the real store, scheduler, day record and analytics client (as in
// nag-hardening; only the system's notification API, the network and Plus are
// replaced): the buttons on a nag (Mark done, Snooze 1 hour), the categories a
// nag gets, `nag_action` carrying ids only, the user's own lines never leaving
// the phone, and the Settings editor for them. Dates are local time; the
// day's record is written by hand where an exact time matters.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import SettingsScreen from "@/app/(tabs)/settings";
import { NagOwnLines } from "@/components/daily-tasks/nag-own-lines";
import { __resetAnalyticsForTests, __setAnalyticsFetchForTests, flush } from "@/lib/daily-tasks/analytics";
import { loadNagRecord } from "@/lib/daily-tasks/nag-day";
import { NAG_OWN_LINE_PROBLEMS } from "@/lib/daily-tasks/nag-own-lines";
import { nagAiKey, NAG_STORAGE_KEY, nagSlotId, planNagDay, type NagDayRecord } from "@/lib/daily-tasks/nag-plan";
import { navigateToToday } from "@/lib/daily-tasks/navigation";
import { NAG_ACTION_DONE, NAG_ACTION_SNOOZE, NAG_ACTION_STOP } from "@/lib/daily-tasks/notifications";
import { REMINDER_SYNC_DEBOUNCE_MS } from "@/lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type NotificationConfig, type Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const FREE = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: true, paywallSource: null as string | null };
const PLUS = { ...FREE, entitlementActive: true };
let mockPlus: typeof FREE;
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: jest.fn(() => true), restore: jest.fn(), redeemCode: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/announce", () => ({ announcePolitely: jest.fn() }));
jest.mock("@/lib/daily-tasks/navigation", () => ({ navigateToToday: jest.fn() }));
jest.mock("@/lib/daily-tasks/reminder-plan", () => {
  const actual = jest.requireActual("@/lib/daily-tasks/reminder-plan");
  const debounceMs = 100;
  return {
    ...actual,
    REMINDER_SYNC_DEBOUNCE_MS: debounceMs,
    createDebounced: (run: () => void, delayMs: number = debounceMs) => actual.createDebounced(run, delayMs),
  };
});
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
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;
interface Content {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  interruptionLevel?: string;
  categoryIdentifier?: string;
  sound?: unknown;
}
interface Stored {
  identifier: string;
  content: Content;
  at: Date;
}
const pending = new Map<string, Stored>();
let everWritten: Stored[] = [];
const kindOf = (item: Stored) => item.identifier.split(":")[2];
const nags = () =>
  [...pending.values()]
    .filter((item) => item.identifier.startsWith("daily-tasks:") && kindOf(item) === "nag")
    .sort((a, b) => a.at.getTime() - b.at.getTime());
const nagTimes = () => nags().map((item) => item.at.getTime());

const D = "2026-10-12";
const STORAGE_KEY = "daily-tasks/state/v1";
const PROXY = "https://proxy.test/api/momentum/plan";
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
const ms = (hour: number, minute = 0) => at(hour, minute).getTime();
const taskAt = (id: string, text: string): Task => ({ id, text, createdAt: new Date(2026, 9, 12, 7).toISOString(), carriedOver: false });
const TASKS = [taskAt("t0", "Zorvex the plimth"), taskAt("t1", "Quandle a brispo"), taskAt("t2", "Fennock wuxley")];
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };

const savedState = (notifications: Partial<NotificationConfig>, extra: Partial<AppState> = {}): AppState => {
  const state = {
    ...buildInitialState(new Date(2026, 9, 12, 7)),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks: TASKS,
    notifications: { ...DEFAULT_NOTIFICATIONS, ...notifications },
    ...extra,
  } as AppState;
  return syncTodayHistory(state, state.lastOpenedDate);
};

/** The day planned at 08:00 with fixed salt, its nags put at `times` (local h:m), the AI already asked twice (so never again). */
function craftRecord(times: [number, number][], settings: NotificationConfig = NAG_ON): NagDayRecord {
  const base = planNagDay({ previous: null, now: at(8), dayKey: D, settings, open: TASKS.map(({ id, text }) => ({ id, text })), salt: "act" });
  const slots = times.map(([hour, minute], index) => {
    const source = base.slots[index % base.slots.length];
    return { ...source, step: index + 1, fireAtMs: ms(hour, minute), id: nagSlotId(at(hour, minute)) };
  });
  return { ...base, slots, total: slots.length, aiCalls: 2, aiFor: nagAiKey(base.persona, base.level, TASKS.map(({ id, text }) => ({ id, text }))) };
}

function fakeClockAt(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
}
const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, REMINDER_SYNC_DEBOUNCE_MS + 150)));
const eventually = (check: () => void | Promise<void>) => waitFor(check, { timeout: 20_000, interval: 50 });

const analyticsFetch = jest.fn(async (..._args: unknown[]) => new Response("{}"));
const networkFetch = jest.fn(async (url: unknown, init?: RequestInit) => {
  const payload = JSON.parse(String(init?.body)) as { count: number; tasks: { text: string }[] };
  const lines = Array.from({ length: payload.count }, (_unused, index) => ({
    step: index + 1,
    taskIndex: index % payload.tasks.length,
    text: `AI ${index + 1}: ${payload.tasks[index % payload.tasks.length].text}, please.`,
  }));
  return new Response(JSON.stringify({ lines }), { status: 200, headers: { "Content-Type": "application/json" } });
});
const nagRequests = () => networkFetch.mock.calls.filter(([url]) => String(url).endsWith("/api/momentum/nag-lines"));
const realFetch = globalThis.fetch;
let consoleSpies: jest.SpyInstance[] = [];

interface Sent {
  event: string;
  properties: Record<string, unknown>;
}
const sentEvents = async (): Promise<Sent[]> => {
  await act(async () => flush());
  return analyticsFetch.mock.calls.flatMap((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).batch) as Sent[];
};
/** An event's own properties: what the app added to every event (ids of the install, version) left out. */
const ownProps = (event: Sent) => Object.fromEntries(Object.entries(event.properties).filter(([key]) => !key.startsWith("$") && key !== "distinct_id" && key !== "app_version"));
const logged = () => JSON.stringify(consoleSpies.map((spy) => spy.mock.calls.map((call) => call.map((part: unknown) => (typeof part === "string" ? part : JSON.stringify(part))))));

type Response_ = Notifications.NotificationResponse;
let tapCount = 0;
const response = (identifier: string, actionIdentifier: string, data: Record<string, unknown> = { kind: "nag", step: 2 }): Response_ =>
  ({ actionIdentifier, notification: { date: (tapCount += 1), request: { identifier, content: { data } } } }) as unknown as Response_;
const nagId = (hour: number, minute: number, day = D) => `daily-tasks:${day}:nag:${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
const tap = (given: Response_) =>
  act(async () => {
    for (const [listener] of mocked.addNotificationResponseReceivedListener.mock.calls) listener(given);
  });

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  pending.clear();
  everWritten = [];
  mockPlus = { ...PLUS };
  mocked.getLastNotificationResponse.mockImplementation(() => null);
  mocked.getAllScheduledNotificationsAsync.mockImplementation(
    async () => [...pending.values()].map(({ identifier, content, at: when }) => ({ identifier, content, trigger: { type: "date", value: when.getTime() } })) as never,
  );
  mocked.scheduleNotificationAsync.mockImplementation(async (request) => {
    const { identifier, content, trigger } = request as unknown as { identifier: string; content: Content; trigger: { date: Date } };
    const stored = { identifier, content, at: trigger.date };
    pending.set(identifier, stored);
    everWritten.push(stored);
    return identifier;
  });
  mocked.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
    pending.delete(id);
  });
  __resetAnalyticsForTests();
  __setAnalyticsFetchForTests(analyticsFetch as unknown as typeof fetch);
  process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test";
  process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL = PROXY;
  globalThis.fetch = networkFetch as unknown as typeof fetch;
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  fakeClockAt(at(8));
});

afterEach(() => {
  // On every path: a nag is never time-sensitive, and its buttons follow its task: Mark done only on a nag with a task.
  for (const nag of everWritten.filter((item) => kindOf(item) === "nag")) {
    expect([undefined, "active"]).toContain(nag.content.interruptionLevel);
    expect(nag.content.sound).toBeUndefined();
    const about = typeof nag.content.data?.taskId === "string";
    expect(nag.content.categoryIdentifier).toBe(about ? "three-today:nag" : "three-today:nag-general");
  }
  for (const other of everWritten.filter((item) => kindOf(item) !== "nag")) expect(String(other.content.categoryIdentifier ?? "")).not.toMatch(/three-today:nag/);
  jest.useRealTimers();
  consoleSpies.forEach((spy) => spy.mockRestore());
  globalThis.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  delete process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL;
  __resetAnalyticsForTests();
});

async function openApp(notifications: Partial<NotificationConfig>, { record, now, extra }: { record?: NagDayRecord; now?: Date; extra?: Partial<AppState> } = {}) {
  if (now) jest.setSystemTime(now);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedState(notifications, extra)));
  if (record) await AsyncStorage.setItem(NAG_STORAGE_KEY, JSON.stringify(record));
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await settle();
  await settle();
  return hook;
}

describe("Mark done on a nag", () => {
  const RECORD = () => craftRecord([[10, 0], [11, 30], [14, 0], [16, 0], [18, 0]]);

  it("ticks the task the nag was about, opens Today, counts it once, sends ids only, and the day's nags stop naming it", async () => {
    const { result } = await openApp(NAG_ON, { record: RECORD(), now: at(10, 5) });
    const about = nags().find((item) => typeof item.content.data?.taskId === "string");
    expect(about).toBeTruthy();
    const taskId = String(about!.content.data!.taskId);
    const words = TASKS.find((task) => task.id === taskId)!.text;
    expect(about!.content.body).toContain(words);

    await tap(response(about!.identifier, NAG_ACTION_DONE, about!.content.data));
    expect(result.current.state.todayCompletions).toContain(taskId);
    expect(navigateToToday).toHaveBeenCalled();
    await settle();
    await settle();
    for (const nag of nags()) {
      expect(nag.content.data?.taskId).not.toBe(taskId);
      expect(nag.content.body).not.toContain(words);
    }
    const events = await sentEvents();
    expect(events.filter((e) => e.event === "nag_action").map(ownProps)).toEqual([{ action: "done" }]);
    const completed = events.filter((e) => e.event === "task_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].properties).toMatchObject({ source: "notification" });
    // The same tap again changes nothing (the task stays ticked).
    await tap(response(about!.identifier, NAG_ACTION_DONE, { ...about!.content.data }));
    expect(result.current.state.todayCompletions.filter((id) => id === taskId)).toHaveLength(1);
  }, 30_000);

  it("a task that is already ticked stays ticked (it is not unticked), and no second tick is counted", async () => {
    const { result } = await openApp(NAG_ON, { record: RECORD(), now: at(10, 5) });
    await act(async () => result.current.toggleTask("t1"));
    expect(result.current.state.todayCompletions).toContain("t1");
    await tap(response(nagId(10, 0), NAG_ACTION_DONE, { kind: "nag", step: 1, taskId: "t1" }));
    expect(result.current.state.todayCompletions).toContain("t1");
    const events = await sentEvents();
    expect(events.filter((e) => e.event === "task_completed")).toEqual([]);
    expect(events.filter((e) => e.event === "nag_action").map(ownProps)).toEqual([{ action: "done" }]);
  }, 30_000);

  it("a task that is gone, a nag about no task and another day's nag tick nothing; only today's still open Today", async () => {
    const { result } = await openApp(NAG_ON, { record: RECORD(), now: at(10, 5) });
    const before = [...result.current.state.todayCompletions];
    await tap(response(nagId(10, 0), NAG_ACTION_DONE, { kind: "nag", step: 1, taskId: "ghost" }));
    expect(navigateToToday).toHaveBeenCalledTimes(1);
    await tap(response(nagId(10, 0), NAG_ACTION_DONE, { kind: "nag", step: 1 }));
    expect(navigateToToday).toHaveBeenCalledTimes(2);
    // Yesterday's nag, with a task that is open today: nothing at all happens.
    await tap(response(nagId(20, 5, "2026-10-11"), NAG_ACTION_DONE, { kind: "nag", step: 1, taskId: "t0" }));
    expect(navigateToToday).toHaveBeenCalledTimes(2);
    expect(result.current.state.todayCompletions).toEqual(before);
    const events = await sentEvents();
    expect(events.filter((e) => e.event === "task_completed")).toEqual([]);
    expect(events.filter((e) => e.event === "nag_action")).toHaveLength(2);
  }, 30_000);

  it("the tap that launched the app is applied once the saved state has loaded, once", async () => {
    mocked.getLastNotificationResponse.mockImplementation(() => response(nagId(10, 0), NAG_ACTION_DONE, { kind: "nag", step: 1, taskId: "t2" }));
    const { result } = await openApp(NAG_ON, { record: RECORD(), now: at(10, 5) });
    await waitFor(() => expect(result.current.state.todayCompletions).toContain("t2"));
    expect(result.current.state.todayCompletions.filter((id) => id === "t2")).toHaveLength(1);
    expect(result.current.state.tasks).toHaveLength(3);
    expect(mocked.clearLastNotificationResponse).toHaveBeenCalled();
    const events = await sentEvents();
    expect(events.filter((e) => e.event === "task_completed")).toHaveLength(1);
    expect(events.filter((e) => e.event === "nag_action").map(ownProps)).toEqual([{ action: "done" }]);
  }, 30_000);

  it("a cold launch from a nag of another day does nothing", async () => {
    mocked.getLastNotificationResponse.mockImplementation(() => response(nagId(20, 5, "2026-10-11"), NAG_ACTION_DONE, { kind: "nag", step: 1, taskId: "t0" }));
    const { result } = await openApp(NAG_ON, { record: RECORD(), now: at(10, 5) });
    expect(result.current.state.todayCompletions).toEqual([]);
    expect(navigateToToday).not.toHaveBeenCalled();
  }, 30_000);

  it("with task names hidden every nag is general: no Mark done category, no task id", async () => {
    await openApp({ ...NAG_ON, hideTaskNames: true }, { now: at(8) });
    await eventually(() => expect(nags().length).toBeGreaterThan(0));
    for (const nag of nags()) {
      expect(nag.content.data).not.toHaveProperty("taskId");
      expect(nag.content.categoryIdentifier).toBe("three-today:nag-general");
    }
  }, 30_000);
});

describe("Snooze 1 hour on a nag", () => {
  it("moves the next nag an hour after the tap (earlier than planned), drops none an hour later, and says so as ids only", async () => {
    const record = craftRecord([[10, 0], [11, 30], [14, 0], [16, 0], [18, 0]]);
    await openApp(NAG_ON, { record, now: at(10, 5) });
    expect(nagTimes()).toEqual([ms(11, 30), ms(14, 0), ms(16, 0), ms(18, 0)]);
    await tap(response(nagId(10, 0), NAG_ACTION_SNOOZE));
    await settle();
    await eventually(() => expect(nagTimes()).toEqual([ms(11, 5), ms(14, 0), ms(16, 0), ms(18, 0)]));
    expect((await loadNagRecord())?.snoozedUntil).toBe(ms(11, 5));
    expect(navigateToToday).not.toHaveBeenCalled();
    const events = await sentEvents();
    expect(events.filter((e) => e.event === "nag_action").map(ownProps)).toEqual([{ action: "snooze" }]);
    // The app coming back later in the day keeps the snooze.
    jest.setSystemTime(at(10, 30));
    await settle();
    expect(nagTimes()[0]).toBe(ms(11, 5));
  }, 30_000);

  it("a nag planned sooner than the hour is moved later, and nags within the hour after it are dropped", async () => {
    const record = craftRecord([[10, 0], [11, 0], [12, 15], [13, 0], [15, 0]]);
    await openApp(NAG_ON, { record, now: at(10, 30) });
    await tap(response(nagId(10, 0), NAG_ACTION_SNOOZE));
    await settle();
    await eventually(() => expect(nagTimes()).toEqual([ms(11, 30), ms(13, 0), ms(15, 0)]));
  }, 30_000);

  it("a minute past the window's end the rest of the day goes quiet; at the end itself the nag goes there", async () => {
    await openApp(NAG_ON, { record: craftRecord([[19, 0], [20, 30]]), now: at(20, 1) });
    expect(nagTimes()).toEqual([ms(20, 30)]);
    await tap(response(nagId(19, 0), NAG_ACTION_SNOOZE));
    await settle();
    await eventually(() => expect(nagTimes()).toEqual([]));
  }, 30_000);

  it("at 20:00 the hour ends exactly at the window's end: still a nag, at 21:00", async () => {
    await openApp(NAG_ON, { record: craftRecord([[19, 0], [20, 30]]), now: at(20, 0) });
    await tap(response(nagId(19, 0), NAG_ACTION_SNOOZE));
    await settle();
    await eventually(() => expect(nagTimes()).toEqual([ms(21, 0)]));
  }, 30_000);

  it("a day drawn again after a snooze (another level) starts no earlier than the snooze's end", async () => {
    const { result } = await openApp(NAG_ON, { record: craftRecord([[10, 0], [11, 30], [14, 0]]), now: at(10, 40) });
    await tap(response(nagId(10, 0), NAG_ACTION_SNOOZE));
    await settle();
    await eventually(() => expect(nagTimes()[0]).toBe(ms(11, 40)));
    await act(async () => result.current.setNagLevel("relentless"));
    await settle();
    await settle();
    await eventually(() => expect(nagTimes().length).toBeGreaterThan(1));
    for (const time of nagTimes()) expect(time).toBeGreaterThanOrEqual(ms(11, 40));
  }, 30_000);

  it("the tap that launched the app is applied once: the hour is not pushed again by later syncs", async () => {
    mocked.getLastNotificationResponse.mockImplementation(() => response(nagId(10, 0), NAG_ACTION_SNOOZE));
    await openApp(NAG_ON, { record: craftRecord([[10, 0], [11, 30], [14, 0], [16, 0]]), now: at(10, 5) });
    await eventually(() => expect(nagTimes()).toEqual([ms(11, 5), ms(14, 0), ms(16, 0)]));
    jest.setSystemTime(at(10, 20));
    await settle();
    await settle();
    expect(nagTimes()).toEqual([ms(11, 5), ms(14, 0), ms(16, 0)]);
    expect(nags()[0].content.data?.step).toBe(2);
  }, 30_000);

  it("another day's snooze changes nothing; Stop for today still pauses and says its own event", async () => {
    const { result } = await openApp(NAG_ON, { record: craftRecord([[10, 0], [11, 30], [14, 0]]), now: at(10, 5) });
    const before = nagTimes();
    await tap(response(nagId(20, 5, "2026-10-11"), NAG_ACTION_SNOOZE));
    await settle();
    expect(nagTimes()).toEqual(before);
    await tap(response(nagId(10, 0), NAG_ACTION_STOP));
    expect(result.current.state.notifications.nagPausedDate).toBe(D);
    const events = await sentEvents();
    expect(events.filter((e) => e.event === "nag_action").map(ownProps)).toEqual([{ action: "stop" }]);
  }, 30_000);
});

describe("the user's own lines in a running app", () => {
  const OWN = ["Zebra rule number one.", "Mango law for {task}.", "Kiwi decree three."];

  it("are on the nags, in the voice's title, and never sent to the AI service, analytics or the log", async () => {
    const { result } = await openApp({ ...NAG_ON, nagLevel: "relentless", nagOwnLines: OWN }, { now: at(8) });
    await eventually(() => expect(nagRequests().length).toBe(1));
    await eventually(() => expect(nags().length).toBeGreaterThan(3));
    const own = nags().filter((item) => /Zebra|Mango|Kiwi/.test(item.content.body));
    expect(own.length).toBeGreaterThan(0);
    expect(own.length).toBeLessThanOrEqual(Math.floor(nags().length / 3));
    for (const item of own) expect(item.content.title).toMatch(/^Three Today · /);
    // Never two in a row among the pending nags.
    const flags = nags().map((item) => /Zebra|Mango|Kiwi/.test(item.content.body));
    flags.forEach((flag, index) => {
      if (flag && index > 0) expect(flags[index - 1]).toBe(false);
    });
    // A line with {task} names the nag's task and ticks it with Mark done.
    for (const item of own.filter((it) => /Mango/.test(it.content.body))) {
      const task = TASKS.find((candidate) => candidate.id === item.content.data?.taskId);
      expect(task).toBeTruthy();
      expect(item.content.body).toContain(task!.text);
    }
    await act(async () => result.current.editTask("t0", "Drambo the kleptu"));
    await settle();
    await settle();
    const events = JSON.stringify(await sentEvents());
    const requests = JSON.stringify(networkFetch.mock.calls.map(([url, init]) => [String(url), String((init as RequestInit | undefined)?.body ?? "")]));
    for (const text of [events, requests, logged()]) expect(text).not.toMatch(/zebra|mango|kiwi|number one|decree|nagOwnLines/i);
  }, 40_000);

  it("changing them in Settings rewrites the pending nags at once, asks the AI for nothing more, and leaves the day's plan alone", async () => {
    const { result } = await openApp({ ...NAG_ON, nagLevel: "relentless" }, { now: at(8) });
    await eventually(() => expect(nagRequests().length).toBe(1));
    await eventually(() => expect(nags().length).toBeGreaterThan(3));
    const timesBefore = nagTimes();
    const versionBefore = (await loadNagRecord())?.version;
    await act(async () => result.current.setNagOwnLines(["Zebra rule number one."]));
    await settle();
    await eventually(() => expect(nags().some((item) => item.content.body === "Zebra rule number one.")).toBe(true));
    expect(nagTimes()).toEqual(timesBefore);
    expect((await loadNagRecord())?.version).toBe(versionBefore);
    await act(async () => result.current.setNagOwnLines([]));
    await settle();
    await eventually(() => expect(nags().some((item) => item.content.body === "Zebra rule number one.")).toBe(false));
    expect(nagRequests()).toHaveLength(1);
  }, 40_000);

  it("without Plus a saved line goes nowhere: no nags, no request", async () => {
    mockPlus = { ...FREE };
    await openApp({ ...NAG_ON, nagOwnLines: OWN }, { now: at(8) });
    await settle();
    expect(nags()).toEqual([]);
    expect(nagRequests()).toEqual([]);
  }, 30_000);
});

describe("Settings: In your own words", () => {
  const input = () => screen.getByTestId("settings-nag-own-input");
  const add = async (text: string) => {
    await act(async () => fireEvent.changeText(input(), text));
    await act(async () => fireEvent.press(screen.getByTestId("settings-nag-own-add")));
  };
  const problem = () => screen.queryByTestId("settings-nag-own-problem")?.props.children;
  const tree = () => (
    <DailyTasksProvider>
      <NagOwnLines />
    </DailyTasksProvider>
  );
  const keptLines = async () => JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? "{}").notifications?.nagOwnLines;

  async function open(notifications: Partial<NotificationConfig> = {}) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedState({ ...NAG_ON, ...notifications })));
    const view = await render(tree());
    await waitFor(() => expect(screen.getByTestId("settings-nag-own-lines")).toBeOnTheScreen());
    return view;
  }

  it("adds a line, says what is wrong with one that can't be added, and removes a line", async () => {
    await open();
    await add("   ");
    expect(problem()).toBe(NAG_OWN_LINE_PROBLEMS.empty);
    await add("see https://example.com");
    expect(problem()).toBe(NAG_OWN_LINE_PROBLEMS.link);
    await add("{task} and {task}");
    expect(problem()).toBe(NAG_OWN_LINE_PROBLEMS.placeholder);
    await add("Do {task}, now.");
    expect(problem()).toBeUndefined();
    expect(screen.getByTestId("settings-nag-own-line-0")).toHaveTextContent("Do {task}, now.");
    await add("do {TASK}, NOW.");
    expect(problem()).toBe(NAG_OWN_LINE_PROBLEMS.duplicate);
    await add("‮Evil‬ one");
    expect(screen.getByTestId("settings-nag-own-line-1")).toHaveTextContent("Evil one");
    await waitFor(async () => expect(await keptLines()).toEqual(["Do {task}, now.", "Evil one"]));

    await act(async () => fireEvent.press(screen.getByTestId("settings-nag-own-remove-0")));
    expect(screen.queryByText("Do {task}, now.")).toBeNull();
    expect(screen.getByTestId("settings-nag-own-line-0")).toHaveTextContent("Evil one");
    await waitFor(async () => expect(await keptLines()).toEqual(["Evil one"]));
  });

  it("a problem goes away when typing again; five lines hide the field and removing one brings it back", async () => {
    await open();
    await add("");
    expect(problem()).toBeTruthy();
    await act(async () => fireEvent.changeText(input(), "a"));
    expect(problem()).toBeUndefined();
    for (const line of ["One", "Two", "Three", "Four", "Five"]) await add(line);
    expect(screen.queryByTestId("settings-nag-own-input")).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId("settings-nag-own-remove-4")));
    expect(screen.getByTestId("settings-nag-own-input")).toBeOnTheScreen();
  });

  it("the field holds at most 80 characters", async () => {
    await open();
    expect(input().props.maxLength).toBe(80);
  });

  it("lines already saved are shown; with names hidden, a note says lines with {task} aren't used", async () => {
    await open({ nagOwnLines: ["Plain one.", "Named {task}."], hideTaskNames: true });
    expect(screen.getByTestId("settings-nag-own-line-1")).toHaveTextContent("Named {task}.");
    expect(screen.getByTestId("settings-nag-own-hidden")).toBeOnTheScreen();
  });

  it("with names hidden and no {task} line there is no note", async () => {
    await open({ nagOwnLines: ["Plain one."], hideTaskNames: true });
    expect(screen.queryByTestId("settings-nag-own-hidden")).toBeNull();
  });

  it("lines saved damaged (not strings, duplicates, a sixth, a link) come back as the usable ones only", async () => {
    await open({ nagOwnLines: ["One", "one", 4, "http://x.example", "Two", "Three", "Four", "Five", "Six"] as unknown as string[] });
    expect(screen.getByTestId("settings-nag-own-line-4")).toHaveTextContent("Five");
    expect(screen.queryByTestId("settings-nag-own-line-5")).toBeNull();
    expect(screen.queryByText("Six")).toBeNull();
  });

  it("is in Settings only under Nag with Plus, not in Calm", async () => {
    mockPlus = { ...PLUS };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedState({ ...NAG_ON })));
    const view = await render(
      <DailyTasksProvider>
        <SettingsScreen />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("settings-nag-own-lines")).toBeOnTheScreen());
    view.unmount();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedState({ ...DEFAULT_NOTIFICATIONS })));
    __resetStorageForTests();
    await render(
      <DailyTasksProvider>
        <SettingsScreen />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("header", { name: "Reminder style" })).toBeOnTheScreen());
    expect(screen.queryByTestId("settings-nag-own-lines")).toBeNull();
  });
});
