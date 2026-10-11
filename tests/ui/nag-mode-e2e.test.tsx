// Nag mode end to end (1.4): the real store, the real scheduler, the real
// day record and the real analytics client. Replaced: the system's
// notification API (a pretend centre that keeps what is pending, as in
// notifications-center-sim), the network and Plus. Checked: what is pending
// in calm and in nag mode, that a sync with nothing changed writes nothing,
// that every nag setting, Plus and the day's lines each cause a rewrite, and
// where task text can go (the nag-lines request only; never analytics).
import type { ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { __resetAnalyticsForTests, __setAnalyticsFetchForTests, flush } from "@/lib/daily-tasks/analytics";
import { loadNagRecord } from "@/lib/daily-tasks/nag-day";
import { REMINDER_SYNC_DEBOUNCE_MS } from "@/lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type NotificationConfig, type Task } from "@/lib/daily-tasks/types";

const FREE = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: true, paywallSource: null };
const PLUS = { ...FREE, entitlementActive: true };
let mockPlus: typeof FREE;
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: jest.fn(), restore: jest.fn(), redeemCode: jest.fn() }),
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
const owned = () => [...pending.values()].filter((item) => item.identifier.startsWith("daily-tasks:")).sort((a, b) => a.at.getTime() - b.at.getTime());
const kindOf = (item: Stored) => item.identifier.split(":")[2];
const ofKind = (kind: string) => owned().filter((item) => kindOf(item) === kind);
const writes = () => mocked.scheduleNotificationAsync.mock.calls.length + mocked.cancelScheduledNotificationAsync.mock.calls.length;
const clearWrites = () => {
  mocked.scheduleNotificationAsync.mockClear();
  mocked.cancelScheduledNotificationAsync.mockClear();
  mocked.dismissNotificationAsync.mockClear();
};

// Monday 12 October 2026.
const D = "2026-10-12";
const STORAGE_KEY = "daily-tasks/state/v1";
const PROXY = "https://proxy.test/api/momentum/plan";
const taskAt = (id: string, text: string): Task => ({ id, text, createdAt: new Date(2026, 9, 12, 7).toISOString(), carriedOver: false });
const TASKS = [taskAt("t0", "Call the dentist"), taskAt("t1", "Write the quarterly report"), taskAt("t2", "Walk the dog")];
const TASK_WORDS = /dentist|quarterly|report|Walk the dog|passport/i;
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
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, REMINDER_SYNC_DEBOUNCE_MS + 300)));
/**
 * Waits for something the app does a moment later (a debounced sync, the
 * day's record, the AI's answer), however long the machine takes: the check
 * is tried again until it holds, so a slow runner only makes it slower. The
 * sleeps (settle) are for what must NOT happen, and for pacing.
 */
const eventually = (check: () => void | Promise<void>) => waitFor(check, { timeout: 20_000, interval: 50 });
/** The day's seven nags are pending with the AI's words. */
const aiNagsPending = (count = 7) =>
  eventually(() => {
    expect(ofKind("nag")).toHaveLength(count);
    expect(ofKind("nag").every((item) => /^AI \d+: /.test(item.content.body))).toBe(true);
  });

/** What the proxy answers with: "ok" (lines naming the tasks), or a failure. */
let proxyMode: "ok" | "offline" | "402";
const analyticsFetch = jest.fn(async (..._args: unknown[]) => new Response("{}"));
const networkFetch = jest.fn(async (url: unknown, init?: RequestInit) => {
  if (proxyMode === "offline") throw new Error("offline");
  if (proxyMode === "402") return new Response(JSON.stringify({ error: "not_entitled" }), { status: 402 });
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

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  pending.clear();
  mockPlus = { ...PLUS };
  proxyMode = "ok";
  mocked.getAllScheduledNotificationsAsync.mockImplementation(
    async () => [...pending.values()].map(({ identifier, content, at }) => ({ identifier, content, trigger: { type: "date", value: at.getTime() } })) as never,
  );
  mocked.scheduleNotificationAsync.mockImplementation(async (request) => {
    const { identifier, content, trigger } = request as unknown as { identifier: string; content: Content; trigger: { date: Date } };
    pending.set(identifier, { identifier, content, at: trigger.date });
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
  appState = listenToAppState();
  // 08:00: before the window (9:00 to 21:00) and before every calm slot.
  fakeClockAt(new Date(2026, 9, 12, 8, 0));
});

afterEach(() => {
  appState.restore();
  jest.useRealTimers();
  consoleSpies.forEach((spy) => spy.mockRestore());
  globalThis.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  delete process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL;
  __resetAnalyticsForTests();
});

async function openApp(notifications: Partial<NotificationConfig>, extra: Partial<AppState> = {}) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedState(notifications, extra)));
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await settle();
  await settle();
  return hook;
}

