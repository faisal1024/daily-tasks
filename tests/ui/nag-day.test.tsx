// Nag mode (1.4): the day's record (lib/daily-tasks/nag-day.ts). When the AI
// is asked and what it is sent, the built-in lines on any failure, a new
// record on a new day, two requests a day at most, nothing sent with task
// names hidden; and the strategies that read the record: never a network
// call, never a rejection, calm when there is nothing to nag with.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { __resetAnalyticsForTests, __setAnalyticsFetchForTests, flush } from "@/lib/daily-tasks/analytics";
import { MomentumAiError } from "@/lib/daily-tasks/ai-status";
import type { NagLine, requestNagLines } from "@/lib/daily-tasks/nag";
import { ensureNagDay, loadNagRecord, NAG_REQUEST_TIMEOUT_MS, nagModeStrategy, nagStrategy, type NagDayInput } from "@/lib/daily-tasks/nag-day";
import { NAG_STORAGE_KEY, type NagDayRecord } from "@/lib/daily-tasks/nag-plan";
import { taskAwareStrategy, type ReminderContext } from "@/lib/daily-tasks/reminder-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "@/lib/daily-tasks/types";

const DAY = "2026-10-12";
const at = (hour: number, minute = 0, day = 12) => new Date(2026, 9, day, hour, minute);
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const TASKS = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
const TASK_WORDS = /dentist|report|Walk the dog/i;

type Request = typeof requestNagLines;
const aiLines = (count: number): NagLine[] =>
  Array.from({ length: count }, (_unused, index) => ({ step: index + 1, taskIndex: index % 3, text: `AI line ${index + 1}` }));

let request: jest.MockedFunction<Request>;
let versions: number[];
const deps = () => ({ request, onChange: (version: number) => versions.push(version) });

const input = (overrides: Partial<NagDayInput> = {}): NagDayInput => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  plus: true,
  aiAllowed: true,
  tasks: TASKS,
  ...overrides,
});

const context = (overrides: Partial<ReminderContext> = {}): ReminderContext => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  tasks: TASKS,
  locked: false,
  yesterdayOpen: [],
  draft: null,
  pending: [],
  lastDeliveredAt: null,
  plus: true,
  ...overrides,
});

const saved = async (): Promise<NagDayRecord> => {
  const record = await loadNagRecord();
  if (!record) throw new Error("no nag record saved");
  return record;
};

const analyticsFetch = jest.fn(async () => new Response("{}"));
const networkFetch = jest.fn(async () => {
  throw new Error("network used");
});
const realFetch = globalThis.fetch;
const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;

