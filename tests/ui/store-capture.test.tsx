// Capture from anywhere (1.6 E) on the real store: the dump link (cold and
// warm start, one id once, malformed links), the capture inbox (one file per
// capture: Saved for later, never today, oldest first; each file deleted only
// once it's stored; never pushing a saved item out; no double import) and the
// analytics (source and count only, never text). The App Group is a map of
// files and a variable each test fills in.
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

import { redirectSystemPath } from "@/app/+native-intent";
import { track } from "@/lib/daily-tasks/analytics";
import { __resetCaptureForTests, queueCaptureOpen } from "@/lib/daily-tasks/capture";
import { deleteCaptureFile, markCaptureOpenRequestHandled } from "@/lib/daily-tasks/capture-bridge";
import { navigateToToday } from "@/lib/daily-tasks/navigation";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import * as storage from "@/lib/daily-tasks/storage";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import {
  DEFAULT_AUTO_LOCK,
  MAX_PARKED_TASKS,
  type AppState as DailyState,
  type ParkedTask,
  type Task,
} from "@/lib/daily-tasks/types";

// --- The App Group -----------------------------------------------------------

/** The inbox folder: file name → contents. */
const mockFiles = new Map<string, string>();
let mockOpen: { raw: string | null; handledId: string | null } = { raw: null, handledId: null };
/** A delete that doesn't stick (the file stays and is read again next time). */
let mockDeleteSticks = true;
jest.mock("@/lib/daily-tasks/capture-bridge", () => ({
  readCaptureFiles: jest.fn(() => [...mockFiles].map(([name, contents]) => ({ name, contents }))),
  deleteCaptureFile: jest.fn((name: string) => {
    if (!mockDeleteSticks) return false;
    mockFiles.delete(name);
    return true;
  }),
  readCaptureOpenRequest: jest.fn(() => mockOpen),
  markCaptureOpenRequestHandled: jest.fn((id: string) => {
    mockOpen = { ...mockOpen, handledId: id };
  }),
}));

jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  invalidateFocusSession: jest.fn(),
  readFocusCommands: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markFocusCommandsProcessed: jest.fn(),
  readFocusStartRequest: jest.fn(() => ({ raw: null, handledId: null })),
  markFocusStartRequestHandled: jest.fn(),
  focusSessionJson: jest.fn((session: object, rev: number) => JSON.stringify({ v: 1, rev, ...session })),
  writeWidgetSnapshot: jest.fn(),
  writeFocusSession: jest.fn(),
  invalidateWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markWidgetTogglesProcessed: jest.fn(),
}));

jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  registerNagCategory: jest.fn(async () => {}),
  registerNotificationCategories: jest.fn(async () => {}),
  subscribeNagResponses: jest.fn(() => () => {}),
  subscribeFocusResponses: jest.fn(() => () => {}),
}));

jest.mock("@/lib/daily-tasks/navigation", () => ({ navigateToToday: jest.fn() }));

jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: false, paywallEnabled: false, entitlementActive: false, entitlementKnown: true }),
}));

const tracked = track as jest.Mock;
const navigate = navigateToToday as jest.Mock;
const deleteFile = deleteCaptureFile as jest.Mock;
const markOpenHandled = markCaptureOpenRequestHandled as jest.Mock;

const START = new Date(2026, 8, 26, 9, 0);
const TASKS: Task[] = ["Walk", "Read", "Stretch"].map((text, i) => ({
  id: `t${i}`,
  text,
  createdAt: new Date(2026, 8, 26, 8).toISOString(),
  carriedOver: false,
}));

let appStateListeners = new Set<(state: string) => void>();
let restoreAppState: () => void = () => {};
const foreground = () => act(async () => [...appStateListeners].forEach((listener) => listener("active")));

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await act(async () => {});
}