const snapshot = () => JSON.stringify(owned().map(({ identifier, content, at }) => [identifier, content.title, content.body, at.getTime()]));

describe("calm (the default)", () => {
  it("is unchanged: the task-aware reminders, no nags, nothing sent anywhere", async () => {
    const { result } = await openApp({});
    expect(result.current.state.notifications.style).toBe("calm");
    await eventually(() => {
      expect(ofKind("progress")).toHaveLength(4);
      expect(ofKind("evening")).toHaveLength(6);
      expect(ofKind("morning")).toHaveLength(6);
    });
    expect(ofKind("nag")).toEqual([]);
    expect(networkFetch).not.toHaveBeenCalled();
    expect(await loadNagRecord()).toBeNull();
  });

  it("a saved Nag without Plus is calm too: no nags, no request, the choice kept", async () => {
    mockPlus = { ...FREE };
    const { result } = await openApp(NAG_ON);
    expect(result.current.state.notifications.style).toBe("nag");
    await eventually(() => {
      expect(ofKind("progress")).toHaveLength(4);
      expect(ofKind("evening")).toHaveLength(6);
    });
    expect(ofKind("nag")).toEqual([]);
    expect(networkFetch).not.toHaveBeenCalled();
    expect(await loadNagRecord()).toBeNull();
  });
});

