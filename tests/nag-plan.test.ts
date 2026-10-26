// Nag mode (1.4): the pure half. When the day's nags go off (inside the
// window, never under an hour apart, the same for the same seed, unchanged
// when the day is planned again), which line each one says, and what the
// reminder strategy makes of the day's record. Storage normalisation for the
// new settings is here too.
import { describe, expect, it } from "vitest";

import { NAG_LEVELS, NAG_PERSONA_LABELS, NAG_PERSONAS, type NagLevel, type NagLine } from "../lib/daily-tasks/nag";
import {
  adjustNagWindow,
  applyAiNagLines,
  lineForStep,
  NAG_CATEGORY_ID,
  NAG_GENERAL_CATEGORY_ID,
  NAG_LEVEL_COUNTS,
  nagDayNeedsPlan,
  nagDayWantsAi,
  nagAiKey,
  nagMinuteAt,
  nagModeOn,
  nagPlanFromRecord,
  nagSlotId,
  nagTasksChanged,
  nagTasksKey,
  normalizeNagRecord,
  normalizeNagWindow,
  planNagDay,
  planNagTimes,
  type NagDayRecord,
  type NagPlanContext,
} from "../lib/daily-tasks/nag-plan";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { DEFAULT_NAG_WINDOW, DEFAULT_NOTIFICATIONS, type NagWindow, type NotificationConfig } from "../lib/daily-tasks/types";

const DAY = "2026-10-12";
const HOUR = 3_600_000;
const MIN = 60_000;
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);

