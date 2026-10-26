// Nag mode (1.4, PR #91), the cases around the edges, with the real store,
// scheduler, day record and analytics client (as in nag-mode-e2e; only the
// system's notification API, the network and Plus are replaced):
//
// - privacy: with names hidden, paused, Calm, or without Plus nothing is ever
//   sent to the nag-lines route, and with names hidden no pending reminder of
//   any kind carries task text; analytics carries allowlisted ids and counts
//   only; no log line carries a task or a nag's words, also when things fail;
// - no nag is ever time-sensitive, on any path (checked on every write of
//   every test in this file);
// - Plus ending mid-day and coming back; the purchase check still running;
// - the day after: yesterday's pause is over;
// - "Stop for today" on a nag, warm and as the tap that launched the app;
// - saves from before 1.4, damaged nag settings and a damaged day record.
import type { ReactNode } from "react";
import { Alert, AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import SettingsScreen from "@/app/(tabs)/settings";
import * as analyticsModule from "@/lib/daily-tasks/analytics";
import { __resetAnalyticsForTests, __setAnalyticsFetchForTests, flush } from "@/lib/daily-tasks/analytics";
import type { NagLine } from "@/lib/daily-tasks/nag";
import { ensureNagDay, loadNagRecord } from "@/lib/daily-tasks/nag-day";
import { NAG_STORAGE_KEY } from "@/lib/daily-tasks/nag-plan";
import { NAG_ACTION_STOP } from "@/lib/daily-tasks/notifications";
import { REMINDER_SYNC_DEBOUNCE_MS } from "@/lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState, clearState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type NotificationConfig, type Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";
import { UPCOMING_MORNING_DAYS } from "@/lib/daily-tasks/reminders";

const FREE = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: true, paywallSource: null as string | null };
const PLUS = { ...FREE, entitlementActive: true };
/** The purchase check hasn't answered yet. */
const CHECKING = { ...FREE, entitlementKnown: false };
let mockPlus: typeof FREE;
const mockOpenPaywall = jest.fn((_source: string) => true);
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall, restore: jest.fn(), redeemCode: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/announce", () => ({ announcePolitely: jest.fn() }));
// The store waits REMINDER_SYNC_DEBOUNCE_MS (500 ms) before each reminder
// sync, and these tests wait for some 200 syncs. Only the length of that
// wait is changed here (to 100 ms), not what is synced or when it is asked
// for: the whole file then runs in under a minute instead of three.
jest.mock("@/lib/daily-tasks/reminder-plan", () => {
  const actual = jest.requireActual("@/lib/daily-tasks/reminder-plan");
  // In here, not a constant above: this runs before the file's own constants exist.
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
/** The pretend centre: what is pending, as the system would keep it. */
const pending = new Map<string, Stored>();
/** Every notification written during the test, pending still or not. */
let everWritten: Stored[] = [];
const owned = () => [...pending.values()].filter((item) => item.identifier.startsWith("daily-tasks:")).sort((a, b) => a.at.getTime() - b.at.getTime());
const kindOf = (item: Stored) => item.identifier.split(":")[2];
const ofKind = (kind: string) => owned().filter((item) => kindOf(item) === kind);
const snapshot = (items: Stored[] = owned()) => JSON.stringify(items.map(({ identifier, content, at }) => [identifier, content.title, content.body, at.getTime()]));

// Monday 12 October 2026.
const D = "2026-10-12";
const STORAGE_KEY = "daily-tasks/state/v1";
const PROXY = "https://proxy.test/api/momentum/plan";
const taskAt = (id: string, text: string): Task => ({ id, text, createdAt: new Date(2026, 9, 12, 7).toISOString(), carriedOver: false });
// Made-up words: none is in any reminder's or nag's own wording.
const TASKS = [taskAt("t0", "Zorvex the plimth"), taskAt("t1", "Quandle a brispo"), taskAt("t2", "Fennock wuxley")];
// Whole words only: the salt, the hashes in the day's record and analytics'
// random ids are letters and digits, and one could hold "babe" or "champ"
// inside it (a flake). A word of a line or a task is never glued to others.
const TASK_WORDS = /\b(?:zorvex|plimth|quandle|brispo|fennock|wuxley|drambo|kleptu)\b/i;
// Words only a nag's line has: the AI's (below) and a few from each built-in voice.
const LINE_WORDS = /\bAI \d+:|\bplease\.|\b(?:friend|your mother|recruit|champ|better half|babe)\b/i;
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };

const savedState = (notifications: Partial<NotificationConfig>, extra: Partial<AppState> = {}): AppState => {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 9, 12, 7)),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks: TASKS,
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
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, REMINDER_SYNC_DEBOUNCE_MS + 150)));
/**
 * Waits for something the app does a moment later (a debounced sync, the
 * day's record, the AI's answer), however long the machine takes: the check
 * is tried again until it holds, so a slow runner only makes it slower. The
 * sleeps (settle) are for what must NOT happen, and for pacing.
 */
const eventually = (check: () => void | Promise<void>) => waitFor(check, { timeout: 20_000, interval: 50 });
const nagRecordRaw = () => AsyncStorage.getItem(NAG_STORAGE_KEY);