describe("nag mode", () => {
  it("the mornings stay, the calm daytime and evening nudges are gone, and the day's nags are pending", async () => {
    await openApp(NAG_ON);
    await aiNagsPending();
    await eventually(() => {
      expect(ofKind("progress")).toEqual([]);
      expect(ofKind("evening")).toEqual([]);
      expect(ofKind("morning")).toHaveLength(6);
    });
    expect(ofKind("morning").every((item) => !item.identifier.startsWith(`daily-tasks:${D}:`))).toBe(true);

    const nags = ofKind("nag");
    expect(nags).toHaveLength(7);
    const start = new Date(2026, 9, 12, 9).getTime();
    const end = new Date(2026, 9, 12, 21).getTime();
    nags.forEach((nag, index) => {
      expect(nag.identifier).toMatch(/^daily-tasks:2026-10-12:nag:\d{4}$/);
      expect(nag.at.getTime()).toBeGreaterThanOrEqual(start);
      expect(nag.at.getTime()).toBeLessThanOrEqual(end);
      if (index > 0) expect(nag.at.getTime() - nags[index - 1].at.getTime()).toBeGreaterThanOrEqual(3_600_000);
      expect(nag.content.title).toBe("Three Today · Mom");
      expect(nag.content.body).toMatch(/^AI \d+: /);
      expect(nag.content.data).toMatchObject({ kind: "nag", step: index + 1, fireAt: nag.at.getTime() });
      expect(["t0", "t1", "t2"]).toContain(nag.content.data?.taskId);
      // Not time-sensitive: a nag does not break through a Focus. Silent, like the other reminders.
      expect([undefined, "active"]).toContain(nag.content.interruptionLevel);
      expect(nag.content.sound).toBeUndefined();
      expect(nag.content.categoryIdentifier).toBe("three-today:nag");
    });
    // Never more than iOS keeps.
    expect(pending.size).toBeLessThanOrEqual(64);
  });

  it("one request for the day, with the open tasks and nothing else of the user's", async () => {
    // A name is saved: it must not be sent.
    await openApp(NAG_ON, { todayCompletions: ["t2"], momentumProfile: { ...buildInitialState().momentumProfile, name: "Sam" } });
    await eventually(() => expect(nagRequests()).toHaveLength(1));
    expect(networkFetch).toHaveBeenCalledTimes(1);
    const [url, init] = nagRequests()[0] as [string, RequestInit];
    expect(url).toBe("https://proxy.test/api/momentum/nag-lines");
    expect(JSON.parse(String(init.body))).toEqual({
      persona: "mom",
      level: "firm",
      tasks: [{ text: "Call the dentist" }, { text: "Write the quarterly report" }],
      count: 7,
    });
  });

  it("a sync with nothing changed writes nothing: coming to the front, again and again", async () => {
    await openApp(NAG_ON);
    await aiNagsPending();
    await settle();
    const before = snapshot();
    clearWrites();
    for (const minute of [5, 20, 40]) {
      await act(async () => appState.emit("background"));
      jest.setSystemTime(new Date(2026, 9, 12, 8, minute));
      await act(async () => appState.emit("active"));
      await settle();
    }
    expect(writes()).toBe(0);
    expect(snapshot()).toBe(before);
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it("a ticked task: its nags are pointed at an open one, at the same times; all ticked: no nags", async () => {
    const { result } = await openApp(NAG_ON);
    await aiNagsPending();
    const times = () => ofKind("nag").map((item) => [item.identifier, item.at.getTime()]);
    const before = times();
    await act(async () => result.current.toggleTask("t0"));
    await eventually(() => {
      expect(JSON.stringify(ofKind("nag").map((item) => item.content))).not.toMatch(/dentist/i);
      expect(ofKind("nag").some((item) => item.content.data?.taskId === "t0")).toBe(false);
      expect(times()).toEqual(before);
    });
    // No two of the day's nags say the same thing, also with the lines put in for the ticked task.
    const bodies = ofKind("nag").map((item) => item.content.body);
    expect(new Set(bodies).size).toBe(bodies.length);
    // The lines weren't asked for again.
    expect(networkFetch).toHaveBeenCalledTimes(1);

    await act(async () => result.current.toggleTask("t1"));
    await act(async () => result.current.toggleTask("t2"));
    await eventually(() => {
      expect(ofKind("nag")).toEqual([]);
      expect(owned().every((item) => kindOf(item) === "morning")).toBe(true);
    });
  });

  it("'Stop nagging me today' clears today's nags and brings no calm nudges; Resume brings the same nags back", async () => {
    const { result } = await openApp(NAG_ON);
    await aiNagsPending();
    const before = snapshot();
    await act(async () => result.current.pauseNagToday());
    expect(result.current.state.notifications.nagPausedDate).toBe(D);
    await eventually(() => expect(ofKind("nag")).toEqual([]));
    await settle();
    expect(ofKind("nag")).toEqual([]);
    expect(ofKind("progress")).toEqual([]);
    expect(ofKind("evening")).toEqual([]);
    expect(ofKind("morning")).toHaveLength(6);
    await act(async () => result.current.resumeNag());
    await eventually(() => expect(snapshot()).toBe(before));
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it("each nag setting rewrites the reminders: persona, level, window, pause, style", async () => {
    const { result } = await openApp(NAG_ON);
    await aiNagsPending();
    /** Makes the change, then waits for the reminders to be what `then` says (and to have been written again). */
    const changed = async (change: () => void, then: () => void) => {
      const before = snapshot();
      clearWrites();
      await act(async () => change());
      await eventually(() => {
        expect(writes()).toBeGreaterThan(0);
        expect(snapshot()).not.toBe(before);
        then();
      });
      // Let a second write that is still on its way (the AI's lines) land before the next change.
      await settle();
      await settle();
      then();
    };
    await changed(
      () => result.current.setNagPersona("drill"),
      () => {
        expect(ofKind("nag").every((item) => item.content.title === "Three Today · Drill sergeant")).toBe(true);
        expect(ofKind("nag")).toHaveLength(7);
      },
    );

    await changed(
      () => result.current.setNagLevel("relentless"),
      () => expect(ofKind("nag")).toHaveLength(11),
    );

    await changed(
      () => result.current.setNagWindowEdge("end", 15 * 60),
      () => {
        expect(ofKind("nag").length).toBeGreaterThan(0);
        expect(ofKind("nag").every((item) => item.at.getTime() <= new Date(2026, 9, 12, 15).getTime())).toBe(true);
      },
    );

    await changed(
      () => result.current.pauseNagToday(),
      () => expect(ofKind("nag")).toEqual([]),
    );
    await changed(
      () => result.current.resumeNag(),
      () => expect(ofKind("nag").length).toBeGreaterThan(0),
    );

    await changed(
      () => result.current.setReminderStyle("calm"),
      () => {
        expect(ofKind("nag")).toEqual([]);
        expect(ofKind("progress")).toHaveLength(4);
        expect(ofKind("evening")).toHaveLength(6);
      },
    );
    // Two requests today at most, whatever was changed.
    expect(nagRequests().length).toBeLessThanOrEqual(2);
    // Every nag was at least an hour from the next at every step (the last state, checked here).
    await changed(
      () => result.current.setReminderStyle("nag"),
      () => expect(ofKind("nag").length).toBeGreaterThan(0),
    );
    expect(nagRequests().length).toBeLessThanOrEqual(2);
    const nags = ofKind("nag");
    for (let index = 1; index < nags.length; index += 1) {
      expect(nags[index].at.getTime() - nags[index - 1].at.getTime()).toBeGreaterThanOrEqual(3_600_000);
    }
  }, 30_000);

  it("leaving Plus stops the nags at the next sync, and the calm reminders are back", async () => {
    const hook = await openApp(NAG_ON);
    await eventually(() => expect(ofKind("nag")).toHaveLength(7));
    mockPlus = { ...FREE };
    await hook.rerender({});
    await eventually(() => {
      expect(ofKind("nag")).toEqual([]);
      expect(ofKind("progress")).toHaveLength(4);
      expect(ofKind("evening")).toHaveLength(6);
    });
    expect(hook.result.current.state.notifications.style).toBe("nag");
  });

  it.each(["offline", "402"] as const)("the proxy %s: built-in lines, still seven nags, and it isn't asked again today", async (mode) => {
    proxyMode = mode;
    await openApp(NAG_ON);
    await eventually(() => expect(ofKind("nag")).toHaveLength(7));
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ source: "local", aiCalls: 1 }));
    const nags = ofKind("nag");
    expect(nags.every((item) => item.content.title === "Three Today · Mom" && item.content.body.length > 0 && !item.content.body.startsWith("AI "))).toBe(true);
    await act(async () => appState.emit("background"));
    jest.setSystemTime(new Date(2026, 9, 12, 8, 30));
    await act(async () => appState.emit("active"));
    await settle();
    expect(nagRequests()).toHaveLength(1);
  });

  it("with task names hidden: nothing is sent, and no nag names a task", async () => {
    await openApp({ ...NAG_ON, hideTaskNames: true });
    await eventually(() => expect(ofKind("nag").length).toBeGreaterThanOrEqual(3));
    expect(networkFetch).not.toHaveBeenCalled();
    const nags = ofKind("nag");
    expect(JSON.stringify(owned().map((item) => item.content))).not.toMatch(TASK_WORDS);
    expect(nags.every((item) => item.content.data?.taskId === undefined)).toBe(true);
  });

  it("names hidden after the nags were written: the pending ones are rewritten without task text, and nothing more is sent", async () => {
    const { result } = await openApp(NAG_ON);
    await aiNagsPending();
    expect(JSON.stringify(ofKind("nag").map((item) => item.content))).toMatch(TASK_WORDS);
    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await eventually(() => {
      expect(ofKind("nag").length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(owned().map((item) => item.content))).not.toMatch(TASK_WORDS);
    });
    await settle();
    expect(JSON.stringify(owned().map((item) => item.content))).not.toMatch(TASK_WORDS);
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it("the next day gets a new record and its own nags; yesterday's are gone", async () => {
    const hook = await openApp(NAG_ON);
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ dayKey: D, aiCalls: 1 }));
    const monday = await loadNagRecord();
    await act(async () => appState.emit("background"));
    jest.setSystemTime(new Date(2026, 9, 13, 8, 0));
    await act(async () => appState.emit("active"));
    await settle();
    // Monday's three are carried into Tuesday so there is something to nag about.
    const rollover = hook.result.current.state.pendingRollover;
    if (rollover) await act(async () => hook.result.current.resolveRollover(rollover.tasks.map((task) => task.id)));
    await eventually(async () => expect(await loadNagRecord()).toMatchObject({ dayKey: "2026-10-13", aiCalls: 1 }));
    const tuesday = await loadNagRecord();
    expect(tuesday?.salt).toBe(monday?.salt);
    await eventually(() => {
      expect(ofKind("nag").length).toBeGreaterThan(0);
      expect(ofKind("nag").every((item) => item.identifier.startsWith("daily-tasks:2026-10-13:nag:"))).toBe(true);
    });
    expect(nagRequests()).toHaveLength(2);
  });
});