const events = async (): Promise<{ event: string; properties: Record<string, unknown> }[]> => {
  await flush();
  return analyticsFetch.mock.calls.flatMap((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).batch);
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  versions = [];
  request = jest.fn(async ({ count }) => ({ lines: aiLines(count) })) as jest.MockedFunction<Request>;
  process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test";
  __resetAnalyticsForTests();
  __setAnalyticsFetchForTests(analyticsFetch as unknown as typeof fetch);
  globalThis.fetch = networkFetch as unknown as typeof fetch;
  jest.useFakeTimers({ now: at(8), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"] });
});

afterEach(() => {
  // Drops the analytics client's waiting flush.
  __resetAnalyticsForTests();
  jest.useRealTimers();
  globalThis.fetch = realFetch;
  process.env.EXPO_PUBLIC_POSTHOG_KEY = KEY;
});

describe("the day's lines", () => {
  it("the first look of the day plans it with built-in lines, then writes the AI's in: one request, with the open tasks", async () => {
    await ensureNagDay(input(), deps());
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual({
      persona: "mom",
      level: "firm",
      tasks: [
        { id: "t0", text: "Call the dentist" },
        { id: "t1", text: "Write the report" },
        { id: "t2", text: "Walk the dog" },
      ],
      count: 7,
      // No name: no AI request carries it.
      timeoutMs: NAG_REQUEST_TIMEOUT_MS,
    });
    const record = await saved();
    expect(record).toMatchObject({ dayKey: DAY, persona: "mom", level: "firm", source: "ai", aiCalls: 1, total: 7, aiFetchedAt: at(8).getTime() });
    expect(record.slots.map((slot) => slot.text)).toEqual(aiLines(7).map((line) => line.text));
    expect(record.slots.map((slot) => slot.taskId)).toEqual(["t0", "t1", "t2", "t0", "t1", "t2", "t0"]);
    // Told twice: the built-in plan, then the AI's lines.
    expect(versions).toEqual([1, 2]);
    expect(record.version).toBe(2);
  });

  it("only open tasks are sent", async () => {
    await ensureNagDay(input({ tasks: [{ ...TASKS[0], done: true }, TASKS[1], { id: "t3", text: "   ", done: false }] }), deps());
    expect(request.mock.calls[0][0].tasks).toEqual([{ id: "t1", text: "Write the report" }]);
  });

  it("looking again changes nothing and asks nothing: a tick, the app coming to the front, the same settings", async () => {
    await ensureNagDay(input(), deps());
    const before = await AsyncStorage.getItem(NAG_STORAGE_KEY);
    await ensureNagDay(input({ now: at(9) }), deps());
    await ensureNagDay(input({ now: at(11), tasks: [{ ...TASKS[0], done: true }, TASKS[1], TASKS[2]] }), deps());
    await ensureNagDay(input({ now: at(13), tasks: TASKS.slice(1) }), deps());
    expect(request).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).toBe(before);
    expect(versions).toEqual([1, 2]);
  });

  it("at most two requests a day: one more for a new task, persona or level, then built-in lines", async () => {
    await ensureNagDay(input(), deps());
    const first = await saved();
    const withNew = [TASKS[0], TASKS[1], { id: "t9", text: "Renew the passport", done: false }];
    await ensureNagDay(input({ now: at(10), tasks: withNew }), deps());
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].tasks.map((task) => task.text)).toEqual(["Call the dentist", "Write the report", "Renew the passport"]);
    const second = await saved();
    expect(second.aiCalls).toBe(2);
    // The times didn't move.
    expect(second.slots.map(({ id, fireAtMs }) => ({ id, fireAtMs }))).toEqual(first.slots.map(({ id, fireAtMs }) => ({ id, fireAtMs })));

    // A third change today: planned again with built-in lines, the AI isn't asked.
    const coach = { ...NAG_ON, nagPersona: "coach" as const };
    await ensureNagDay(input({ now: at(11), tasks: withNew, settings: coach }), deps());
    await ensureNagDay(input({ now: at(12), tasks: [...withNew.slice(0, 2), { id: "t8", text: "Book the flights", done: false }], settings: coach }), deps());
    await ensureNagDay(input({ now: at(13), tasks: withNew, settings: { ...coach, nagLevel: "relentless" } }), deps());
    expect(request).toHaveBeenCalledTimes(2);
    const last = await saved();
    expect(last).toMatchObject({ persona: "coach", level: "relentless", source: "local", aiCalls: 2 });
    expect(last.slots.filter((slot) => slot.fireAtMs > at(13).getTime()).some((slot) => slot.text.startsWith("AI line"))).toBe(false);
  });

  it("a new day makes a new record and may ask again", async () => {
    await ensureNagDay(input(), deps());
    const monday = await saved();
    await ensureNagDay(input({ now: at(8, 0, 13), today: "2026-10-13" }), deps());
    expect(request).toHaveBeenCalledTimes(2);
    const tuesday = await saved();
    expect(tuesday).toMatchObject({ dayKey: "2026-10-13", aiCalls: 1, salt: monday.salt, source: "ai" });
    expect(tuesday.slots).toHaveLength(7);
    expect(tuesday.slots.every((slot) => slot.id.startsWith("daily-tasks:2026-10-13:nag:"))).toBe(true);
    expect(tuesday.version).toBeGreaterThan(monday.version);
  });

  it.each([
    ["offline", new MomentumAiError("network", "offline")],
    ["a timeout", new MomentumAiError("timeout", "timed out")],
    ["not Plus on the server", new MomentumAiError("needs_plus", "402", 402)],
    ["an unusable answer", new MomentumAiError("invalid_response", "empty")],
    ["anything else", new TypeError("boom")],
  ])("%s: the built-in lines stay, nothing is thrown, and it isn't asked again", async (_name, failure) => {
    request.mockRejectedValue(failure);
    await expect(ensureNagDay(input(), deps())).resolves.toBeUndefined();
    const record = await saved();
    expect(record).toMatchObject({ source: "local", aiCalls: 1 });
    expect(record.slots).toHaveLength(7);
    expect(record.slots.every((slot) => slot.text.length > 0 && !slot.text.startsWith("AI line"))).toBe(true);
    expect(versions).toEqual([1]);
    await ensureNagDay(input({ now: at(9) }), deps());
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("with task names hidden nothing is sent: general built-in lines only", async () => {
    await ensureNagDay(input({ settings: { ...NAG_ON, hideTaskNames: true } }), deps());
    expect(request).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
    const record = await saved();
    expect(record).toMatchObject({ source: "local", aiCalls: 0, hideNames: true });
    expect(record.slots.length).toBeGreaterThanOrEqual(3);
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).not.toMatch(TASK_WORDS);
  });

  it("the AI is only asked once Plus is confirmed; until then the built-in lines", async () => {
    await ensureNagDay(input({ aiAllowed: false }), deps());
    expect(request).not.toHaveBeenCalled();
    expect(await saved()).toMatchObject({ source: "local", aiCalls: 0 });
    await ensureNagDay(input({ now: at(8, 1) }), deps());
    expect(request).toHaveBeenCalledTimes(1);
    expect(await saved()).toMatchObject({ source: "ai", aiCalls: 1 });
  });

  it.each([
    ["calm", { settings: { ...NAG_ON, style: "calm" as const } }],
    ["no Plus", { plus: false }],
    ["no permission", { permissionState: "denied" as const }],
    ["reminders off", { settings: { ...NAG_ON, enabled: false } }],
    ["paused today", { settings: { ...NAG_ON, nagPausedDate: DAY } }],
    ["nothing open", { tasks: TASKS.map((task) => ({ ...task, done: true })) }],
    ["nothing set", { tasks: [] }],
    ["the store still on yesterday", { today: "2026-10-11" }],
  ])("%s: nothing is planned, saved or sent", async (_name, overrides) => {
    await ensureNagDay(input(overrides), deps());
    expect(request).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).toBeNull();
    expect(versions).toEqual([]);
  });

  it("never throws when storage fails, and sends nothing it couldn't record", async () => {
    // Once each (the storage mock's own functions: restoring a spy would empty them).
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    await expect(ensureNagDay(input(), deps())).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect(versions).toEqual([]);
  });

  it("two looks at once still make one request", async () => {
    await Promise.all([ensureNagDay(input(), deps()), ensureNagDay(input(), deps()), ensureNagDay(input(), deps())]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("a damaged saved record is planned afresh", async () => {
    await AsyncStorage.setItem(NAG_STORAGE_KEY, "{not json");
    await ensureNagDay(input(), deps());
    expect(await saved()).toMatchObject({ dayKey: DAY, source: "ai" });
  });

  it("analytics: where the lines came from and how many, never a line or a task", async () => {
    await ensureNagDay(input(), deps());
    request.mockRejectedValueOnce(new MomentumAiError("network", "offline"));
    await ensureNagDay(input({ now: at(10), settings: { ...NAG_ON, nagPersona: "drill" } }), deps());
    const sent = await events();
    expect(sent.map((item) => [item.event, item.properties.source, item.properties.count])).toEqual([
      ["nag_lines_loaded", "ai", 7],
      ["nag_lines_loaded", "local", 7],
    ]);
    expect(JSON.stringify(analyticsFetch.mock.calls)).not.toMatch(/dentist|report|Walk|AI line|recruit|sweetheart/i);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});

describe("the strategies", () => {
  it("nagStrategy returns the saved slots unchanged, sync after sync, with no network", async () => {
    await ensureNagDay(input(), deps());
    const record = await saved();
    const first = await nagStrategy(context());
    expect(first.map(({ id, title, body }) => ({ id, title, body }))).toEqual(record.slots.map((slot) => ({ id: slot.id, title: "Mom", body: slot.text })));
    expect(first.map((item) => item.fireAt.getTime())).toEqual(record.slots.map((slot) => slot.fireAtMs));
    expect(await nagStrategy(context())).toEqual(first);
    expect(request).toHaveBeenCalledTimes(1);
    expect(networkFetch).not.toHaveBeenCalled();
    for (const item of first) expect(item.interruptionLevel === undefined || item.interruptionLevel === "active").toBe(true);
  });

  it("never rejects when storage throws: an empty plan, and the calm reminders from the store's strategy", async () => {
    await ensureNagDay(input(), deps());
    const getItem = AsyncStorage.getItem as jest.Mock;
    const thrown = () => {
      throw new Error("sync throw");
    };
    getItem.mockRejectedValueOnce(new Error("disk"));
    await expect(nagStrategy(context())).resolves.toEqual([]);
    getItem.mockRejectedValueOnce(new Error("disk"));
    await expect(nagModeStrategy(context())).resolves.toEqual(taskAwareStrategy(context()));
    getItem.mockImplementationOnce(thrown);
    await expect(nagStrategy(context())).resolves.toEqual([]);
    getItem.mockImplementationOnce(thrown);
    await expect(nagModeStrategy(context())).resolves.toEqual(taskAwareStrategy(context()));
    // Storage back: the nags are back.
    expect(await nagStrategy(context())).toHaveLength(7);
  });

  it("nag mode: the mornings stay and the calm daytime and evening nudges are replaced by the nags", async () => {
    await ensureNagDay(input(), deps());
    const calm = taskAwareStrategy(context());
    const plan = await nagModeStrategy(context());
    const kinds = (kind: string) => plan.filter((item) => item.kind === kind);
    expect(kinds("nag")).toHaveLength(7);
    expect(kinds("progress")).toEqual([]);
    expect(kinds("evening")).toEqual([]);
    expect(kinds("morning")).toEqual(calm.filter((item) => item.kind === "morning"));
    expect(kinds("morning")).toHaveLength(6);
    expect(calm.filter((item) => item.kind !== "morning").length).toBeGreaterThan(0);
    expect(new Set(plan.map((item) => item.id)).size).toBe(plan.length);
  });

  it("calm, no Plus or no permission: exactly the calm reminders, whatever is saved", async () => {
    await ensureNagDay(input(), deps());
    for (const overrides of [{ settings: { ...NAG_ON, style: "calm" as const } }, { plus: false }, { plus: undefined }]) {
      expect(await nagModeStrategy(context(overrides))).toEqual(taskAwareStrategy(context(overrides)));
      expect(await nagStrategy(context(overrides))).toEqual([]);
    }
    expect(await nagModeStrategy(context({ permissionState: "denied" }))).toEqual([]);
  });

  it("paused today: quiet except the mornings, with no fallback to the calm nudges", async () => {
    await ensureNagDay(input(), deps());
    const paused = context({ settings: { ...NAG_ON, nagPausedDate: DAY } });
    const plan = await nagModeStrategy(paused);
    expect(plan.length).toBe(6);
    expect(plan.every((item) => item.kind === "morning")).toBe(true);
    expect(await nagStrategy(paused)).toEqual([]);
  });

  it("no record for today yet: the calm reminders for now", async () => {
    expect(await nagModeStrategy(context())).toEqual(taskAwareStrategy(context()));
    await ensureNagDay(input(), deps());
    // Tomorrow, before the day has been planned: yesterday's record isn't used.
    const tomorrow = context({ now: at(8, 0, 13), today: "2026-10-13" });
    expect(await nagModeStrategy(tomorrow)).toEqual(taskAwareStrategy(tomorrow));
    expect(await nagStrategy(tomorrow)).toEqual([]);
  });

  it("all done: no nags and no calm nudges today; nothing set: the morning nudges for an empty day", async () => {
    await ensureNagDay(input(), deps());
    const done = context({ tasks: TASKS.map((task) => ({ ...task, done: true })) });
    expect((await nagModeStrategy(done)).filter((item) => item.id.startsWith(`daily-tasks:${DAY}:`))).toEqual([]);
    const empty = context({ tasks: [] });
    const plan = await nagModeStrategy(empty);
    expect(plan).toEqual(taskAwareStrategy(empty));
    expect(plan.every((item) => item.kind === "morning")).toBe(true);
    expect(plan.some((item) => item.id.startsWith(`daily-tasks:${DAY}:morning:`))).toBe(true);
  });

  it("names hidden after the lines were written: no task text in any nag, and nothing is sent", async () => {
    await ensureNagDay(input(), deps());
    const hidden = context({ settings: { ...NAG_ON, hideTaskNames: true } });
    const plan = await nagModeStrategy(hidden);
    expect(plan.filter((item) => item.kind === "nag").length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(plan)).not.toMatch(/dentist|report|Walk the dog|AI line/i);
    expect(request).toHaveBeenCalledTimes(1);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});
