// Reminders end to end (1.4, PR #89): the real store, the real scheduler and
// the real analytics client, with only the system's notification API and the
// network replaced. What is checked is where a task's words can end up:
// with "Hide task names in notifications" on, in no notification at all
// (reminders and the focus timer's end alike); and, on or off, in nothing
// that leaves the phone. Then the switch itself on the Settings screen: it
// is saved, and flipping it rewrites what is pending.
import type { ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import SettingsScreen from "@/app/(tabs)/settings";
import { __resetAnalyticsForTests, __setAnalyticsFetchForTests, flush } from "@/lib/daily-tasks/analytics";
import { REMINDER_SYNC_DEBOUNCE_MS } from "@/lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type NotificationConfig, type Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: false, paywallEnabled: false, entitlementActive: false, entitlementKnown: true, openPaywall: jest.fn(), restore: jest.fn(), redeemCode: jest.fn() }),
}));

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

const mocked = Notifications as jest.Mocked<typeof Notifications>;

interface Scheduled {
  identifier: string;
  content: { title: string; body: string; data?: Record<string, unknown> };
}
/** What is pending, kept as the system would: scheduling an id again replaces it. */
const pending = new Map<string, Scheduled>();
const scheduledCalls = () => mocked.scheduleNotificationAsync.mock.calls.map(([request]) => request as unknown as Scheduled);
const FOCUS_ID = "three-today:focus-timer";

const STORAGE_KEY = "daily-tasks/state/v1";
const taskAt = (id: string, text: string): Task => ({ id, text, createdAt: new Date(2026, 8, 25, 8).toISOString(), carriedOver: false });
const TASKS = [taskAt("t0", "Call the dentist"), taskAt("t1", "Write the quarterly report"), taskAt("t2", "Walk the dog")];
/** Every word of a task, a leftover or a draft used below. */
const TASK_WORDS = /dentist|quarterly|report|Walk|dog|plants|Stretch|passport|Ring/i;

const saved = (notifications: Partial<NotificationConfig>, extra: Partial<AppState> = {}): AppState => {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 8, 25, 8)),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks: TASKS,
    todayCompletions: ["t0"],
    // Last night's close left a draft for tomorrow, and Thursday left one open.
    tomorrowDraft: { forDate: "2026-09-26", tasks: ["Water the plants", "Renew the passport"], note: "", because: "", source: "local" },
    pendingRollover: { sourceDate: "2026-09-24", tasks: [{ id: "y0", text: "Stretch", completed: false, carriedOver: false }] },
    notifications: { ...DEFAULT_NOTIFICATIONS, ...notifications },
    ...extra,
  } as AppState;
  return syncTodayHistory(state, state.lastOpenedDate);
};

function fakeClockAt(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
}

function listenToAppState() {
  const addEventListener = RNAppState.addEventListener as unknown as jest.Mock;
  const original = addEventListener.getMockImplementation();
  const listeners = new Set<(state: string) => void>();
  addEventListener.mockImplementation((_type: string, listener: (state: string) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  return {
    emit: (state: string) => [...listeners].forEach((listener) => listener(state)),
    restore: () => addEventListener.mockImplementation(original),
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, REMINDER_SYNC_DEBOUNCE_MS + 250)));

const analyticsFetch = jest.fn(async () => new Response("{}"));
const networkFetch = jest.fn(async () => {
  throw new Error("network used");
});
const realFetch = globalThis.fetch;
let consoleSpies: jest.SpyInstance[] = [];
let appState: ReturnType<typeof listenToAppState>;

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  pending.clear();
  mocked.scheduleNotificationAsync.mockImplementation(async (request) => {
    const { identifier, content } = request as unknown as Scheduled;
    pending.set(identifier, { identifier, content });
    return identifier;
  });
  mocked.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
    pending.delete(id);
  });
  __resetAnalyticsForTests();
  __setAnalyticsFetchForTests(analyticsFetch as unknown as typeof fetch);
  process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test";
  globalThis.fetch = networkFetch as unknown as typeof fetch;
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  appState = listenToAppState();
  // Friday 25 September 2026, 09:30: the whole day's reminders are still ahead.
  fakeClockAt(new Date(2026, 8, 25, 9, 30));
});

afterEach(() => {
  appState.restore();
  jest.useRealTimers();
  consoleSpies.forEach((spy) => spy.mockRestore());
  globalThis.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  __resetAnalyticsForTests();
});