/** mulberry32. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)) };
}

const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const TASKS = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
const OPEN = TASKS.map(({ id, text }) => ({ id, text }));
const TASK_WORDS = /dentist|report|Walk the dog/i;

const context = (overrides: Partial<NagPlanContext> = {}): NagPlanContext => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  tasks: TASKS,
  plus: true,
  ...overrides,
});

const plan = (overrides: Partial<Parameters<typeof planNagDay>[0]> = {}): NagDayRecord =>
  planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: NAG_ON, open: OPEN, salt: "salt-a", ...overrides });

describe("storage: the nag settings", () => {
  const restore = (notifications: unknown) => {
    const state = normalizeState(JSON.parse(JSON.stringify({ ...buildInitialState(new Date(2026, 9, 12)), notifications })));
    if (!state) throw new Error("normalizeState returned null");
    return state.notifications;
  };

  it("a save from before 1.4 loads calm, Mom, Firm, 9:00 to 21:00, not paused", () => {
    const loaded = restore({ enabled: true, morning: true, progress: false, evening: true, hourly: false });
    expect(loaded).toMatchObject({
      progress: false,
      style: "calm",
      nagConfirmed: false,
      nagPersona: "mom",
      nagLevel: "firm",
      nagWindow: { startMinutes: 540, endMinutes: 1260 },
      nagPausedDate: null,
    });
    expect(DEFAULT_NOTIFICATIONS).toMatchObject({ style: "calm", nagPersona: "mom", nagLevel: "firm", nagPausedDate: null });
  });

  it("the oldest save shape (slots) gets the defaults too", () => {
    expect(restore({ morning: { enabled: true }, evening: { enabled: false } })).toMatchObject({ style: "calm", nagPersona: "mom", nagLevel: "firm" });
  });

  it("a saved choice round-trips, and a saved nag counts as confirmed", () => {
    const saved = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagPersona: "drill", nagLevel: "relentless", nagWindow: { startMinutes: 600, endMinutes: 1200 }, nagPausedDate: DAY };
    expect(restore(saved)).toMatchObject({ ...saved, nagConfirmed: true });
  });

  it("damaged values load as the defaults", () => {
    const loaded = restore({ ...DEFAULT_NOTIFICATIONS, style: "loud", nagPersona: "boss", nagLevel: 7, nagWindow: "all day", nagPausedDate: "yesterday", nagConfirmed: "yes" });
    expect(loaded).toMatchObject({ style: "calm", nagPersona: "mom", nagLevel: "firm", nagWindow: DEFAULT_NAG_WINDOW, nagPausedDate: null, nagConfirmed: false });
  });

  it("a window is kept inside the day and at least three hours long", () => {
    expect(normalizeNagWindow({ startMinutes: 600, endMinutes: 630 })).toEqual({ startMinutes: 600, endMinutes: 780 });
    expect(normalizeNagWindow({ startMinutes: 1400, endMinutes: 1439 })).toEqual({ startMinutes: 1259, endMinutes: 1439 });
    expect(normalizeNagWindow({ startMinutes: -5, endMinutes: 99999 })).toEqual({ startMinutes: 0, endMinutes: 1439 });
    expect(normalizeNagWindow({ startMinutes: Number.NaN, endMinutes: null })).toEqual(DEFAULT_NAG_WINDOW);
    expect(normalizeNagWindow(null)).toEqual(DEFAULT_NAG_WINDOW);
  });

  it("setting one end moves the other only when it has to", () => {
    expect(adjustNagWindow(DEFAULT_NAG_WINDOW, "start", 600)).toEqual({ startMinutes: 600, endMinutes: 1260 });
    expect(adjustNagWindow(DEFAULT_NAG_WINDOW, "start", 1200)).toEqual({ startMinutes: 1200, endMinutes: 1380 });
    expect(adjustNagWindow(DEFAULT_NAG_WINDOW, "end", 600)).toEqual({ startMinutes: 420, endMinutes: 600 });
    expect(adjustNagWindow(DEFAULT_NAG_WINDOW, "end", 60)).toEqual({ startMinutes: 0, endMinutes: 180 });
  });
});

describe("times", () => {
  it("a full day has the level's count: Gentle 4, Firm 7, Relentless 11", () => {
    expect(NAG_LEVEL_COUNTS).toEqual({ gentle: 4, firm: 7, relentless: 11 });
    for (const level of NAG_LEVELS) {
      const times = planNagTimes({ dayKey: DAY, salt: "s", window: DEFAULT_NAG_WINDOW, now: at(7), count: NAG_LEVEL_COUNTS[level] });
      expect(times).toHaveLength(NAG_LEVEL_COUNTS[level]);
    }
  });

  it("never more than the whole hours left in the window", () => {
    const times = (now: Date, count = 11) => planNagTimes({ dayKey: DAY, salt: "s", window: DEFAULT_NAG_WINDOW, now, count });
    // 16:40 is the earliest (20 minutes on); 4 whole hours to 21:00.
    expect(times(at(16, 20))).toHaveLength(4);
    expect(times(at(19, 30))).toHaveLength(1);
    // Under an hour left, or the window is over: none.
    expect(times(at(19, 50))).toEqual([]);
    expect(times(at(22))).toEqual([]);
    expect(times(at(7), 0)).toEqual([]);
  });

  it("the first is at least 20 minutes on, and not before the window or `notBefore`", () => {
    const first = (now: Date, notBefore?: number) =>
      planNagTimes({ dayKey: DAY, salt: "s", window: DEFAULT_NAG_WINDOW, now, count: 4, notBefore })[0];
    expect(first(at(6))).toBeGreaterThanOrEqual(at(9).getTime());
    expect(first(at(13, 7))).toBeGreaterThanOrEqual(at(13, 27).getTime());
    expect(first(at(13, 7), at(15).getTime())).toBeGreaterThanOrEqual(at(15).getTime());
  });

  it("property: inside the window, 60 minutes or more apart, on whole minutes, unique ids, the same for the same seed", () => {
    const rng = seeded(20261012);
    let gentleSpread = 0;
    for (let run = 0; run < 1500; run += 1) {
      const level: NagLevel = NAG_LEVELS[rng.int(0, 2)];
      const startMinutes = rng.int(0, 1259);
      const window: NagWindow = { startMinutes, endMinutes: rng.int(startMinutes + 180, 1439) };
      const now = new Date(2026, 9, 12, 0, rng.int(0, 1439), rng.int(0, 59));
      const input = { dayKey: DAY, salt: `salt-${rng.int(0, 99999)}`, window, now, count: NAG_LEVEL_COUNTS[level], draw: rng.int(0, 3) };
      const times = planNagTimes(input);
      const startMs = nagMinuteAt(DAY, window.startMinutes).getTime();
      const endMs = nagMinuteAt(DAY, window.endMinutes).getTime();
      const base = Math.max(startMs, Math.ceil((now.getTime() + 20 * MIN) / MIN) * MIN);
      const hoursLeft = Math.max(0, Math.floor((endMs - base) / HOUR));
      expect(times).toHaveLength(Math.min(NAG_LEVEL_COUNTS[level], hoursLeft));
      times.forEach((time, index) => {
        expect(time).toBeGreaterThanOrEqual(base);
        expect(time).toBeLessThanOrEqual(endMs);
        expect(time % MIN).toBe(0);
        if (index > 0) expect(time - times[index - 1]).toBeGreaterThanOrEqual(HOUR);
      });
      expect(new Set(times.map((time) => nagSlotId(new Date(time)))).size).toBe(times.length);
      expect(planNagTimes({ ...input })).toEqual(times);
      if (level === "gentle" && times.length === 4 && endMs - base >= 10 * HOUR) gentleSpread += times[3] - times[0] >= 4 * HOUR ? 1 : -1;
    }
    // The few nags of a Gentle day are spread over it, not bunched after the start.
    expect(gentleSpread).toBeGreaterThan(0);
  });

  it("another salt, day or draw gives other times", () => {
    const base = { dayKey: DAY, salt: "a", window: DEFAULT_NAG_WINDOW, now: at(7), count: 7 };
    const one = planNagTimes(base);
    expect(planNagTimes({ ...base, salt: "b" })).not.toEqual(one);
    expect(planNagTimes({ ...base, draw: 1 })).not.toEqual(one);
    const other = planNagTimes({ ...base, dayKey: "2026-10-13", now: new Date(2026, 9, 13, 7) });
    expect(other.map((time) => time - 24 * HOUR)).not.toEqual(one);
  });

  it("ids are daily-tasks:<day>:nag:<HHmm>", () => {
    expect(nagSlotId(at(9, 5))).toBe("daily-tasks:2026-10-12:nag:0905");
    expect(nagSlotId(at(20, 59))).toBe("daily-tasks:2026-10-12:nag:2059");
  });
});

describe("which line a nag says", () => {
  const lines = (count: number) => Array.from({ length: count }, (_unused, index) => `L${index + 1}`);

  it("as many lines as nags: one each, in order", () => {
    expect([1, 2, 3, 4].map((step) => lineForStep(lines(4), step, 4))).toEqual(["L1", "L2", "L3", "L4"]);
  });

  it("more lines than nags (a day planned late): the first nag opens, the last ends on the pushiest, the rest spread between", () => {
    expect(lineForStep(lines(4), 1, 1)).toBe("L1");
    expect([1, 2].map((step) => lineForStep(lines(4), step, 2))).toEqual(["L1", "L4"]);
    expect([1, 2, 3].map((step) => lineForStep(lines(4), step, 3))).toEqual(["L1", "L3", "L4"]);
    expect([1, 2, 3, 4, 5].map((step) => lineForStep(lines(7), step, 5))).toEqual(["L1", "L3", "L4", "L6", "L7"]);
    // Never the same line for two nags.
    for (let count = 1; count <= 16; count += 1) {
      for (let total = 1; total <= count; total += 1) {
        const picked = Array.from({ length: total }, (_unused, index) => lineForStep(lines(count), index + 1, total));
        expect(new Set(picked).size, `${count} lines, ${total} nags`).toBe(total);
        expect(picked[0]).toBe("L1");
        if (total > 1) expect(picked[total - 1]).toBe(`L${count}`);
      }
    }
  });

  it("fewer lines than nags: spread over the day, each used once, the rest get none", () => {
    const picked = Array.from({ length: 11 }, (_unused, index) => lineForStep(lines(7), index + 1, 11));
    expect(picked.filter(Boolean)).toEqual(lines(7));
    expect(picked[0]).toBe("L1");
    expect(lineForStep(lines(0), 1, 4)).toBeNull();
    expect(lineForStep(lines(4), 5, 4)).toBeNull();
  });

  it("the tasks key is hashes, not words; only a task the key doesn't know is a change", () => {
    const key = nagTasksKey(OPEN);
    expect(key).not.toMatch(TASK_WORDS);
    expect(nagTasksChanged(key, OPEN)).toBe(false);
    expect(nagTasksChanged(key, OPEN.slice(1))).toBe(false);
    expect(nagTasksChanged(key, [{ id: "t0", text: "  call   THE dentist " }])).toBe(false);
    expect(nagTasksChanged(key, [...OPEN.slice(0, 2), { id: "t9", text: "Renew the passport" }])).toBe(true);
    expect(nagTasksChanged("", OPEN)).toBe(true);
  });
});

describe("the day's record", () => {
  it("a full day: one slot per nag, steps 1..n, built-in lines that rise, ids from the times", () => {
    for (const level of NAG_LEVELS) {
      const record = plan({ settings: { ...NAG_ON, nagLevel: level } });
      expect(record).toMatchObject({ dayKey: DAY, persona: "mom", level, salt: "salt-a", source: "local", total: NAG_LEVEL_COUNTS[level], aiCalls: 0, aiFor: null, version: 1 });
      expect(record.slots).toHaveLength(NAG_LEVEL_COUNTS[level]);
      record.slots.forEach((slot, index) => {
        expect(slot.step).toBe(index + 1);
        expect(slot.id).toBe(nagSlotId(new Date(slot.fireAtMs)));
        expect(slot.text.length).toBeGreaterThan(0);
        expect(slot.text).toBe(record.lines[index].text);
      });
    }
  });

  it("planned again mid-day (a task reworded, another persona): passed slots stay, future slots keep id, time and step", () => {
    const rng = seeded(7);
    for (let run = 0; run < 200; run += 1) {
      const level = NAG_LEVELS[rng.int(0, 2)];
      const settings = { ...NAG_ON, nagLevel: level };
      const first = plan({ settings, salt: `s${run}`, now: at(rng.int(5, 9), rng.int(0, 59)) });
      const later = new Date(2026, 9, 12, rng.int(10, 20), rng.int(0, 59));
      const open = [...OPEN.slice(0, 2), { id: "t9", text: "Renew the passport" }];
      const again = planNagDay({ previous: first, now: later, dayKey: DAY, settings: { ...settings, nagPersona: NAG_PERSONAS[rng.int(0, NAG_PERSONAS.length - 1)] }, open, salt: "unused" });
      const shape = (record: NagDayRecord) => record.slots.map(({ id, fireAtMs, step }) => ({ id, fireAtMs, step }));
      expect(shape(again)).toEqual(shape(first));
      expect(again.salt).toBe(first.salt);
      expect(again.total).toBe(first.total);
      expect(again.version).toBe(first.version + 1);
      // History is untouched, word for word.
      const passed = (record: NagDayRecord) => record.slots.filter((slot) => slot.fireAtMs <= later.getTime());
      expect(passed(again)).toEqual(passed(first));
      for (let index = 1; index < again.slots.length; index += 1) {
        expect(again.slots[index].fireAtMs - again.slots[index - 1].fireAtMs).toBeGreaterThanOrEqual(HOUR);
      }
    }
  });

  it("another level or window mid-day draws the rest again, an hour or more after the last one that went off", () => {
    const rng = seeded(99);
    for (let run = 0; run < 200; run += 1) {
      const first = plan({ salt: `s${run}`, now: at(7) });
      const later = new Date(2026, 9, 12, rng.int(10, 19), rng.int(0, 59));
      const relentless = run % 2 === 0;
      const settings = relentless
        ? { ...NAG_ON, nagLevel: "relentless" as const }
        : { ...NAG_ON, nagWindow: { startMinutes: 480, endMinutes: 1380 } };
      const again = planNagDay({ previous: first, now: later, dayKey: DAY, settings, open: OPEN, salt: "unused" });
      const passed = first.slots.filter((slot) => slot.fireAtMs <= later.getTime());
      expect(again.slots.slice(0, passed.length)).toEqual(passed);
      const future = again.slots.slice(passed.length);
      expect(again.slots.length).toBeLessThanOrEqual(NAG_LEVEL_COUNTS[again.level]);
      expect(again.draws).toBe(first.draws + 1);
      future.forEach((slot) => {
        expect(slot.fireAtMs).toBeGreaterThanOrEqual(later.getTime() + 20 * MIN);
        expect(slot.fireAtMs).toBeLessThanOrEqual(nagMinuteAt(DAY, settings.nagWindow.endMinutes).getTime());
      });
      for (let index = 1; index < again.slots.length; index += 1) {
        expect(again.slots[index].fireAtMs - again.slots[index - 1].fireAtMs).toBeGreaterThanOrEqual(HOUR);
      }
      expect(again.slots.map((slot) => slot.step)).toEqual(again.slots.map((_slot, index) => index + 1));
    }
  });

  it("a new day is a new record: fresh counts, the same salt, an hour or more after yesterday's last", () => {
    const window = { startMinutes: 0, endMinutes: 1439 };
    const settings = { ...NAG_ON, nagWindow: window, nagLevel: "relentless" as const };
    const yesterday = { ...plan({ settings, now: at(0, 5) }), aiCalls: 2, aiFor: "mom|relentless|x", aiFetchedAt: 1, source: "ai" as const };
    const last = yesterday.slots[yesterday.slots.length - 1].fireAtMs;
    const tomorrow = planNagDay({ previous: yesterday, now: new Date(last + MIN), dayKey: "2026-10-13", settings, open: OPEN, salt: "other" });
    expect(tomorrow).toMatchObject({ dayKey: "2026-10-13", salt: "salt-a", aiCalls: 0, aiFor: null, aiFetchedAt: null, source: "local", draws: 0 });
    expect(tomorrow.slots.every((slot) => slot.id.startsWith("daily-tasks:2026-10-13:nag:"))).toBe(true);
    expect(tomorrow.slots[0].fireAtMs - last).toBeGreaterThanOrEqual(HOUR);
    expect(nagDayNeedsPlan(yesterday, { dayKey: "2026-10-13", settings, open: OPEN })).toBe(true);
  });

  it("what makes the day need planning again", () => {
    const record = plan();
    const same = { dayKey: DAY, settings: NAG_ON, open: OPEN };
    expect(nagDayNeedsPlan(null, same)).toBe(true);
    expect(nagDayNeedsPlan(record, same)).toBe(false);
    // A task ticked off isn't a reason: its nags are pointed elsewhere.
    expect(nagDayNeedsPlan(record, { ...same, open: OPEN.slice(1) })).toBe(false);
    expect(nagDayNeedsPlan(record, { ...same, open: [...OPEN.slice(1), { id: "n", text: "Something new" }] })).toBe(true);
    expect(nagDayNeedsPlan(record, { ...same, settings: { ...NAG_ON, nagPersona: "coach" } })).toBe(true);
    expect(nagDayNeedsPlan(record, { ...same, settings: { ...NAG_ON, nagLevel: "gentle" } })).toBe(true);
    expect(nagDayNeedsPlan(record, { ...same, settings: { ...NAG_ON, nagWindow: { startMinutes: 600, endMinutes: 1260 } } })).toBe(true);
    expect(nagDayNeedsPlan(record, { ...same, settings: { ...NAG_ON, hideTaskNames: true } })).toBe(true);
  });

  it("with task names hidden the record has general lines only", () => {
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        const record = plan({ settings: { ...NAG_ON, nagPersona: persona, nagLevel: level, hideTaskNames: true } });
        expect(record.hideNames).toBe(true);
        expect(record.slots.length).toBeGreaterThanOrEqual(3);
        expect(JSON.stringify([record.slots, record.lines, record.lineTasks])).not.toMatch(TASK_WORDS);
        expect(record.slots.every((slot) => slot.taskId === null)).toBe(true);
        expect(new Set(record.slots.map((slot) => slot.text)).size).toBe(record.slots.length);
      }
    }
  });

  const AI: NagLine[] = Array.from({ length: 7 }, (_unused, index) => ({ step: index + 1, taskIndex: index % 3, text: `AI line ${index + 1}` }));

  it("the AI's lines go into the slots still to come, by step; passed ones keep their words", () => {
    const record = plan();
    const now = new Date(record.slots[2].fireAtMs + MIN);
    const next = applyAiNagLines(record, AI, OPEN, now);
    expect(next.source).toBe("ai");
    expect(next.version).toBe(record.version + 1);
    expect(next.slots.slice(0, 3)).toEqual(record.slots.slice(0, 3));
    expect(next.slots.slice(3).map((slot) => slot.text)).toEqual(["AI line 4", "AI line 5", "AI line 6", "AI line 7"]);
    expect(next.slots.slice(3).map((slot) => slot.taskId)).toEqual(["t0", "t1", "t2", "t0"]);
    expect(next.slots.map(({ id, fireAtMs }) => ({ id, fireAtMs }))).toEqual(record.slots.map(({ id, fireAtMs }) => ({ id, fireAtMs })));
  });

  it("fewer AI lines than nags: the nags left over keep their built-in line", () => {
    const record = plan();
    const next = applyAiNagLines(record, AI.slice(0, 3), OPEN, at(8));
    const fromAi = next.slots.filter((slot) => slot.text.startsWith("AI line"));
    expect(fromAi.map((slot) => slot.text)).toEqual(["AI line 1", "AI line 2", "AI line 3"]);
    next.slots.forEach((slot, index) => {
      if (!slot.text.startsWith("AI line")) expect(slot.text).toBe(record.slots[index].text);
    });
  });

  it("when the AI is asked: once for the day, again only for another persona, level or a task it doesn't know, twice at most", () => {
    const record = plan();
    expect(nagDayWantsAi(record, OPEN, at(8))).toBe(true);
    const asked = { ...applyAiNagLines(record, AI, OPEN, at(8)), aiCalls: 1, aiFor: nagAiKey("mom", "firm", OPEN) };
    expect(nagDayWantsAi(asked, OPEN, at(8))).toBe(false);
    expect(nagDayWantsAi(asked, OPEN.slice(1), at(12))).toBe(false);
    const changed = [...OPEN.slice(1), { id: "n", text: "Something new" }];
    expect(nagDayWantsAi(asked, changed, at(12))).toBe(true);
    expect(nagDayWantsAi({ ...asked, persona: "coach" }, OPEN, at(12))).toBe(true);
    expect(nagDayWantsAi({ ...asked, level: "gentle" }, OPEN, at(12))).toBe(true);
    expect(nagDayWantsAi({ ...asked, aiCalls: 2 }, changed, at(12))).toBe(false);
    // Never with names hidden, with nothing open, or with no nag left to write.
    expect(nagDayWantsAi({ ...record, hideNames: true }, OPEN, at(8))).toBe(false);
    expect(nagDayWantsAi(record, [], at(8))).toBe(false);
    expect(nagDayWantsAi(record, OPEN, at(22))).toBe(false);
  });

  it("planned again with the same persona, level and tasks, the AI's lines are put back; otherwise built-in ones", () => {
    const asked = { ...applyAiNagLines(plan(), AI, OPEN, at(8)), aiCalls: 1, aiFor: nagAiKey("mom", "firm", OPEN) };
    const hidden = planNagDay({ previous: asked, now: at(10), dayKey: DAY, settings: { ...NAG_ON, hideTaskNames: true }, open: OPEN, salt: "x" });
    expect(hidden.source).toBe("local");
    expect(JSON.stringify(hidden.slots.filter((slot) => slot.fireAtMs > at(10).getTime()))).not.toMatch(/AI line|dentist|report|Walk/);
    const coach = planNagDay({ previous: asked, now: at(10), dayKey: DAY, settings: { ...NAG_ON, nagPersona: "coach" }, open: OPEN, salt: "x" });
    expect(coach.source).toBe("local");
    expect(coach.slots.filter((slot) => slot.fireAtMs > at(10).getTime()).some((slot) => slot.text.startsWith("AI line"))).toBe(false);
    // A window moved by a minute keeps persona, level and tasks: the AI's lines are used again.
    const moved = planNagDay({ previous: asked, now: at(10), dayKey: DAY, settings: { ...NAG_ON, nagWindow: { startMinutes: 541, endMinutes: 1260 } }, open: OPEN, salt: "x" });
    expect(moved.source).toBe("ai");
    expect(moved.aiCalls).toBe(1);
    expect(moved.slots.filter((slot) => slot.fireAtMs > at(10).getTime()).every((slot) => slot.text.startsWith("AI line"))).toBe(true);
  });

  it("a saved record is checked on the way in", () => {
    const record = plan();
    expect(normalizeNagRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(normalizeNagRecord(null)).toBeNull();
    expect(normalizeNagRecord("x")).toBeNull();
    expect(normalizeNagRecord({ ...record, dayKey: "today" })).toBeNull();
    expect(normalizeNagRecord({ ...record, persona: "boss" })).toBeNull();
    expect(normalizeNagRecord({ ...record, salt: "" })).toBeNull();
    const damaged = normalizeNagRecord({ ...record, slots: [{ id: "other:1", fireAtMs: 1, step: 1, text: "x" }, null, record.slots[0]], lines: "none", aiCalls: -3 });
    expect(damaged?.slots).toEqual([record.slots[0]]);
    expect(damaged?.lines).toEqual([]);
    expect(damaged?.aiCalls).toBe(0);
  });
});

describe("the plan from the record", () => {
  const record = plan();

  it("the future slots come back as they are: same id, time and words, titled with the persona", () => {
    const items = nagPlanFromRecord(record, context());
    expect(items).toHaveLength(7);
    items.forEach((item, index) => {
      const slot = record.slots[index];
      // 1.6 G: Mark done only on a nag about a task.
      const categoryId = slot.taskId ? NAG_CATEGORY_ID : NAG_GENERAL_CATEGORY_ID;
      expect(item).toMatchObject({ id: slot.id, title: "Three Today · Mom", body: slot.text, kind: "nag", categoryId });
      expect(item.fireAt.getTime()).toBe(slot.fireAtMs);
      expect(item.data).toEqual({ ...(slot.taskId ? { taskId: slot.taskId } : {}), step: slot.step });
    });
    // Again later, from equal inputs: the same plan, minus what has gone off.
    const later = new Date(record.slots[1].fireAtMs + MIN);
    expect(nagPlanFromRecord(record, context({ now: later }))).toEqual(items.slice(2));
  });

  it.each(NAG_PERSONAS)("the title is the app's name, then the persona's label (%s)", (persona) => {
    const settings = { ...NAG_ON, nagPersona: persona };
    const items = nagPlanFromRecord(plan({ settings }), context({ settings }));
    expect(new Set(items.map((item) => item.title))).toEqual(new Set([`Three Today · ${NAG_PERSONA_LABELS[persona]}`]));
  });

  it("never time-sensitive: a nag does not break through a Focus", () => {
    for (const level of NAG_LEVELS) {
      const settings = { ...NAG_ON, nagLevel: level };
      const items = nagPlanFromRecord(plan({ settings }), context({ settings }));
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect([undefined, "active"]).toContain(item.interruptionLevel);
        expect(item.sound).toBeUndefined();
      }
    }
  });

  it("a slot whose task is done or gone is pointed at the next open task, with its time and id kept", () => {
    const named = record.slots.filter((slot) => slot.taskId === "t0");
    expect(named.length).toBeGreaterThan(0);
    const tasks = [{ ...TASKS[0], done: true }, TASKS[1], TASKS[2]];
    const items = nagPlanFromRecord(record, context({ tasks }));
    expect(items.map((item) => item.id)).toEqual(record.slots.map((slot) => slot.id));
    items.forEach((item, index) => {
      const slot = record.slots[index];
      expect(item.fireAt.getTime()).toBe(slot.fireAtMs);
      expect(item.body).not.toMatch(/dentist/i);
      if (slot.taskId === "t0") {
        expect(item.body).not.toBe(slot.text);
        expect([undefined, "t1"]).toContain(item.data?.taskId);
        if (item.data?.taskId) expect(item.body).toMatch(/report/);
      } else {
        expect(item.body).toBe(slot.text);
      }
    });
    // Deterministic: the scheduler sees the same words on the next sync.
    expect(nagPlanFromRecord(record, context({ tasks }))).toEqual(items);
    // Gone altogether is the same as done.
    expect(nagPlanFromRecord(record, context({ tasks: TASKS.slice(1) }))).toEqual(items);
  });

  it("nothing when everything is done, or nothing is set", () => {
    expect(nagPlanFromRecord(record, context({ tasks: TASKS.map((task) => ({ ...task, done: true })) }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ tasks: [] }))).toEqual([]);
  });

  it("nothing when paused today; back the day after", () => {
    expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, nagPausedDate: DAY } }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, nagPausedDate: "2026-10-11" } }))).toHaveLength(7);
  });

  it("nothing for calm, without Plus, without permission, or with reminders off", () => {
    expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, style: "calm" } }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ plus: false }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ plus: undefined }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ permissionState: "denied" }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ permissionState: "undetermined" }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, enabled: false } }))).toEqual([]);
    expect(nagModeOn(NAG_ON, true, "granted")).toBe(true);
    expect(nagModeOn(NAG_ON, false, "granted")).toBe(false);
  });

  it("nothing from another day's record, or while the store's day isn't the clock's", () => {
    expect(nagPlanFromRecord(null, context())).toEqual([]);
    expect(nagPlanFromRecord(record, context({ today: "2026-10-13", now: new Date(2026, 9, 13, 8) }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ now: new Date(2026, 9, 13, 0, 5) }))).toEqual([]);
  });

  it("with names hidden no nag has task text or a task id, even from a record written before they were hidden", () => {
    const hidden = { ...NAG_ON, hideTaskNames: true };
    const before = nagPlanFromRecord(record, context({ settings: hidden }));
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(before)).not.toMatch(TASK_WORDS);
    expect(before.every((item) => !("taskId" in (item.data ?? {})))).toBe(true);
    // Once the day is planned again with names hidden, the same nags: nothing to reschedule.
    const replanned = planNagDay({ previous: record, now: at(8), dayKey: DAY, settings: hidden, open: OPEN, salt: "x" });
    expect(nagPlanFromRecord(replanned, context({ settings: hidden }))).toEqual(before);
  });
});