async function renderStore(saved: Partial<DailyState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({
      ...buildInitialState(START),
      hasSeenOnboarding: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: TASKS,
      ...saved,
    }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await flush();
  expect(hook.result.current.ready).toBe(true);
  return hook;
}

/** A link arriving while the app runs: the router asks redirectSystemPath (inside act, as the store updates). */
async function openLink(path: string): Promise<string> {
  let routed = "";
  await act(async () => {
    routed = redirectSystemPath({ path, initial: false });
  });
  return routed;
}

const events = (name: string) => tracked.mock.calls.filter((call) => call[0] === name);
/** A capture file as native code writes it. */
const capture = (name: string, text: unknown, at = START.getTime()) =>
  void mockFiles.set(name, JSON.stringify({ text, at, source: "share" }));
const savedTexts = (state: DailyState) => state.parkedTasks.map((p) => p.text);
const parked = (n: number): ParkedTask[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `saved ${i}`, parkedAt: START.toISOString() }));
const openRequest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "n1", source: "intent", at: START.getTime(), ...over });

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  __resetStorageForTests();
  __resetCaptureForTests();
  mockFiles.clear();
  mockOpen = { raw: null, handledId: null };
  mockDeleteSticks = true;
  jest.clearAllMocks();
  await AsyncStorage.clear();
  const addEventListener = AppState.addEventListener as unknown as jest.Mock;
  const original = addEventListener.getMockImplementation();
  appStateListeners = new Set();
  addEventListener.mockImplementation((_type: string, listener: (state: string) => void) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  });
  restoreAppState = () => addEventListener.mockImplementation(original);
});

afterEach(() => {
  restoreAppState();
  jest.useRealTimers();
});

// --- dailytasks://dump -------------------------------------------------------