let proxyMode: "ok" | "offline" | "402" | "junk";
/** When set, the proxy's answer waits for it (a slow network). */
let proxyGate: Promise<void> | null;
const analyticsFetch = jest.fn(async (..._args: unknown[]) => new Response("{}"));
const networkFetch = jest.fn(async (url: unknown, init?: RequestInit) => {
  if (proxyGate) await proxyGate;
  if (proxyMode === "offline") throw new Error("offline");
  if (proxyMode === "402") return new Response(JSON.stringify({ error: "not_entitled" }), { status: 402 });
  if (proxyMode === "junk") return new Response("<html>502 Bad Gateway</html>", { status: 200 });
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
let appState: ReturnType<typeof listenToAppState>;
let alert: jest.SpyInstance;

interface Sent {
  event: string;
  properties: Record<string, unknown>;
}
const sentEvents = async (): Promise<Sent[]> => {
  await act(async () => flush());
  return analyticsFetch.mock.calls.flatMap((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).batch) as Sent[];
};
/** Everything written to the console, as text. */
const logged = () =>
  JSON.stringify(
    consoleSpies.map((spy) =>
      spy.mock.calls.map((call) => call.map((part: unknown) => (part instanceof Error ? `${part.message} ${part.stack ?? ""}` : typeof part === "string" ? part : JSON.stringify(part)))),
    ),
  );

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  pending.clear();
  everWritten = [];
  mockPlus = { ...PLUS };
  proxyMode = "ok";
  proxyGate = null;
  mocked.getLastNotificationResponse.mockImplementation(() => null);
  mocked.getPermissionsAsync.mockImplementation(async () => ({ status: "granted", granted: true }) as never);
  mocked.getAllScheduledNotificationsAsync.mockImplementation(
    async () => [...pending.values()].map(({ identifier, content, at }) => ({ identifier, content, trigger: { type: "date", value: at.getTime() } })) as never,
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
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  appState = listenToAppState();
  // 08:00: before the window (9:00 to 21:00) and before every calm slot.
  fakeClockAt(new Date(2026, 9, 12, 8, 0));
});

afterEach(() => {
  // On every path of every test here: a nag is never time-sensitive (it
  // must not break through a Focus), never critical, and makes no sound.
  const nags = everWritten.filter((item) => kindOf(item) === "nag" || item.content.data?.kind === "nag" || item.content.categoryIdentifier === "three-today:nag");
  for (const nag of nags) {
    expect([undefined, "active"]).toContain(nag.content.interruptionLevel);
    expect(nag.content.sound).toBeUndefined();
  }
  // And nothing else took the nag's button.
  for (const other of everWritten.filter((item) => kindOf(item) !== "nag")) expect(other.content.categoryIdentifier).not.toBe("three-today:nag");
  appState.restore();
  alert.mockRestore();
  jest.useRealTimers();
  consoleSpies.forEach((spy) => spy.mockRestore());
  globalThis.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  delete process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL;
  __resetAnalyticsForTests();
});

async function openSaved(raw: string) {
  await AsyncStorage.setItem(STORAGE_KEY, raw);
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await settle();
  await settle();
  return hook;
}
const openApp = (notifications: Partial<NotificationConfig>, extra: Partial<AppState> = {}) => openSaved(JSON.stringify(savedState(notifications, extra)));

/** Leave and come back at `time`: the app looks at the day and the reminders again. */
async function comeBackAt(time: Date) {
  await act(async () => appState.emit("background"));
  jest.setSystemTime(time);
  await act(async () => appState.emit("active"));
  await settle();
  await settle();
}

describe("privacy: when nothing may be sent", () => {
  it.each([
    ["Calm", { ...DEFAULT_NOTIFICATIONS }, PLUS, "calm"],
    ["Calm, with a voice and a level saved from before", { ...NAG_ON, style: "calm" as const, nagPersona: "drill" as const, nagLevel: "relentless" as const }, PLUS, "calm"],
    ["Nag saved, no Plus", NAG_ON, FREE, "calm"],
    ["Nag, paused today", { ...NAG_ON, nagPausedDate: D }, PLUS, "mornings"],
    ["Nag, task names hidden", { ...NAG_ON, hideTaskNames: true }, PLUS, "nags"],
    ["Nag, the purchase check still running", NAG_ON, CHECKING, "nags"],
    ["Nag, reminders off", { ...NAG_ON, enabled: false }, PLUS, "none"],
  ] as const)("%s: no request to the nag-lines route, at launch, on coming back, or after the tasks and the nag settings change", async (_name, notifications, plus, expected) => {
    mockPlus = { ...plus };
    const { result } = await openApp(notifications);
    await comeBackAt(new Date(2026, 9, 12, 8, 30));
    await act(async () => result.current.editTask("t0", "Drambo the kleptu"));
    await settle();
    await act(async () => result.current.setNagPersona("coach"));
    await act(async () => result.current.setNagLevel("gentle"));
    await act(async () => result.current.setNagWindowEdge("end", 20 * 60));
    await settle();
    await settle();
    await act(async () => result.current.toggleTask("t1"));
    await comeBackAt(new Date(2026, 9, 12, 8, 50));

    expect(nagRequests()).toEqual([]);
    expect(networkFetch).not.toHaveBeenCalled();
    if (expected === "calm") {
      await eventually(() => expect(ofKind("progress").length).toBeGreaterThan(0));
      expect(ofKind("nag")).toEqual([]);
      expect(await loadNagRecord()).toBeNull();
    } else if (expected === "mornings") {
      await eventually(() => expect(owned().length).toBeGreaterThan(0));
      expect(owned().every((item) => kindOf(item) === "morning")).toBe(true);
      expect(await loadNagRecord()).toBeNull();
    } else if (expected === "nags") {
      await eventually(() => expect(ofKind("nag").length).toBeGreaterThanOrEqual(3));
      expect(ofKind("nag").every((item) => !/^AI /.test(item.content.body))).toBe(true);
      await eventually(async () => expect(await loadNagRecord()).toMatchObject({ source: "local", aiCalls: 0, aiFor: null, aiFetchedAt: null }));
    } else {
      expect(owned()).toEqual([]);
    }
    // No nag was ever written where nags don't apply.
    if (expected === "calm" || expected === "mornings" || expected === "none") expect(everWritten.filter((item) => kindOf(item) === "nag")).toEqual([]);
  }, 30_000);

  it.each([
    ["Nag", NAG_ON, PLUS],
    ["Nag, paused today", { ...NAG_ON, nagPausedDate: D }, PLUS],
    ["Calm", { ...DEFAULT_NOTIFICATIONS }, PLUS],
    ["Nag saved, no Plus", NAG_ON, FREE],
    ["Nag, the purchase check still running", NAG_ON, CHECKING],
  ] as const)("names hidden, %s: no task text in any title, body or data ever written, and nothing sent", async (_name, notifications, plus) => {
    mockPlus = { ...plus };
    const { result } = await openApp({ ...notifications, hideTaskNames: true });
    await act(async () => result.current.editTask("t0", "Drambo the kleptu"));
    await settle();
    await act(async () => result.current.toggleTask("t1"));
    await act(async () => result.current.setNagPersona("spouse"));
    await comeBackAt(new Date(2026, 9, 12, 8, 30));
    await eventually(() => expect(everWritten.length).toBeGreaterThan(0));
    expect(JSON.stringify(everWritten.map((item) => [item.identifier, item.content]))).not.toMatch(TASK_WORDS);
    // A hidden nag points at no task either.
    expect(everWritten.filter((item) => kindOf(item) === "nag").every((item) => item.content.data?.taskId === undefined)).toBe(true);
    expect(networkFetch).not.toHaveBeenCalled();
    expect(logged()).not.toMatch(TASK_WORDS);
  }, 30_000);

  it("hiding names mid-day stops the sending for the rest of the day, also for a new task; showing them again may ask once more", async () => {
    const { result } = await openApp(NAG_ON);
    await eventually(() => expect(nagRequests()).toHaveLength(1));
    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await settle();
    await settle();
    await act(async () => result.current.editTask("t0", "Drambo the kleptu"));
    await act(async () => result.current.setNagLevel("relentless"));
    await comeBackAt(new Date(2026, 9, 12, 8, 30));
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ hideNames: true, source: "local", level: "relentless" }));
    await eventually(() => {
      expect(ofKind("nag").length).toBeGreaterThan(0);
      expect(JSON.stringify(owned().map((item) => item.content))).not.toMatch(TASK_WORDS);
    });
    expect(nagRequests()).toHaveLength(1);
    // The saved record's lines no longer hold the AI's words about the tasks.
    expect(JSON.stringify((await loadNagRecord())?.lines)).not.toMatch(TASK_WORDS);

    await act(async () => result.current.setHideTaskNamesInNotifications(false));
    await eventually(() => expect(nagRequests()).toHaveLength(2));
    expect(JSON.parse(String((nagRequests()[1] as [string, RequestInit])[1].body)).tasks).toEqual([{ text: "Drambo the kleptu" }, { text: "Quandle a brispo" }, { text: "Fennock wuxley" }]);
    // Two a day, whatever happens next.
    await act(async () => result.current.editTask("t1", "Kleptu again"));
    await act(async () => result.current.setNagPersona("drill"));
    await comeBackAt(new Date(2026, 9, 12, 8, 45));
    expect(nagRequests()).toHaveLength(2);
  }, 30_000);
});

