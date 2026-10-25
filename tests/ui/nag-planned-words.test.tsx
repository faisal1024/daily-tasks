// 1.4.1: the words a plan puts into slots still to come are written back into
// the day's record (savePlannedWords in nag-day.ts), and Dad meeting a Worker
// from before 1.4.1. Dates are local time; the day's times come from a fixed
// salt, never a random one.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { MomentumAiError } from "@/lib/daily-tasks/ai-status";
import { requestNagLines, type NagLine } from "@/lib/daily-tasks/nag";
import { clearNagRecord, ensureNagDay, loadNagRecord, nagModeStrategy, nagStrategy, stubNagRecord, type NagDayInput } from "@/lib/daily-tasks/nag-day";
import { NAG_STORAGE_KEY, planNagDay, type NagDayRecord } from "@/lib/daily-tasks/nag-plan";
import type { ReminderContext } from "@/lib/daily-tasks/reminder-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "@/lib/daily-tasks/types";

const DAY = "2026-10-12";
const SALT = "salt-1";
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const TASKS = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
// Ticked: the report.
const TICKED = [TASKS[0], { ...TASKS[1], done: true }, TASKS[2]];
const OPEN = TASKS.map(({ id, text }) => ({ id, text }));

const context = (overrides: Partial<ReminderContext> = {}): ReminderContext => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  tasks: TICKED,
  locked: false,
  yesterdayOpen: [],
  draft: null,
  pending: [],
  lastDeliveredAt: null,
  plus: true,
  ...overrides,
});

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

/** The day planned at 8:00 with a fixed salt, as it is saved. */
const planned = (settings: NotificationConfig = NAG_ON): NagDayRecord => planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: OPEN, salt: SALT });
const store = (record: NagDayRecord) => AsyncStorage.setItem(NAG_STORAGE_KEY, JSON.stringify(record));
const saved = async (): Promise<NagDayRecord> => {
  const record = await loadNagRecord();
  if (!record) throw new Error("no nag record saved");
  return record;
};
/** Waits behind everything queued so far (the writes are not awaited by the strategies). */
const settle = () => ensureNagDay(input({ settings: { ...NAG_ON, style: "calm" } }));