describe("where task text goes", () => {
  it("off the phone only in the nag-lines request; analytics never carries a task or a line", async () => {
    const { result } = await openApp({ ...DEFAULT_NOTIFICATIONS });
    await act(async () => result.current.setReminderStyle("nag"));
    await settle();
    await settle();
    await act(async () => result.current.setNagPersona("coach"));
    await settle();
    await act(async () => result.current.editTask("t0", "Renew the passport"));
    await settle();
    await settle();
    await act(async () => result.current.pauseNagToday());
    await act(async () => result.current.resumeNag());
    await act(async () => result.current.setReminderStyle("calm"));
    await settle();
    await act(async () => flush());

    // The network: nag-lines only, twice at most.
    await eventually(() => expect(networkFetch.mock.calls.length).toBeGreaterThanOrEqual(1));
    expect(networkFetch.mock.calls.length).toBeLessThanOrEqual(2);
    for (const [url] of networkFetch.mock.calls) expect(String(url)).toBe("https://proxy.test/api/momentum/nag-lines");

    // Analytics: the events, with ids and counts only.
    const sent = analyticsFetch.mock.calls.flatMap((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).batch) as {
      event: string;
      properties: Record<string, unknown>;
    }[];
    const named = (name: string) => sent.filter((item) => item.event === name).map((item) => item.properties);
    expect(named("nag_mode_enabled")).toEqual([expect.objectContaining({ persona: "mom", level: "firm" })]);
    expect(named("nag_mode_disabled")).toHaveLength(1);
    expect(named("nag_paused_today")).toEqual([expect.objectContaining({ source: "settings" })]);
    const loaded = named("nag_lines_loaded");
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    for (const properties of loaded) {
      expect(["ai", "local"]).toContain(properties.source);
      expect(typeof properties.count).toBe("number");
    }
    const analytics = JSON.stringify(analyticsFetch.mock.calls);
    expect(analytics).not.toMatch(TASK_WORDS);
    expect(analytics).not.toMatch(/AI \d+:|please\.|champ|sweetheart|recruit/i);
    for (const item of sent) {
      for (const [key, value] of Object.entries(item.properties)) {
        if (typeof value === "string" && !key.startsWith("$")) expect(value).toMatch(/^[A-Za-z0-9_.-]{1,80}$/);
      }
    }
    // Logs: no task text either.
    expect(JSON.stringify(consoleSpies.map((spy) => spy.mock.calls.map((call) => call.map(String))))).not.toMatch(TASK_WORDS);
  }, 30_000);
});