describe("privacy: analytics and logs", () => {
  const ALLOWED: Record<string, string[]> = {
    nag_mode_enabled: ["persona", "level"],
    nag_mode_disabled: [],
    nag_paused_today: ["source"],
    nag_lines_loaded: ["source", "count"],
  };

  it.each(["ok", "offline", "402", "junk"] as const)("proxy %s: every nag event carries only its allowlisted ids and counts, and no log line has a task or a nag's words", async (mode) => {
    proxyMode = mode;
    const trackSpy = jest.spyOn(analyticsModule, "track");
    const { result } = await openApp({ ...DEFAULT_NOTIFICATIONS });
    await act(async () => result.current.setReminderStyle("nag"));
    await settle();
    await settle();
    await act(async () => result.current.setNagPersona("drill"));
    await act(async () => result.current.setNagLevel("relentless"));
    await settle();
    await act(async () => result.current.editTask("t0", "Drambo the kleptu"));
    await settle();
    await settle();
    await act(async () => result.current.pauseNagToday("settings"));
    await act(async () => result.current.resumeNag());
    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await settle();
    await act(async () => result.current.setReminderStyle("calm"));
    await settle();

    // What the code hands to the analytics client, before the client's own allowlist: ids and counts already.
    const nagHanded = () => trackSpy.mock.calls.filter(([event]) => String(event).startsWith("nag_")) as unknown as [string, Record<string, unknown> | undefined][];
    await eventually(() => expect(nagHanded().length).toBeGreaterThanOrEqual(4));
    const handed = nagHanded();
    for (const [event, props] of handed) {
      expect(Object.keys(props ?? {}).sort()).toEqual([...ALLOWED[event]].sort());
      for (const value of Object.values(props ?? {})) expect(String(value)).toMatch(/^[a-z0-9]{1,12}$/);
    }

    const sent = await sentEvents();
    const nagEvents = sent.filter((item) => item.event.startsWith("nag_"));
    expect(nagEvents.map((item) => item.event)).toEqual(expect.arrayContaining(["nag_mode_enabled", "nag_lines_loaded", "nag_paused_today", "nag_mode_disabled"]));
    for (const { event, properties } of nagEvents) {
      expect(Object.keys(ALLOWED)).toContain(event);
      // Its own props are the allowlisted ones and nothing else (the rest are the client's own, "$..." and the like, checked below).
      for (const key of ALLOWED[event]) expect(properties[key]).toBeDefined();
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === "string" && !key.startsWith("$")) expect(value).toMatch(/^[A-Za-z0-9_.-]{1,80}$/);
      }
    }
    expect(nagEvents.find((item) => item.event === "nag_mode_enabled")?.properties).toMatchObject({ persona: "mom", level: "firm" });
    expect(nagEvents.find((item) => item.event === "nag_paused_today")?.properties).toMatchObject({ source: "settings" });
    for (const loaded of nagEvents.filter((item) => item.event === "nag_lines_loaded")) {
      expect(["ai", "local"]).toContain(loaded.properties.source);
      expect(Number.isInteger(loaded.properties.count)).toBe(true);
      if (mode !== "ok") expect(loaded.properties.source).toBe("local");
    }
    // Events of the same name share one set of keys: nothing extra rides along on some of them.
    for (const name of Object.keys(ALLOWED)) {
      const keySets = new Set(nagEvents.filter((item) => item.event === name).map((item) => Object.keys(item.properties).sort().join(",")));
      expect(keySets.size).toBeLessThanOrEqual(1);
    }
    const analytics = JSON.stringify(analyticsFetch.mock.calls);
    expect(analytics).not.toMatch(TASK_WORDS);
    expect(analytics).not.toMatch(LINE_WORDS);
    // The network: the proxy's nag-lines route only (analytics has its own client here).
    for (const [url] of networkFetch.mock.calls) expect(String(url)).toBe("https://proxy.test/api/momentum/nag-lines");
    expect(nagRequests().length).toBeLessThanOrEqual(2);
    // Logs.
    expect(logged()).not.toMatch(TASK_WORDS);
    expect(logged()).not.toMatch(LINE_WORDS);
  }, 30_000);

  it("the day record can't be saved (storage full): nothing is sent, the calm reminders stay, and nothing about the tasks is logged", async () => {
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation();
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === NAG_STORAGE_KEY) throw new Error(`QuotaExceeded while writing ${value.slice(0, 40)}`);
      return original ? original(key, value) : undefined;
    });
    try {
      await openApp(NAG_ON);
      await comeBackAt(new Date(2026, 9, 12, 8, 30));
      // No record for today: the calm reminders, for now.
      await eventually(() => expect(ofKind("progress").length).toBeGreaterThan(0));
      expect(networkFetch).not.toHaveBeenCalled();
      expect(ofKind("nag")).toEqual([]);
      expect(logged()).not.toMatch(TASK_WORDS);
      expect(logged()).not.toMatch(LINE_WORDS);
    } finally {
      setItem.mockImplementation(original);
    }
  });

  it("'Reset all data' removes the day record (it can hold task text)", async () => {
    await openApp(NAG_ON);
    await eventually(async () => expect(await nagRecordRaw()).toMatch(TASK_WORDS));
    await clearState();
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).toBeNull();
    expect(await loadNagRecord()).toBeNull();
  });
});