/** A morning's use of the app: open it, change the tasks about, run a timer, leave and come back. */
async function useTheApp(notifications: Partial<NotificationConfig>) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved(notifications)));
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await settle();
  const { result } = hook;
  await act(async () => result.current.toggleTask("t1"));
  await settle();
  await act(async () => result.current.toggleTask("t1"));
  await act(async () => result.current.editTask("t0", "Ring the dentist"));
  await settle();
  await act(async () => result.current.startFocusSession("t1", { kind: "timer", minutes: 10, source: "row" }));
  await settle();
  await act(async () => result.current.extendFocusSession());
  await act(async () => result.current.stopFocusSession("break"));
  await act(async () =>
    result.current.startFocusSession("t2", { kind: "starter", minutes: 5, source: "coach", stepText: "Find the dog's lead" }),
  );
  await settle();
  await act(async () => result.current.lockToday());
  await act(async () => appState.emit("background"));
  jest.setSystemTime(new Date(2026, 8, 25, 13, 10));
  await act(async () => appState.emit("active"));
  await settle();
  await act(async () => flush());
  return hook;
}

const everythingSent = () => JSON.stringify([analyticsFetch.mock.calls, networkFetch.mock.calls]);
const everythingLogged = () => JSON.stringify(consoleSpies.map((spy) => spy.mock.calls.map((call) => call.map(String))));

describe("Hide task names on: a morning's use of the app", () => {
  it("no notification of any sort is handed to the system with a task's words in it: reminders and both focus timer ends", async () => {
    const { result } = await useTheApp({ hideTaskNames: true });
    expect(result.current.state.notifications.hideTaskNames).toBe(true);

    const calls = scheduledCalls();
    // The reminders (rewritten several times) and the two timers' ends.
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.filter((call) => call.identifier === FOCUS_ID).length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((call) => call.identifier.startsWith("daily-tasks:")).length).toBeGreaterThan(15);
    for (const call of calls) expect(JSON.stringify(call.content)).not.toMatch(TASK_WORDS);

    for (const call of calls.filter((each) => each.identifier === FOCUS_ID)) {
      expect(call.content.title).toBe("Time's up");
      expect(["5 more minutes, or mark it done?", "5 minutes in. Keep going?"]).toContain(call.content.body);
    }
    for (const call of calls.filter((each) => each.identifier.startsWith("daily-tasks:"))) {
      expect(["A calm start | Choose Today's Three.", "A small nudge | Today's Three still need a little attention.", "Still time today | A small finish is still a finish."]).toContain(
        `${call.content.title} | ${call.content.body}`,
      );
    }
    expect(everythingLogged()).not.toMatch(TASK_WORDS);
  });
});