describe("the dump link", () => {
  it("cold start: a link the router handed over before the store was ready opens the brain dump on Today once ready", async () => {
    expect(redirectSystemPath({ path: "dailytasks://dump?source=widget&id=w1", initial: true })).toBe("/");
    const { result } = await renderStore();
    await flush();
    expect(result.current.dumpPrompt).toMatchObject({ source: "widget" });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(events("capture_opened")).toEqual([["capture_opened", { source: "widget" }]]);
  });

  it("warm start: a link while the app is running opens it too (and again for a new id)", async () => {
    const { result } = await renderStore();
    expect(result.current.dumpPrompt).toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    await openLink("dailytasks://dump?source=widget&id=a");
    await flush();
    expect(result.current.dumpPrompt).toMatchObject({ source: "widget" });
    expect(navigate).toHaveBeenCalledTimes(1);

    await act(async () => result.current.clearDumpPrompt());
    expect(result.current.dumpPrompt).toBeNull();
    await openLink("dailytasks://dump?source=intent&id=b");
    await flush();
    expect(result.current.dumpPrompt).toMatchObject({ source: "intent" });
    expect(events("capture_opened")).toEqual([
      ["capture_opened", { source: "widget" }],
      ["capture_opened", { source: "intent" }],
    ]);
  });

  it("a plain link with no source counts as a link", async () => {
    const { result } = await renderStore();
    await openLink("dailytasks://dump");
    await flush();
    expect(result.current.dumpPrompt).toMatchObject({ source: "link" });
    expect(events("capture_opened")).toEqual([["capture_opened", { source: "link" }]]);
  });

  it("a malformed link still lands on Today (never throws, never a route that doesn't exist)", async () => {
    const { result } = await renderStore();
    for (const path of [
      "dailytasks://dump?id=%E0%A4%A&source=%",
      "dailytasks://dump?&&&=",
      "dailytasks://dump#fragment",
      "/dump?source=widget%",
    ]) {
      expect(await openLink(path)).toBe("/");
    }
    await flush();
    expect(result.current.state.tasks).toHaveLength(3);
    expect(events("capture_opened").every((call) => ["widget", "intent", "link"].includes(call[1].source))).toBe(true);
  });

  it("only the dump link is taken: other links route as before, and a focus link isn't mistaken for a dump", async () => {
    const { result } = await renderStore();
    expect(await openLink("/settings")).toBe("/settings");
    expect(await openLink("dailytasks://dumps")).toBe("dailytasks://dumps");
    expect(await openLink("dailytasks://focus/start?task=next&source=widget&id=f1")).toBe("/");
    await flush();
    expect(result.current.dumpPrompt).toBeNull();
    expect(events("capture_opened")).toEqual([]);
  });

  it("the same link id counts once, however it arrives (link twice, the link then the App Group copy, a later foreground)", async () => {
    mockOpen = { raw: null, handledId: null };
    const { result } = await renderStore();
    const link = "dailytasks://dump?source=widget&id=w1";
    await openLink(link);
    await flush();
    await act(async () => result.current.clearDumpPrompt());

    // The same link again, and the App Group's copy of the same request.
    await openLink(link);
    mockOpen = { raw: openRequest({ id: "w1", source: "widget" }), handledId: null };
    await foreground();
    await flush();
    expect(result.current.dumpPrompt).toBeNull();
    expect(events("capture_opened")).toHaveLength(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("a request native code left in the App Group opens it once (cold start missed the link), and is marked handled", async () => {
    mockOpen = { raw: openRequest(), handledId: null };
    const { result } = await renderStore();
    await flush();
    expect(result.current.dumpPrompt).toMatchObject({ source: "intent" });
    expect(markOpenHandled).toHaveBeenCalledWith("n1");
    expect(events("capture_opened")).toEqual([["capture_opened", { source: "intent" }]]);

    await act(async () => result.current.clearDumpPrompt());
    await foreground();
    await foreground();
    await flush();
    expect(result.current.dumpPrompt).toBeNull();
    expect(events("capture_opened")).toHaveLength(1);
  });

  it("an old or already handled App Group request is ignored", async () => {
    mockOpen = { raw: openRequest({ at: START.getTime() - 61_000 }), handledId: null };
    const { result } = await renderStore();
    expect(result.current.dumpPrompt).toBeNull();
    mockOpen = { raw: openRequest({ id: "done" }), handledId: "done" };
    await foreground();
    await flush();
    expect(result.current.dumpPrompt).toBeNull();
    expect(events("capture_opened")).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("several waiting requests open one brain dump (the latest source), one event", async () => {
    queueCaptureOpen({ source: "widget", id: "a" });
    queueCaptureOpen({ source: "intent", id: "b" });
    const { result } = await renderStore();
    await flush();
    expect(result.current.dumpPrompt).toMatchObject({ source: "intent" });
    expect(events("capture_opened")).toEqual([["capture_opened", { source: "intent" }]]);
  });

  it("a background launch doesn't open anything until the app is on screen", async () => {
    const current = AppState.currentState;
    (AppState as { currentState: unknown }).currentState = "background";
    try {
      redirectSystemPath({ path: "dailytasks://dump?id=bg", initial: true });
      capture("1.json", "Buy stamps");
      const { result } = await renderStore();
      // A link arriving while the app is still in the background (the listener path).
      await act(async () => queueCaptureOpen({ source: "widget", id: "late" }));
      await flush();
      expect(result.current.dumpPrompt).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(result.current.state.parkedTasks).toEqual([]);
      expect(deleteFile).not.toHaveBeenCalled();
      expect(events("capture_opened")).toEqual([]);

      (AppState as { currentState: unknown }).currentState = "active";
      await foreground();
      await flush();
      // Both waiting requests open one brain dump, the latest.
      expect(result.current.dumpPrompt).toMatchObject({ source: "widget" });
      expect(events("capture_opened")).toHaveLength(1);
      expect(result.current.state.parkedTasks.map((p) => p.text)).toEqual(["Buy stamps"]);
    } finally {
      (AppState as { currentState: unknown }).currentState = current;
    }
  });
});

// --- The capture inbox -------------------------------------------------------

describe("the capture inbox", () => {
  it("saves each capture for later, oldest first (by when it was captured), never onto today's three, and says so", async () => {
    capture("b.json", "  Book\ndentist ", START.getTime() - 2000);
    capture("a.json", "https://example.com/read", START.getTime() - 3000);
    capture("c.json", "Buy stamps", START.getTime() - 1000);
    const { result } = await renderStore({ tasks: [TASKS[0]] });
    await flush();
    expect(savedTexts(result.current.state)).toEqual(["https://example.com/read", "Book dentist", "Buy stamps"]);
    // Today is exactly as it was: still one task, not completed, not locked.
    expect(result.current.state.tasks.map((t) => t.id)).toEqual(["t0"]);
    expect(result.current.state.todayCompletions).toEqual([]);
    expect(result.current.state.todayLocked).toBe(false);
    expect(result.current.captureNotice).toMatchObject({ count: 3, text: null, full: false });
    expect(events("capture_imported")).toEqual([["capture_imported", { count: 3 }]]);
    // A capture is not a request to open the brain dump.
    expect(result.current.dumpPrompt).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    // Every file is gone once saved.
    expect(mockFiles.size).toBe(0);
  });

  it("one capture: the notice carries its text (Today quotes it)", async () => {
    capture("a.json", "Buy stamps");
    const { result } = await renderStore();
    await flush();
    expect(result.current.captureNotice).toMatchObject({ count: 1, text: "Buy stamps", full: false });
  });

  it("on a full, locked day the capture still goes only to Saved for later", async () => {
    capture("a.json", "Idea");
    const { result } = await renderStore({ todayLocked: true, todayLockSource: "manual" });
    await flush();
    expect(result.current.state.tasks.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
    expect(result.current.state.todayLocked).toBe(true);
    expect(savedTexts(result.current.state)).toEqual(["Idea"]);
  });

  it("deletes each file only after Saved for later is stored with it", async () => {
    const storedAtDelete: Promise<string | null>[] = [];
    deleteFile.mockImplementation((name: string) => {
      storedAtDelete.push(AsyncStorage.getItem("daily-tasks/state/v1"));
      mockFiles.delete(name);
      return true;
    });
    capture("1.json", "One", 1);
    capture("2.json", "Two", 2);
    await renderStore();
    await flush();
    expect(deleteFile.mock.calls.map(([name]) => name).sort()).toEqual(["1.json", "2.json"]);
    for (const stored of await Promise.all(storedAtDelete)) {
      expect(savedTexts(JSON.parse(stored!))).toEqual(["One", "Two"]);
    }
  });

  it("if storing fails, no file is deleted; the next foreground stores it and deletes them, without saying or counting it again", async () => {
    const persist = jest.spyOn(storage, "persistState").mockResolvedValueOnce(false);
    try {
      capture("1.json", "Stamps");
      const { result } = await renderStore();
      await flush();
      expect(savedTexts(result.current.state)).toEqual(["Stamps"]);
      expect(deleteFile).not.toHaveBeenCalled();
      expect(mockFiles.has("1.json")).toBe(true);
      await act(async () => result.current.clearCaptureNotice());
      tracked.mockClear();

      await foreground();
      await flush();
      expect(mockFiles.size).toBe(0);
      expect(savedTexts(result.current.state)).toEqual(["Stamps"]);
      expect(result.current.captureNotice).toBeNull();
      expect(events("capture_imported")).toEqual([]);
    } finally {
      persist.mockRestore();
    }
  });

  it("repeated foregrounds don't import again, toast again or count again", async () => {
    capture("1.json", "Once");
    const { result } = await renderStore();
    await flush();
    await act(async () => result.current.clearCaptureNotice());
    await foreground();
    await foreground();
    await foreground();
    await flush();
    expect(savedTexts(result.current.state)).toEqual(["Once"]);
    expect(result.current.captureNotice).toBeNull();
    expect(events("capture_imported")).toHaveLength(1);
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });

  it("a thought saved, deleted from Saved for later, then a foreground: it doesn't come back", async () => {
    capture("1.json", "Gone soon");
    const { result } = await renderStore();
    await flush();
    const id = result.current.state.parkedTasks[0].id;
    await act(async () => result.current.removeParkedTask(id));
    await foreground();
    await flush();
    expect(result.current.state.parkedTasks).toEqual([]);
  });

  it("new captures after the first import are saved on the next foreground", async () => {
    capture("1.json", "First", 1);
    const { result } = await renderStore();
    await flush();
    capture("2.json", "Second", 2);
    await foreground();
    await flush();
    expect(savedTexts(result.current.state)).toEqual(["First", "Second"]);
    expect(events("capture_imported")).toEqual([
      ["capture_imported", { count: 1 }],
      ["capture_imported", { count: 1 }],
    ]);
  });

  it("empty, whitespace and malformed files save nothing, say nothing, and are deleted", async () => {
    capture("1.json", "   ");
    capture("2.json", "");
    mockFiles.set("3.json", JSON.stringify({ at: 3 }));
    mockFiles.set("4.json", "{not json");
    const { result } = await renderStore();
    await flush();
    expect(result.current.state.parkedTasks).toEqual([]);
    expect(result.current.captureNotice).toBeNull();
    expect(events("capture_imported")).toEqual([]);
    expect(mockFiles.size).toBe(0);
    expect(result.current.state.tasks).toHaveLength(3);
  });

  it("an oversized capture is saved cut to one line", async () => {
    capture("1.json", "word ".repeat(1000));
    const { result } = await renderStore();
    await flush();
    const [saved] = result.current.state.parkedTasks;
    expect(Array.from(saved.text).length).toBeLessThanOrEqual(500);
    expect(saved.text.endsWith("…")).toBe(true);
    expect(saved.text).not.toMatch(/\n/);
  });

  it("the same thought twice is saved once, and one already on today's list isn't saved", async () => {
    capture("1.json", "Stamps", 1);
    capture("2.json", "stamps ", 2);
    capture("3.json", "walk", 3);
    const { result } = await renderStore();
    await flush();
    expect(savedTexts(result.current.state)).toEqual(["Stamps"]);
    expect(result.current.captureNotice).toMatchObject({ count: 1, text: "Stamps" });
    expect(events("capture_imported")).toEqual([["capture_imported", { count: 1 }]]);
    expect(mockFiles.size).toBe(0);
  });

  it("a duplicate batch (nothing new to save) says nothing and counts nothing, and its files go", async () => {
    capture("1.json", "walk", 1);
    capture("2.json", "READ", 2);
    const { result } = await renderStore();
    await flush();
    expect(result.current.state.parkedTasks).toEqual([]);
    expect(result.current.captureNotice).toBeNull();
    expect(events("capture_imported")).toEqual([]);
    expect(mockFiles.size).toBe(0);
  });

  it("if deleting a file fails, the next foreground doesn't save, toast or count the same thought again", async () => {
    mockDeleteSticks = false;
    capture("1.json", "Stamps");
    const { result } = await renderStore();
    await flush();
    await act(async () => result.current.clearCaptureNotice());
    tracked.mockClear();
    await foreground();
    await flush();
    expect(savedTexts(result.current.state)).toEqual(["Stamps"]);
    expect(result.current.captureNotice).toBeNull();
    expect(events("capture_imported")).toEqual([]);
  });

  it("Saved for later nearly full: saves only what fits, oldest first, never drops a saved item; the rest wait and Today says it's full", async () => {
    capture("a.json", "First", 1);
    capture("b.json", "Second", 2);
    capture("c.json", "Third", 3);
    const existing = parked(MAX_PARKED_TASKS - 1);
    const { result } = await renderStore({ parkedTasks: existing });
    await flush();
    const texts = savedTexts(result.current.state);
    expect(texts).toHaveLength(MAX_PARKED_TASKS);
    // Every saved item is still there, and the oldest capture came in.
    expect(texts.slice(0, MAX_PARKED_TASKS - 1)).toEqual(existing.map((p) => p.text));
    expect(texts.at(-1)).toBe("First");
    // The toast and the count are the one actually saved.
    expect(result.current.captureNotice).toMatchObject({ count: 1, text: "First", full: true });
    expect(events("capture_imported")).toEqual([["capture_imported", { count: 1 }]]);
    // The other two wait in the inbox.
    expect([...mockFiles.keys()].sort()).toEqual(["b.json", "c.json"]);

    // Said once: another foreground with the same two waiting says nothing new.
    await act(async () => result.current.clearCaptureNotice());
    await foreground();
    await flush();
    expect(result.current.captureNotice).toBeNull();
    expect(events("capture_imported")).toHaveLength(1);

    // Room made: the next one comes in.
    await act(async () => result.current.removeParkedTask("p0"));
    await foreground();
    await flush();
    expect(savedTexts(result.current.state).at(-1)).toBe("Second");
    expect([...mockFiles.keys()]).toEqual(["c.json"]);
    expect(result.current.captureNotice).toMatchObject({ count: 1, text: "Second", full: true });
  });

  // 1.6 F with 1.6 E: a capture's dates are read from the day it was written.
  it("a capture made yesterday that says \"tomorrow\" lands as today; one made today saying \"tomorrow\" is tomorrow", async () => {
    const yesterdayEvening = new Date(2026, 8, 25, 20, 0).getTime();
    capture("a.json", "Call mum tomorrow", yesterdayEvening);
    capture("b.json", "Book the vet tomorrow", START.getTime());
    const { result } = await renderStore({ lastOpenedDate: "2026-09-26" });
    await flush();
    const byText = Object.fromEntries(result.current.state.parkedTasks.map((p) => [p.text, p.when ?? null]));
    expect(byText["Call mum tomorrow"]).toEqual({ kind: "on", date: "2026-09-26" });
    expect(byText["Book the vet tomorrow"]).toEqual({ kind: "on", date: "2026-09-27" });
    // Still only Saved for later: today's three are untouched.
    expect(result.current.state.tasks.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
  });

  it("Saved for later full: nothing is saved, nothing is dropped, it says so", async () => {
    capture("a.json", "Waiting");
    const existing = parked(MAX_PARKED_TASKS);
    const { result } = await renderStore({ parkedTasks: existing });
    await flush();
    expect(result.current.state.parkedTasks).toEqual(existing);
    expect(result.current.captureNotice).toMatchObject({ count: 0, full: true });
    expect(events("capture_imported")).toEqual([]);
    expect([...mockFiles.keys()]).toEqual(["a.json"]);
  });
});

// --- Analytics ---------------------------------------------------------------

describe("capture analytics", () => {
  it("capture_opened carries only the source and capture_imported only the count, never any text", async () => {
    const secret = "my-secret-thought-4412 https://example.com/private?token=abc";
    redirectSystemPath({ path: "dailytasks://dump?source=widget&id=x9&text=leak", initial: true });
    capture("1.json", secret);
    await renderStore();
    await flush();
    const captureEvents = tracked.mock.calls.filter(([name]) => String(name).startsWith("capture_"));
    expect(captureEvents).toEqual([
      ["capture_imported", { count: 1 }],
      ["capture_opened", { source: "widget" }],
    ]);
    expect(JSON.stringify(tracked.mock.calls)).not.toContain("secret-thought");
    expect(JSON.stringify(tracked.mock.calls)).not.toContain("example.com");
    expect(JSON.stringify(tracked.mock.calls)).not.toContain("leak");
    expect(JSON.stringify(tracked.mock.calls)).not.toContain("x9");
  });
});