describe("the day record goes when it is no longer wanted", () => {
  it("'Reset all data' while the AI is still answering: the record is gone and the late answer doesn't bring task text back", async () => {
    let release = () => {};
    proxyGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { result } = await openApp(NAG_ON);
    await eventually(() => expect(nagRequests()).toHaveLength(1));
    await eventually(async () => expect(await nagRecordRaw()).toMatch(TASK_WORDS));

    await act(async () => result.current.resetAll());
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).toBeNull();
    await act(async () => release());
    await settle();
    await settle();
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).toBeNull();
    expect(result.current.state.notifications.style).toBe("calm");
    expect(ofKind("nag")).toEqual([]);
  });

  it("back to Calm: every word goes out of the record (its lines can name tasks) and what the day needs stays; Nag again carries the day on", async () => {
    const { result } = await openApp(NAG_ON);
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ source: "ai", aiCalls: 1 }));
    expect(await nagRecordRaw()).toMatch(TASK_WORDS);
    const planned = await loadNagRecord();
    await act(async () => result.current.setReminderStyle("calm"));
    await eventually(async () => expect((await loadNagRecord())?.lines).toEqual([]));
    await eventually(() => expect(ofKind("nag")).toEqual([]));
    const raw = (await nagRecordRaw()) ?? "";
    expect(raw).not.toMatch(TASK_WORDS);
    expect(raw).not.toMatch(LINE_WORDS);
    for (const id of TASKS.map((task) => task.id)) expect(raw).not.toContain(`"${id}"`);
    // What stays: the day, the salt, the zone and the AI requests made.
    expect(await loadNagRecord()).toMatchObject({
      dayKey: D,
      salt: planned?.salt,
      zone: planned?.zone,
      aiCalls: 1,
      aiFor: planned?.aiFor,
      aiFetchedAt: planned?.aiFetchedAt,
      lines: [],
      lineTasks: [],
      slots: [],
    });

    await act(async () => result.current.setReminderStyle("nag"));
    await eventually(() => expect(ofKind("nag").length).toBeGreaterThan(0));
    expect(await loadNagRecord()).toMatchObject({ dayKey: D, persona: "mom", salt: planned?.salt, aiCalls: 1 });
    // The same tasks, voice and level were already asked about today: nothing more is sent.
    await settle();
    expect(nagRequests()).toHaveLength(1);
  });

  it("Calm and Nag, back and forth five times in a day: at most two requests for lines, and never more than the level's nags", async () => {
    const { result } = await openApp({ ...NAG_ON, nagLevel: "relentless" });
    await eventually(() => expect(nagRequests()).toHaveLength(1));
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => result.current.setReminderStyle("calm"));
      await eventually(async () => expect((await loadNagRecord())?.lines).toEqual([]));
      // A task reworded while in Calm: one more request is allowed today, and only one.
      if (turn === 1) await act(async () => result.current.editTask("t0", "Drambo the kleptu"));
      await act(async () => result.current.setReminderStyle("nag"));
      await eventually(() => expect(ofKind("nag").length).toBeGreaterThan(0));
      await settle();
      // An hour on, so some nags have gone off before the next turn.
      await comeBackAt(new Date(2026, 9, 12, 10 + turn, 30));
      const record = await loadNagRecord();
      expect(record?.slots.length).toBeLessThanOrEqual(11);
    }
    expect(nagRequests().length).toBeLessThanOrEqual(2);
    expect(nagRequests().length).toBe(2);
    expect((await loadNagRecord())?.aiCalls).toBe(2);
  }, 60_000);

  it("a saved Nag that is only waiting for Plus keeps its record", async () => {
    const hook = await openApp(NAG_ON);
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ source: "ai" }));
    const before = await nagRecordRaw();
    expect(before).not.toBeNull();
    mockPlus = { ...FREE };
    await hook.rerender({});
    await settle();
    await settle();
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).toBe(before);
  });
});