describe("nothing a reminder says leaves the phone", () => {
  it.each([false, true])("hide task names %s: analytics carries no task text and no reminder wording, and there is no other network call", async (hideTaskNames) => {
    await useTheApp({ hideTaskNames });

    // With names shown the words really are in the notifications (so the checks below could fail).
    const notified = JSON.stringify(scheduledCalls().map((call) => call.content));
    if (hideTaskNames) expect(notified).not.toMatch(TASK_WORDS);
    else {
      expect(notified).toMatch(/Ring the dentist/);
      expect(notified).toMatch(/Write the quarterly report/);
      expect(scheduledCalls().some((call) => call.identifier === FOCUS_ID && call.content.title === "Write the quarterly report")).toBe(true);
    }

    // Analytics did send something (the app was opened, a timer was run).
    expect(analyticsFetch).toHaveBeenCalled();
    const sent = everythingSent();
    expect(sent).toMatch(/app_opened/);
    expect(sent).not.toMatch(TASK_WORDS);
    // Nor any line a reminder can say.
    const said = new Set(scheduledCalls().flatMap((call) => [call.content.title, call.content.body]));
    expect(said.size).toBeGreaterThan(3);
    for (const line of said) expect(sent).not.toContain(JSON.stringify(line).slice(1, -1));
    expect(sent).not.toMatch(/hideTaskNames|hide_task_names|Still open|First up|Time's up/);
    // The only thing that used the network was analytics' own client.
    expect(networkFetch).not.toHaveBeenCalled();
    // And only to its batch endpoint.
    for (const [url] of analyticsFetch.mock.calls as unknown as [string][]) expect(String(url)).toMatch(/posthog|\/batch/);
    expect(everythingLogged()).not.toMatch(TASK_WORDS);
  });
});

describe("Settings: the Hide task names switch, to the system and to storage", () => {
  const hideSwitch = () => screen.getByRole("switch", { name: "Hide task names in notifications" });
  const savedState = async (): Promise<AppState> => JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? "{}");
  const pendingWords = () => JSON.stringify([...pending.values()].filter((item) => item.identifier.startsWith("daily-tasks:")).map((item) => item.content));

  async function renderSettings(notifications: Partial<NotificationConfig> = {}) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved(notifications)));
    const view = await render(
      <DailyTasksProvider>
        <SettingsScreen />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("What reminders say")).toBeOnTheScreen());
    await settle();
    return view;
  }

  it("turning it on is saved, and rewrites every pending reminder that named a task; turning it off is saved and brings the names back", async () => {
    await renderSettings();
    expect(pendingWords()).toMatch(/Write the quarterly report/);
    const named = [...pending.values()].filter((item) => TASK_WORDS.test(JSON.stringify(item.content))).map((item) => item.identifier);
    expect(named.length).toBeGreaterThan(5);
    mocked.scheduleNotificationAsync.mockClear();

    await fireEvent(hideSwitch(), "valueChange", true);
    await waitFor(async () => expect((await savedState()).notifications.hideTaskNames).toBe(true), { timeout: 4000 });
    await settle();
    expect(hideSwitch().props.accessibilityState).toMatchObject({ checked: true });
    expect(pendingWords()).not.toMatch(TASK_WORDS);
    // Each one that named a task was rewritten; none was merely left.
    expect(scheduledCalls().map((call) => call.identifier)).toEqual(expect.arrayContaining(named));
    for (const call of scheduledCalls()) expect(JSON.stringify(call.content)).not.toMatch(TASK_WORDS);
    // The other reminder settings were not disturbed.
    expect((await savedState()).notifications).toEqual({ ...DEFAULT_NOTIFICATIONS, hideTaskNames: true });

    await fireEvent(hideSwitch(), "valueChange", false);
    await waitFor(async () => expect((await savedState()).notifications.hideTaskNames).toBe(false), { timeout: 4000 });
    await settle();
    expect(pendingWords()).toMatch(/Write the quarterly report/);
  }, 20_000);

  it("saved as on, the app opens with it on and writes no name from the first sync", async () => {
    await renderSettings({ hideTaskNames: true });
    expect(hideSwitch().props.value).toBe(true);
    expect(hideSwitch().props.accessibilityState).toMatchObject({ checked: true });
    expect(pending.size).toBeGreaterThan(10);
    expect(JSON.stringify(scheduledCalls().map((call) => call.content))).not.toMatch(TASK_WORDS);
  });

  it("it never asks for notification permission: it changes what reminders say, not whether they are allowed", async () => {
    mocked.getPermissionsAsync.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true } as never);
    await renderSettings();
    mocked.requestPermissionsAsync.mockClear();
    await fireEvent(hideSwitch(), "valueChange", true);
    await waitFor(async () => expect((await savedState()).notifications.hideTaskNames).toBe(true), { timeout: 4000 });
    await settle();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
    // Without permission nothing is scheduled at all, hidden or not.
    expect(scheduledCalls().filter((call) => call.identifier.startsWith("daily-tasks:"))).toEqual([]);
  }, 15_000);

  it.each([
    ["Morning reminders", "morning"],
    ["Progress reminders", "progress"],
    ["Evening reminders", "evening"],
    ["Every hour", "hourly"],
  ] as const)("the %s switch is one switch whose checked state follows its value, and flipping it is saved", async (title, key) => {
    await renderSettings();
    const row = () => screen.getByRole("switch", { name: title });
    expect(screen.getAllByRole("switch", { name: title })).toHaveLength(1);
    const before = DEFAULT_NOTIFICATIONS[key];
    expect(row().props.value).toBe(before);
    expect(row().props.accessibilityState).toMatchObject({ checked: before, disabled: false });

    await fireEvent(row(), "valueChange", !before);
    await waitFor(() => expect(row().props.value).toBe(!before));
    expect(row().props.accessibilityState).toMatchObject({ checked: !before });
    await waitFor(async () => expect((await savedState()).notifications[key]).toBe(!before), { timeout: 4000 });
    // It leaves the wording switch alone.
    expect((await savedState()).notifications.hideTaskNames).toBe(false);
  }, 15_000);
});