let request: jest.MockedFunction<typeof requestNagLines>;
const aiLines = (count: number): NagLine[] => Array.from({ length: count }, (_unused, index) => ({ step: index + 1, taskIndex: index % 3, text: `AI line ${index + 1}` }));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  request = jest.fn(async ({ count }) => ({ lines: aiLines(count) })) as jest.MockedFunction<typeof requestNagLines>;
  // 8:00 on the day: an AI answer is written into the slots after it.
  jest.useFakeTimers({ now: at(8), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("words put in after a tick are written back to the record", () => {
  it("a tick: the plan's new words for slots still to come are saved, the nag that went off and the version are not touched", async () => {
    const record = planned();
    await store(record);
    // 10:30: the 9:57 nag went off; the report's later nag is still to come.
    const ctx = context({ now: at(10, 30) });
    const plan = await nagStrategy(ctx);
    await settle();
    const after = await saved();
    expect(after.version).toBe(record.version);
    expect(after.slots[0]).toEqual(record.slots[0]);
    expect(after.slots.slice(1).map((slot) => slot.text)).toEqual(plan.map((item) => item.body));
    expect(after.slots.some((slot, index) => slot.text !== record.slots[index].text)).toBe(true);
    expect(after.slots.filter((slot) => slot.fireAtMs > at(10, 30).getTime()).some((slot) => slot.taskId === "t1")).toBe(false);

    // Looking again: the same plan, and nothing more is written.
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();
    expect(await nagStrategy(ctx)).toEqual(plan);
    expect(await nagModeStrategy(ctx)).toEqual(expect.arrayContaining(plan));
    await settle();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("'Reset all data' right after the look: nothing is saved back", async () => {
    await store(planned());
    await nagStrategy(context());
    await clearNagRecord();
    await settle();
    expect(await AsyncStorage.getItem(NAG_STORAGE_KEY)).toBeNull();
  });

  it("back to Calm right after the look: the emptied record stays empty", async () => {
    await store(planned());
    await nagStrategy(context());
    await stubNagRecord(at(8, 1));
    await settle();
    const raw = (await AsyncStorage.getItem(NAG_STORAGE_KEY)) ?? "";
    expect(raw).not.toMatch(/dentist|report|dog/i);
    expect((await saved()).slots.every((slot) => slot.text === "" && slot.taskId === null)).toBe(true);
  });

  it("a newer plan saved while the write waited (the AI's lines, a new version) is left alone", async () => {
    await store(planned());
    // The AI's answer is slow: its run holds the queue while the look happens.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    request.mockImplementationOnce(async ({ count }) => {
      await gate;
      return { lines: aiLines(count) };
    });
    const run = ensureNagDay(input(), { request });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(1);
    await nagStrategy(context());
    release();
    await run;
    await settle();
    const after = await saved();
    expect(after).toMatchObject({ source: "ai", version: planned().version + 1 });
    // Every AI line is as it was written, the ticked task's included.
    expect(after.slots.map((slot) => slot.text)).toEqual(aiLines(after.slots.length).map((line) => line.text));
  });

  it("a day drawn again after it doesn't say the same line twice", async () => {
    const record = planned();
    await store(record);
    await nagStrategy(context());
    await settle();
    const written = await saved();
    // The nag at 9:57 went off with the line the plan put in; it is not the one first saved.
    const said = written.slots[0].text;
    expect(said).not.toBe(record.slots[0].text);
    expect(said).toMatch(/dentist/i);

    // 11:30, Relentless: the rest of the day is drawn again without the report.
    const settings = { ...NAG_ON, nagLevel: "relentless" as const, nagWindow: { startMinutes: 540, endMinutes: 1439 } };
    await ensureNagDay(input({ now: at(11, 30), settings, tasks: TICKED, aiAllowed: false }), { request });
    const redrawn = await saved();
    const future = redrawn.slots.filter((slot) => slot.fireAtMs > at(11, 30).getTime());
    expect(future.length).toBeGreaterThan(2);
    expect(future.map((slot) => slot.text)).not.toContain(said);
    expect(new Set(redrawn.slots.map((slot) => slot.text)).size).toBe(redrawn.slots.length);
  });
});

describe("Dad against a Worker from before 1.4.1", () => {
  it("a 400 for the persona leaves the built-in Dad lines in place, and the app carries on", async () => {
    const oldWorker = jest.fn(async () => new Response(JSON.stringify({ error: "Invalid persona" }), { status: 400 }));
    const settings: NotificationConfig = { ...NAG_ON, nagPersona: "dad" };
    const viaOldWorker = (args: Parameters<typeof requestNagLines>[0]) =>
      requestNagLines({ ...args, planUrl: "https://proxy.test/api/momentum/plan", fetchImpl: oldWorker as unknown as typeof fetch });
    await expect(viaOldWorker({ persona: "dad", level: "firm", tasks: OPEN, count: 5 })).rejects.toBeInstanceOf(MomentumAiError);
    oldWorker.mockClear();

    await ensureNagDay(input({ settings }), { request: viaOldWorker as typeof requestNagLines });
    // Asked once, refused.
    expect(oldWorker).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((oldWorker.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ persona: "dad" });
    const record = await saved();
    expect(record).toMatchObject({ persona: "dad", source: "local", aiCalls: 1 });
    const builtIn = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: OPEN, salt: record.salt });
    expect(record.slots.map((slot) => slot.text)).toEqual(builtIn.slots.map((slot) => slot.text));
    expect(record.slots.every((slot) => slot.text.length > 0)).toBe(true);
    // And the nags are scheduled, with Dad's title.
    const plan = await nagStrategy(context({ settings, tasks: TASKS }));
    expect(plan).toHaveLength(record.slots.length);
    expect(new Set(plan.map((item) => item.title))).toEqual(new Set(["Three Today · Dad"]));
  });
});