describe("Plus ending and coming back", () => {
  it("mid-day: the pending nags go and the calm nudges return at the next sync; the choice is kept; back on Plus the same nags return with no question and no new request", async () => {
    const hook = await openApp({ ...NAG_ON, nagPersona: "coach", nagLevel: "relentless", nagWindow: { startMinutes: 600, endMinutes: 1320 } });
    await eventually(() => {
      expect(ofKind("nag")).toHaveLength(11);
      expect(ofKind("nag").every((item) => /^AI /.test(item.content.body))).toBe(true);
    });
    const nags = snapshot(ofKind("nag"));
    expect(ofKind("progress")).toEqual([]);
    expect(nagRequests()).toHaveLength(1);
    const choice = { style: "nag", nagConfirmed: true, nagPersona: "coach", nagLevel: "relentless", nagWindow: { startMinutes: 600, endMinutes: 1320 }, nagPausedDate: null };

    // 11:30: some nags have gone off; then the subscription ends.
    await comeBackAt(new Date(2026, 9, 12, 11, 30));
    const atLapse = ofKind("nag");
    const leftAtLapse = snapshot(atLapse);
    const backAt = new Date(2026, 9, 12, 11, 45);
    // The nag times are spread at random, so one may fall between 11:30 and
    // Plus coming back at 11:45: by then it has gone, and only the later ones return.
    const leftWhenBack = snapshot(atLapse.filter((item) => item.at.getTime() > backAt.getTime()));
    mockPlus = { ...FREE };
    await hook.rerender({});
    await eventually(() => {
      expect(ofKind("nag")).toEqual([]);
      expect(ofKind("progress").length).toBeGreaterThan(0);
      expect(ofKind("evening").length).toBeGreaterThan(0);
    });
    expect(hook.result.current.state.notifications).toMatchObject(choice);
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? "{}").notifications).toMatchObject(choice));
    // While it is off, changes to the day ask nothing and bring no nag.
    await act(async () => hook.result.current.toggleTask("t2"));
    await comeBackAt(backAt);
    await act(async () => hook.result.current.toggleTask("t2"));
    await settle();
    expect(ofKind("nag")).toEqual([]);
    expect(nagRequests()).toHaveLength(1);

    // Plus is back.
    mockPlus = { ...PLUS };
    await hook.rerender({});
    await eventually(() => {
      expect(snapshot(ofKind("nag"))).toBe(leftWhenBack);
      expect(ofKind("progress")).toEqual([]);
      expect(ofKind("evening")).toEqual([]);
    });
    await settle();
    expect(snapshot(ofKind("nag"))).toBe(leftWhenBack);
    expect(leftAtLapse).not.toBe(nags);
    expect(ofKind("nag").length).toBeGreaterThan(0);
    expect(nagRequests()).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(hook.result.current.state.notifications).toMatchObject(choice);
    // Nothing was tracked as turned on or off: the setting never changed.
    const sent = await sentEvents();
    expect(sent.filter((item) => item.event === "nag_mode_enabled" || item.event === "nag_mode_disabled")).toEqual([]);
  }, 30_000);

  it("the purchase check still running: nags with built-in lines and nothing sent; confirmed: one request; found without Plus: calm again", async () => {
    mockPlus = { ...CHECKING };
    const hook = await openApp(NAG_ON);
    await eventually(() => expect(ofKind("nag")).toHaveLength(7));
    expect(ofKind("nag").every((item) => !/^AI /.test(item.content.body))).toBe(true);
    expect(networkFetch).not.toHaveBeenCalled();
    const times = ofKind("nag").map((item) => [item.identifier, item.at.getTime()]);

    mockPlus = { ...PLUS };
    await hook.rerender({});
    await eventually(() => {
      expect(nagRequests()).toHaveLength(1);
      expect(ofKind("nag")).toHaveLength(7);
      expect(ofKind("nag").every((item) => /^AI /.test(item.content.body))).toBe(true);
    });
    // The AI changes the words, never the times.
    expect(ofKind("nag").map((item) => [item.identifier, item.at.getTime()])).toEqual(times);

    mockPlus = { ...FREE };
    await hook.rerender({});
    await eventually(() => {
      expect(ofKind("nag")).toEqual([]);
      expect(ofKind("progress").length).toBeGreaterThan(0);
    });
    expect(nagRequests()).toHaveLength(1);
  }, 30_000);

  it("Settings: a saved Nag shows as Calm without Plus and as Nag again with it, with no question asked and no paywall", async () => {
    mockPlus = { ...FREE };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedState({ ...NAG_ON, nagPersona: "spouse" })));
    const tree = () => (
      <DailyTasksProvider>
        <SettingsScreen />
      </DailyTasksProvider>
    );
    const view = await render(tree());
    await waitFor(() => expect(screen.getByRole("header", { name: "Reminder style" })).toBeOnTheScreen());
    const checked = (name: string) => screen.getByRole("radio", { name }).props.accessibilityState.checked;
    expect(checked("Calm")).toBe(true);
    expect(screen.queryByTestId("settings-nag")).toBeNull();

    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await waitFor(() => expect(checked("Nag")).toBe(true));
    expect(checked("Calm")).toBe(false);
    expect(screen.getByTestId("settings-nag")).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "Voice: Partner" }).props.accessibilityState.checked).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? "{}").notifications).toMatchObject({ style: "nag", nagConfirmed: true, nagPersona: "spouse" });
  }, 30_000);
});

describe("the day after", () => {
  it("yesterday's pause is over: the new day has its own nags, yesterday's record is replaced, and the mornings were there all along", async () => {
    const hook = await openApp({ ...NAG_ON, nagPausedDate: D });
    expect(ofKind("nag")).toEqual([]);
    expect(ofKind("morning").length).toBeGreaterThan(0);
    expect(nagRequests()).toEqual([]);

    await comeBackAt(new Date(2026, 9, 13, 8, 0));
    const rollover = hook.result.current.state.pendingRollover;
    if (rollover) await act(async () => hook.result.current.resolveRollover(rollover.tasks.map((task) => task.id)));
    await eventually(() => {
      expect(ofKind("nag").length).toBe(7);
      expect(ofKind("nag").every((item) => item.identifier.startsWith("daily-tasks:2026-10-13:nag:"))).toBe(true);
    });
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ dayKey: "2026-10-13", aiCalls: 1, draws: 0 }));
    const nags = ofKind("nag");
    for (let index = 1; index < nags.length; index += 1) expect(nags[index].at.getTime() - nags[index - 1].at.getTime()).toBeGreaterThanOrEqual(3_600_000);
    expect(ofKind("progress")).toEqual([]);
    expect(ofKind("evening")).toEqual([]);
    expect(await loadNagRecord()).toMatchObject({ dayKey: "2026-10-13", aiCalls: 1, draws: 0 });
    expect(nagRequests()).toHaveLength(1);
    // The old pause date is still saved, and harmless.
    expect(hook.result.current.state.notifications.nagPausedDate).toBe(D);
  }, 30_000);

  it("a day of nags, then the next: none of yesterday's ids is left pending, and the new day's first nag is an hour or more after yesterday's last", async () => {
    // A window that runs to the end of the day, so the two days' nags can meet.
    const hook = await openApp({ ...NAG_ON, nagLevel: "relentless", nagWindow: { startMinutes: 0, endMinutes: 1439 } });
    await eventually(async () => expect((await loadNagRecord())?.slots.length).toBe(11));
    const monday = await loadNagRecord();
    const lastMonday = Math.max(...(monday?.slots ?? []).map((slot) => slot.fireAtMs));
    expect(monday?.slots.length).toBe(11);

    await comeBackAt(new Date(2026, 9, 13, 0, 1));
    const rollover = hook.result.current.state.pendingRollover;
    if (rollover) await act(async () => hook.result.current.resolveRollover(rollover.tasks.map((task) => task.id)));
    await eventually(async () => expect((await loadNagRecord())?.dayKey).toBe("2026-10-13"));
    await eventually(() => {
      expect(ofKind("nag").length).toBeGreaterThan(0);
      expect(owned().filter((item) => item.identifier.startsWith(`daily-tasks:${D}:nag:`))).toEqual([]);
    });
    expect(ofKind("nag")[0].at.getTime() - lastMonday).toBeGreaterThanOrEqual(3_600_000);
  }, 30_000);
});

describe("'Stop for today' on a nag", () => {
  type Response = Notifications.NotificationResponse;
  const response = (identifier: string, actionIdentifier: string, date = 1): Response =>
    ({ actionIdentifier, notification: { date, request: { identifier, content: { data: { kind: "nag", step: 2 } } } } }) as unknown as Response;
  const tap = (given: Response) =>
    act(async () => {
      for (const [listener] of mocked.addNotificationResponseReceivedListener.mock.calls) listener(given);
    });

  it("warm: today's nags are cleared at the next sync, the mornings stay, no calm nudge takes their place; Resume in the app brings the same nags back", async () => {
    const { result } = await openApp(NAG_ON);
    // The day as it is once the AI's lines are in.
    await eventually(() => {
      expect(ofKind("nag")).toHaveLength(7);
      expect(ofKind("nag").every((item) => /^AI /.test(item.content.body))).toBe(true);
    });
    const before = snapshot();
    const mornings = snapshot(ofKind("morning"));
    await tap(response(`daily-tasks:${D}:nag:1405`, NAG_ACTION_STOP));
    await eventually(() => {
      expect(result.current.state.notifications.nagPausedDate).toBe(D);
      expect(ofKind("nag")).toEqual([]);
    });
    expect(ofKind("progress")).toEqual([]);
    expect(ofKind("evening")).toEqual([]);
    expect(snapshot(ofKind("morning"))).toBe(mornings);
    expect(ofKind("morning").length).toBeGreaterThan(0);
    // Still Nag, and nothing more is asked of the AI while paused.
    expect(result.current.state.notifications.style).toBe("nag");
    await act(async () => result.current.editTask("t0", "Drambo the kleptu"));
    await comeBackAt(new Date(2026, 9, 12, 8, 30));
    expect(ofKind("nag")).toEqual([]);
    expect(nagRequests()).toHaveLength(1);
    const sent = await sentEvents();
    expect(sent.filter((item) => item.event === "nag_paused_today").map((item) => item.properties.source)).toEqual(["notification"]);

    await act(async () => result.current.editTask("t0", "Zorvex the plimth"));
    await act(async () => result.current.resumeNag());
    expect(result.current.state.notifications.nagPausedDate).toBeNull();
    await eventually(() => expect(snapshot()).toBe(before));
  }, 30_000);

  it("cold start, the tap launched the app: once the saved state has loaded today is paused, no nag is left pending, the mornings stay, and the pause is saved", async () => {
    // Yesterday's session left today's nags pending.
    const first = await openApp(NAG_ON);
    await eventually(() => expect(ofKind("nag")).toHaveLength(7));
    await first.unmount();
    __resetStorageForTests();
    mocked.addNotificationResponseReceivedListener.mockClear();
    const leftPending = ofKind("nag")[3];

    jest.setSystemTime(new Date(2026, 9, 12, 14, 10));
    mocked.getLastNotificationResponse.mockImplementation(() => response(leftPending.identifier, NAG_ACTION_STOP, 77));
    const hook = await renderHook(() => useDailyTasks(), { wrapper });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await waitFor(() => expect(hook.result.current.state.notifications.nagPausedDate).toBe(D));
    await eventually(() => {
      expect(ofKind("nag")).toEqual([]);
      expect(ofKind("morning").length).toBeGreaterThan(0);
    });
    await settle();
    expect(ofKind("nag")).toEqual([]);
    expect(ofKind("progress")).toEqual([]);
    expect(ofKind("evening")).toEqual([]);
    // The saved state was loaded, not overwritten by the tap.
    expect(hook.result.current.state.tasks.map((task) => task.id)).toEqual(["t0", "t1", "t2"]);
    expect(hook.result.current.state.notifications.style).toBe("nag");
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? "{}").notifications.nagPausedDate).toBe(D));
    expect(mocked.clearLastNotificationResponse).toHaveBeenCalled();
    const sent = await sentEvents();
    expect(sent.filter((item) => item.event === "nag_paused_today").map((item) => item.properties.source)).toEqual(["notification"]);
  }, 30_000);

  it("cold start from yesterday's nag: today is not paused", async () => {
    mocked.getLastNotificationResponse.mockImplementation(() => response("daily-tasks:2026-10-11:nag:2005", NAG_ACTION_STOP, 5));
    const { result } = await openApp(NAG_ON);
    await eventually(() => expect(ofKind("nag")).toHaveLength(7));
    expect(result.current.state.notifications.nagPausedDate).toBeNull();
  });
});

describe("saved state: old, partial, damaged", () => {
  const withNotifications = (notifications: unknown) => JSON.stringify({ ...savedState({}), notifications });

  it.each([
    ["1.3", { enabled: true, morning: true, progress: true, evening: true, hourly: false }],
    ["1.4 before Nag mode", { enabled: true, morning: true, progress: true, evening: true, hourly: false, hideTaskNames: false }],
    ["the oldest shape", { morning: { enabled: true }, progress: { enabled: true }, evening: { enabled: true } }],
    ["no reminder settings at all", undefined],
  ])("a save from %s loads as Calm with the default voice, level and window: the calm reminders, no nag, nothing sent", async (_what, notifications) => {
    const { result } = await openSaved(withNotifications(notifications));
    expect(result.current.state.notifications).toMatchObject({
      style: "calm",
      nagConfirmed: false,
      nagPersona: "mom",
      nagLevel: "firm",
      nagWindow: { startMinutes: 540, endMinutes: 1260 },
      nagPausedDate: null,
    });
    expect(result.current.state.tasks).toHaveLength(3);
    await eventually(() => {
      expect(ofKind("progress")).toHaveLength(4);
      expect(ofKind("evening")).toHaveLength(6);
      expect(ofKind("morning")).toHaveLength(UPCOMING_MORNING_DAYS);
    });
    expect(ofKind("nag")).toEqual([]);
    expect(networkFetch).not.toHaveBeenCalled();
    expect(await loadNagRecord()).toBeNull();
  });

  it("damaged nag settings load as the defaults without throwing: Nag stays on with Mom, Firm, 9:00 to 21:00", async () => {
    const { result } = await openSaved(
      withNotifications({ ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: "yes", nagPersona: { name: "boss" }, nagLevel: 11, nagWindow: { startMinutes: "nine", endMinutes: null }, nagPausedDate: 20261012 }),
    );
    expect(result.current.state.notifications).toMatchObject({ style: "nag", nagConfirmed: true, nagPersona: "mom", nagLevel: "firm", nagWindow: { startMinutes: 540, endMinutes: 1260 }, nagPausedDate: null });
    await eventually(() => expect(ofKind("nag")).toHaveLength(7));
    const nags = ofKind("nag");
    expect(nags.every((item) => item.content.title.includes("Mom"))).toBe(true);
    expect(nags[0].at.getTime()).toBeGreaterThanOrEqual(new Date(2026, 9, 12, 9).getTime());
    expect(nags[6].at.getTime()).toBeLessThanOrEqual(new Date(2026, 9, 12, 21).getTime());
  });

  it.each([
    ["not JSON", "{\"dayKey\":\"2026-10-12\",\"slots\":[{"],
    ["an empty string", ""],
    ["null", "null"],
    ["a list", "[1,2,3]"],
    ["the wrong shapes", JSON.stringify({ dayKey: 20261012, persona: "mom", level: "firm", salt: "s", slots: "none" })],
    ["today's day with junk inside", JSON.stringify({ dayKey: D, persona: "mom", level: "firm", salt: "s", slots: [null, 7, { id: "x" }], lines: 5, total: "many", timingKey: 9, aiCalls: "lots", version: null })],
    ["another persona's record from last week", JSON.stringify({ dayKey: "2026-10-05", persona: "drill", level: "relentless", salt: "old-salt", slots: [], lines: [], total: 0, timingKey: "x", aiCalls: 2, aiFor: "drill|relentless|x", version: 40 })],
  ])("a day record that is %s is planned afresh: seven nags, one request, no throw, nothing about it logged with task text", async (_what, raw) => {
    await AsyncStorage.setItem(NAG_STORAGE_KEY, raw);
    await openApp(NAG_ON);
    await eventually(() => {
      expect(ofKind("nag")).toHaveLength(7);
      expect(ofKind("nag").every((item) => item.content.title.includes("Mom") && /^AI \d+: /.test(item.content.body))).toBe(true);
    });
    const nags = ofKind("nag");
    for (let index = 1; index < nags.length; index += 1) expect(nags[index].at.getTime() - nags[index - 1].at.getTime()).toBeGreaterThanOrEqual(3_600_000);
    expect(nagRequests()).toHaveLength(1);
    expect(await loadNagRecord()).toMatchObject({ dayKey: D, persona: "mom", level: "firm", source: "ai", aiCalls: 1 });
    expect(logged()).not.toMatch(TASK_WORDS);
  });
});

describe("the AI's lines arriving late", () => {
  it("a slow answer: the built-in nags are pending meanwhile; when it arrives the pending nags are rewritten with its words, at the same times", async () => {
    let release = () => {};
    proxyGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openApp(NAG_ON);
    await eventually(() => {
      expect(nagRequests()).toHaveLength(1);
      expect(ofKind("nag")).toHaveLength(7);
    });
    const early = ofKind("nag");
    expect(early.every((item) => item.content.body.length > 0 && !/^AI /.test(item.content.body))).toBe(true);
    const times = early.map((item) => [item.identifier, item.at.getTime()]);

    await act(async () => release());
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ source: "ai", aiCalls: 1 }));
    await eventually(() => expect(ofKind("nag").every((item) => /^AI \d+: /.test(item.content.body))).toBe(true));
    const late = ofKind("nag");
    expect(late.map((item) => [item.identifier, item.at.getTime()])).toEqual(times);
    expect(nagRequests()).toHaveLength(1);
  }, 30_000);

  it("an answer that comes after some nags went off leaves those as they were said, and writes only the ones still to come", async () => {
    const tasks = TASKS.map((task) => ({ id: task.id, text: task.text, done: false }));
    const input = { today: D, settings: NAG_ON, permissionState: "granted" as const, plus: true, aiAllowed: true, tasks, now: new Date(2026, 9, 12, 8, 0) };
    let builtIn: { id: string; text: string; fireAtMs: number }[] = [];
    const request = jest.fn(async ({ count }: { count: number }) => {
      builtIn = ((await loadNagRecord())?.slots ?? []).map(({ id, text, fireAtMs }) => ({ id, text, fireAtMs }));
      // The answer takes until 13:30: the morning's nags have gone off with their built-in words.
      jest.setSystemTime(new Date(2026, 9, 12, 13, 30));
      return { lines: Array.from({ length: count }, (_unused, index): NagLine => ({ step: index + 1, taskIndex: null, text: `AI line ${index + 1}` })) };
    });
    await ensureNagDay(input, { request: request as never });
    const record = await loadNagRecord();
    const cutoff = new Date(2026, 9, 12, 13, 30).getTime();
    expect(builtIn).toHaveLength(7);
    const wentOff = builtIn.filter((slot) => slot.fireAtMs <= cutoff);
    expect(wentOff.length).toBeGreaterThan(0);
    expect(wentOff.length).toBeLessThan(7);
    for (const slot of record?.slots ?? []) {
      const before = builtIn.find((item) => item.id === slot.id);
      expect(before?.fireAtMs).toBe(slot.fireAtMs);
      if (slot.fireAtMs <= cutoff) expect(slot.text).toBe(before?.text);
      else expect(slot.text).toMatch(/^AI line \d+$/);
    }
    expect(record?.slots).toHaveLength(7);
  });
});
