// Nag mode (1.4, PR #91), as properties over many generated days rather than
// hand-picked ones. A day is played forward: the clock moves, nags go off,
// and between them the tasks, the persona, the level, the window and "hide
// task names" change, each followed by what the app does (plan the day again
// when it has to, sometimes write the AI's lines in, then read the plan).
//
// After every step: every nag is inside the window, later than now, an hour
// or more from every other nag AND from every nag that already went off
// today, with an id of its own; a change of words only keeps each pending
// nag's id and time; no nag is time-sensitive; with names hidden no nag has a
// task's words or id; a nag never names a task that is done or gone.
//
// Everything runs in each of ZONES (Node re-reads TZ when it is set) and on
// the days the clocks change in Los Angeles. Seeds are fixed: a failure
// repeats, and its message says which zone, day and seed.
import { afterEach, describe, expect, it } from "vitest";

import { addDays, toDateKey } from "../lib/daily-tasks/date";
import { NAG_LEVELS, NAG_PERSONA_LABELS, NAG_PERSONAS, type NagLevel, type NagLine, type NagPersona } from "../lib/daily-tasks/nag";
import {
  applyAiNagLines,
  NAG_CATEGORY_ID,
  NAG_LEVEL_COUNTS,
  NAG_MIN_GAP_MINUTES,
  nagAiKey,
  nagDayNeedsPlan,
  nagDayWantsAi,
  nagMinuteAt,
  nagOpenTasks,
  nagPlanFromRecord,
  nagSlotId,
  nagTimingKey,
  planNagDay,
  planNagTimes,
  type NagDayRecord,
  type NagPlanContext,
} from "../lib/daily-tasks/nag-plan";
import type { ReminderPlan } from "../lib/daily-tasks/reminder-plan";
import { DEFAULT_NOTIFICATIONS, NAG_WINDOW_LAST_MINUTE, NAG_WINDOW_MIN_SPAN, type NagWindow, type NotificationConfig } from "../lib/daily-tasks/types";

const MIN = 60_000;
const GAP = NAG_MIN_GAP_MINUTES * MIN;

/** Zone and its offset (minutes, as getTimezoneOffset gives it) on 15 January 2026, to prove the zone took. */
const ZONES: readonly (readonly [string, number])[] = [
  ["Pacific/Kiritimati", -840], // UTC+14: the local day is ahead of UTC's
  ["America/Los_Angeles", 480], // clock changes on 8 March and 1 November 2026
  ["Asia/Kolkata", -330], // a half-hour offset
  ["UTC", 0],
];
// An ordinary day, the two days Los Angeles changes its clocks, and the last day of a year.
const DAYS = ["2026-10-12", "2026-03-08", "2026-11-01", "2026-12-31"] as const;

const HOME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = HOME_ZONE;
});

/** Run in each zone; a failure says which. */
function inEachZone(run: (zone: string) => void) {
  for (const [zone, januaryOffset] of ZONES) {
    process.env.TZ = zone;
    try {
      expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(januaryOffset);
      run(zone);
    } catch (err) {
      (err as Error).message = `[TZ=${zone}] ${(err as Error).message}`;
      throw err;
    }
  }
}

/** mulberry32: a small seeded generator. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    bool: (chance = 0.5) => next() < chance,
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}
type Random = ReturnType<typeof seeded>;

// Made-up words, letters only: none is in any built-in line, so finding one
// in a nag means a task's text is there.
const WORDS = [
  "Zorvex", "Plimth", "Quandle", "Brispo", "Fennock", "Wuxley", "Drambo", "Kleptu", "Mivorn", "Jastle",
  "Grobin", "Tharvy", "Yelkin", "Oswix", "Vantrip", "Skolme", "Narbex", "Uldrie", "Cowphin", "Hembrat",
  "Ixtapol", "Runcible", "Sprax", "Twillig", "Embrazo", "Agwump", "Lomfrey", "Pindrox", "Bextula", "Dwimmer",
  "Corvash", "Meltrick", "Sundrop", "Vexley", "Harnock", "Pilbury", "Quorst", "Jindle", "Frabbit", "Worzel",
];
const WORD_PATTERN = new RegExp(WORDS.join("|"), "g");

interface SimTask {
  id: string;
  text: string;
  done: boolean;
}

function randomWindow(random: Random): NagWindow {
  const startMinutes = random.int(0, NAG_WINDOW_LAST_MINUTE - NAG_WINDOW_MIN_SPAN);
  const endMinutes = random.int(startMinutes + NAG_WINDOW_MIN_SPAN, NAG_WINDOW_LAST_MINUTE);
  return { startMinutes, endMinutes };
}

type Change = "none" | "tick" | "reword" | "add" | "remove" | "persona" | "level" | "window" | "hide";
const CHANGES: readonly Change[] = ["none", "tick", "reword", "add", "remove", "persona", "level", "window", "hide"];

interface Counts {
  plans: number;
  wordsOnly: number;
  redraws: number;
  nagsChecked: number;
  wentOff: number;
  heldByEarlier: number;
  hidden: number;
  repointed: number;
  ai: number;
}
const noCounts = (): Counts => ({ plans: 0, wordsOnly: 0, redraws: 0, nagsChecked: 0, wentOff: 0, heldByEarlier: 0, hidden: 0, repointed: 0, ai: 0 });

/** Plays one day forward; throws (through expect) on the first broken rule. */
function playDay(seed: number, dayKey: string, counts: Counts) {
  const random = seeded(seed);
  const pool = [...WORDS].sort(() => random.next() - 0.5);
  let nextId = 0;
  const newTask = (): SimTask => ({ id: `t${nextId++}`, text: `${pool.pop() ?? "Spare"} ${pool.pop() ?? "Words"}`, done: false });
  let tasks: SimTask[] = Array.from({ length: random.int(1, 3) }, newTask);
  let settings: NotificationConfig = {
    ...DEFAULT_NOTIFICATIONS,
    style: "nag",
    nagConfirmed: true,
    nagPersona: random.pick(NAG_PERSONAS),
    nagLevel: random.pick(NAG_LEVELS),
    nagWindow: randomWindow(random),
    hideTaskNames: random.bool(0.2),
  };
  const salt = `salt-${seed}`;
  // The clock, in real minutes from a start somewhere before or early in the window.
  let nowMs = nagMinuteAt(dayKey, random.int(0, Math.max(0, settings.nagWindow.startMinutes + 120))).getTime();
  // The night the clocks go back has one local hour twice: ids can repeat there (pinned below as a bug).
  const longDay = nagMinuteAt(addDays(dayKey, 1), 0).getTime() - nagMinuteAt(dayKey, 0).getTime() > 24 * 60 * MIN;
  let record: NagDayRecord | null = null;
  /** When nags really went off today: they were pending as the clock passed them. */
  const wentOff: number[] = [];
  let pending: ReminderPlan = [];
  // With names hidden there are fewer general lines than nags, and the nags left over are dropped
  // (docs/2026-10-v1.4.md, "What a nag says"). What that does to the rest of the day is pinned below.
  let hiddenToday = false;

  for (let step = 0; step < 14; step += 1) {
    const now = new Date(nowMs);
    if (toDateKey(now) !== dayKey) break;
    const where = `seed ${seed}, day ${dayKey}, step ${step}, ${now.toString()}`;
    const open = nagOpenTasks(tasks);
    const windowStart = nagMinuteAt(dayKey, settings.nagWindow.startMinutes).getTime();
    const windowEnd = nagMinuteAt(dayKey, settings.nagWindow.endMinutes).getTime();

    if (settings.hideTaskNames) hiddenToday = true;
    // What nag-day.ts does on a look at the day.
    if (open.length > 0 && (!record || nagDayNeedsPlan(record, { dayKey, settings, open }))) {
      const previous: NagDayRecord | null = record;
      const next: NagDayRecord = planNagDay({ previous, now, dayKey, settings, open, salt });
      counts.plans += 1;
      const future = next.slots.filter((slot) => slot.fireAtMs > nowMs);
      const past = next.slots.filter((slot) => slot.fireAtMs <= nowMs);
      if (previous && previous.dayKey === dayKey) {
        // What went off stays as it was.
        expect(past, where).toEqual(previous.slots.filter((slot) => slot.fireAtMs <= nowMs));
        if (previous.timingKey === nagTimingKey(settings.nagLevel, settings.nagWindow)) {
          // Words only: each nag still to come keeps its id, time and step.
          counts.wordsOnly += 1;
          const before = previous.slots.filter((slot) => slot.fireAtMs > nowMs).map(({ id, fireAtMs, step: at }) => `${id}@${fireAtMs}#${at}`);
          const after = future.map(({ id, fireAtMs, step: at }) => `${id}@${fireAtMs}#${at}`);
          for (const slot of after) expect(before, where).toContain(slot);
          // None is lost either, unless names are hidden (fewer general lines than nags).
          if (!hiddenToday) expect(after, where).toEqual(before);
          expect(next.draws, where).toBe(previous.draws);
        } else {
          counts.redraws += 1;
          expect(next.draws, where).toBe(previous.draws + 1);
        }
      }
      // Never more than the level's count in a day, however often it is drawn.
      expect(future.length, where).toBeLessThanOrEqual(Math.max(0, NAG_LEVEL_COUNTS[settings.nagLevel] - past.length));
      record = next;
    }

    // Sometimes the AI's lines arrive (at most twice a day, as nag-day.ts counts them).
    if (record && open.length > 0 && nagDayWantsAi(record, open, now) && random.bool(0.6)) {
      const asked: NagDayRecord = { ...record, aiCalls: record.aiCalls + 1, aiFor: nagAiKey(record.persona, record.level, open), aiFetchedAt: nowMs };
      expect(asked.aiCalls, where).toBeLessThanOrEqual(2);
      const lines: NagLine[] = Array.from({ length: Math.max(4, record.total) }, (_unused, index) => {
        const taskIndex = index % 4 === 3 ? null : index % open.length;
        return { step: index + 1, taskIndex, text: taskIndex === null ? `AI general line ${index + 1}.` : `AI ${index + 1} about ${open[taskIndex].text}.` };
      });
      const timesBefore = asked.slots.map((slot) => `${slot.id}@${slot.fireAtMs}`);
      record = random.bool(0.8) ? applyAiNagLines(asked, lines, open, now) : asked;
      // The AI changes words, never a time or an id.
      expect(record.slots.map((slot) => `${slot.id}@${slot.fireAtMs}`), where).toEqual(timesBefore);
      counts.ai += 1;
    }

    // The record as a whole: rising times, an hour or more apart, ids and steps of their own.
    if (record) {
      const { slots } = record;
      for (let index = 1; index < slots.length; index += 1) {
        expect(slots[index].fireAtMs - slots[index - 1].fireAtMs, where).toBeGreaterThanOrEqual(GAP);
      }
      // Steps run 1..n, one each.
      if (!hiddenToday) expect(slots.map((slot) => slot.step), where).toEqual(slots.map((_slot, index) => index + 1));
      if (!longDay) expect(new Set(slots.map((slot) => slot.id)).size, where).toBe(slots.length);
      // Everything that went off is still known to the record (that is what the hour is measured from).
      for (const time of wentOff) expect(slots.map((slot) => slot.fireAtMs), where).toContain(time);
    }

    // What the scheduler is given.
    const context: NagPlanContext = { now, today: dayKey, settings, permissionState: "granted", tasks, plus: true };
    const plan = nagPlanFromRecord(record, context);
    const openIds = new Set(open.map((task) => task.id));
    const openWords = new Set(open.flatMap((task) => task.text.split(" ")));
    if (open.length === 0) expect(plan, where).toEqual([]);
    if (!longDay) expect(new Set(plan.map((item) => item.id)).size, where).toBe(plan.length);
    plan.forEach((item, index) => {
      counts.nagsChecked += 1;
      const at = item.fireAt.getTime();
      expect(Number.isFinite(at), where).toBe(true);
      expect(at % MIN, where).toBe(0);
      expect(at, where).toBeGreaterThan(nowMs);
      expect(at, where).toBeGreaterThanOrEqual(windowStart);
      expect(at, where).toBeLessThanOrEqual(windowEnd);
      expect(toDateKey(item.fireAt), where).toBe(dayKey);
      expect(item.id, where).toBe(nagSlotId(item.fireAt));
      if (index > 0) expect(at - plan[index - 1].fireAt.getTime(), where).toBeGreaterThanOrEqual(GAP);
      for (const earlier of wentOff) {
        expect(at - earlier, where).toBeGreaterThanOrEqual(GAP);
        if (at - earlier < GAP + 20 * MIN) counts.heldByEarlier += 1;
      }
      // Never time-sensitive (or critical): a nag does not break through a Focus.
      expect(item.interruptionLevel, where).toBe("active");
      expect(item.sound, where).toBeUndefined();
      expect(item.kind, where).toBe("nag");
      expect(item.categoryId, where).toBe(NAG_CATEGORY_ID);
      expect(item.title, where).toContain(NAG_PERSONA_LABELS[settings.nagPersona]);
      expect(item.body.length, where).toBeGreaterThan(0);
      expect(item.body, where).not.toMatch(/[\u0000-\u001f—]/);
      const named = `${item.title} ${item.body}`.match(WORD_PATTERN) ?? [];
      if (settings.hideTaskNames) {
        counts.hidden += 1;
        expect(named, where).toEqual([]);
        expect(item.data?.taskId, where).toBeUndefined();
        expect(JSON.stringify(item), where).not.toMatch(WORD_PATTERN);
      } else {
        // Only a task that is open now is ever named.
        for (const word of named) expect([...openWords], where).toContain(word);
        if (item.data?.taskId !== undefined) expect([...openIds], where).toContain(item.data.taskId);
      }
      // The data is ids and numbers, never words.
      expect(Object.keys(item.data ?? {}).filter((key) => key !== "taskId" && key !== "step"), where).toEqual([]);
    });
    // The same look again gives the same plan (the scheduler then writes nothing).
    expect(nagPlanFromRecord(record, context), where).toEqual(plan);
    pending = plan;

    // The clock moves; whatever was pending and is now passed went off.
    nowMs += random.int(1, 170) * MIN;
    for (const item of pending) {
      if (item.fireAt.getTime() <= nowMs) {
        wentOff.push(item.fireAt.getTime());
        counts.wentOff += 1;
      }
    }

    // And something changes before the next look.
    const change = random.pick(CHANGES);
    if (change === "tick") {
      const openNow = tasks.filter((task) => !task.done);
      if (openNow.length > 0) {
        const ticked = random.pick(openNow);
        tasks = tasks.map((task) => (task.id === ticked.id ? { ...task, done: true } : task));
        counts.repointed += 1;
      }
    } else if (change === "reword" && tasks.length > 0) {
      const target = random.pick(tasks);
      tasks = tasks.map((task) => (task.id === target.id ? { ...newTask(), id: task.id, done: task.done } : task));
    } else if (change === "add" && tasks.length < 3) {
      tasks = [...tasks, newTask()];
    } else if (change === "remove" && tasks.length > 1) {
      const gone = random.pick(tasks);
      tasks = tasks.filter((task) => task.id !== gone.id);
    } else if (change === "persona") {
      settings = { ...settings, nagPersona: random.pick(NAG_PERSONAS) };
    } else if (change === "level") {
      settings = { ...settings, nagLevel: random.pick(NAG_LEVELS) };
    } else if (change === "window") {
      settings = { ...settings, nagWindow: randomWindow(random) };
    } else if (change === "hide") {
      settings = { ...settings, hideTaskNames: !settings.hideTaskNames };
    }
  }
}

describe("a day of nags, played forward with changes (property)", () => {
  it("in every zone and on clock-change days: inside the window, an hour from every other and from those that went off, ids kept, never time-sensitive, private when names are hidden", () => {
    const totals = noCounts();
    inEachZone((zone) => {
      for (const dayKey of DAYS) {
        for (let seed = 1; seed <= 150; seed += 1) {
          try {
            playDay(seed * 7919 + dayKey.length, dayKey, totals);
          } catch (err) {
            (err as Error).message = `[${zone} ${dayKey} seed ${seed}] ${(err as Error).message}`;
            throw err;
          }
        }
      }
    });
    // The property was really exercised (not vacuous): each kind of event happened, often.
    expect(totals.plans).toBeGreaterThan(2000);
    expect(totals.wordsOnly).toBeGreaterThan(300);
    expect(totals.redraws).toBeGreaterThan(300);
    expect(totals.nagsChecked).toBeGreaterThan(10_000);
    expect(totals.wentOff).toBeGreaterThan(1000);
    expect(totals.heldByEarlier).toBeGreaterThan(20);
    expect(totals.hidden).toBeGreaterThan(500);
    expect(totals.repointed).toBeGreaterThan(200);
    expect(totals.ai).toBeGreaterThan(300);
  }, 120_000);
});

describe("times, in every zone", () => {
  it("planNagTimes: on the day asked for, inside the window, whole minutes, an hour apart, the level's count when the day has room, the same for the same seed", () => {
    inEachZone(() => {
      const random = seeded(4242);
      for (const dayKey of DAYS) {
        for (let run = 0; run < 150; run += 1) {
          const window = randomWindow(random);
          const level: NagLevel = random.pick(NAG_LEVELS);
          const now = nagMinuteAt(dayKey, random.int(0, NAG_WINDOW_LAST_MINUTE));
          const input = { dayKey, salt: `s${run}`, window, now, count: NAG_LEVEL_COUNTS[level] };
          const times = planNagTimes(input);
          const where = `${dayKey} run ${run} ${JSON.stringify(window)} now ${now.toString()}`;
          expect(planNagTimes(input), where).toEqual(times);
          const start = nagMinuteAt(dayKey, window.startMinutes).getTime();
          const end = nagMinuteAt(dayKey, window.endMinutes).getTime();
          const base = Math.max(start, now.getTime() + 20 * MIN);
          expect(times.length, where).toBe(Math.max(0, Math.min(NAG_LEVEL_COUNTS[level], Math.floor((end - base) / GAP))));
          times.forEach((time, index) => {
            expect(time % MIN, where).toBe(0);
            expect(time, where).toBeGreaterThanOrEqual(base);
            expect(time, where).toBeLessThanOrEqual(end);
            expect(toDateKey(new Date(time)), where).toBe(dayKey);
            if (index > 0) expect(time - times[index - 1], where).toBeGreaterThanOrEqual(GAP);
          });
        }
      }
    });
  });

  it("the default window on a whole day gives Gentle 4, Firm 7, Relentless 11, between 9:00 and 21:00 by the local clock", () => {
    inEachZone(() => {
      for (const dayKey of DAYS) {
        for (const level of NAG_LEVELS) {
          for (let salt = 0; salt < 25; salt += 1) {
            const record = planNagDay({
              previous: null,
              now: nagMinuteAt(dayKey, 7 * 60),
              dayKey,
              settings: { ...DEFAULT_NOTIFICATIONS, nagLevel: level },
              open: [{ id: "t0", text: "Zorvex" }],
              salt: `salt-${salt}`,
            });
            expect(record.slots).toHaveLength(NAG_LEVEL_COUNTS[level]);
            for (const slot of record.slots) {
              const at = new Date(slot.fireAtMs);
              const minutes = at.getHours() * 60 + at.getMinutes();
              expect(toDateKey(at)).toBe(dayKey);
              expect(minutes).toBeGreaterThanOrEqual(9 * 60);
              expect(minutes).toBeLessThanOrEqual(21 * 60);
              expect(slot.id).toBe(`daily-tasks:${dayKey}:nag:${String(at.getHours()).padStart(2, "0")}${String(at.getMinutes()).padStart(2, "0")}`);
            }
          }
        }
      }
    });
  });

  // BUG (P3, lib/daily-tasks/nag-plan.ts nagSlotId): the id is the local HHmm,
  // and on the day the clocks go back one local hour happens twice. Two nags
  // 60 real minutes apart inside it get the same id, so one of them replaces
  // the other (one nag fewer that night). Only with a window that covers
  // 1:00 to 2:00 at night, on one day a year.
  it.fails("BUG: the night the clocks go back (Los Angeles, 1 November), two nags an hour apart never share an id", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(480);
    const dayKey = "2026-11-01";
    for (let salt = 0; salt < 400; salt += 1) {
      const times = planNagTimes({ dayKey, salt: `s${salt}`, window: { startMinutes: 0, endMinutes: 6 * 60 }, now: new Date(2026, 9, 31, 23, 0), count: 11 });
      const ids = times.map((time) => nagSlotId(new Date(time)));
      expect(new Set(ids).size, `salt ${salt}: ${ids.join(" ")}`).toBe(ids.length);
    }
  });
});

describe("the strategy, in every zone", () => {
  const TASKS = [
    { id: "t0", text: "Zorvex Plimth", done: false },
    { id: "t1", text: "Quandle Brispo", done: false },
  ];
  const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };

  it("who gets nags: Plus, the Nag style, permission, reminders on, not paused today, the record's own day, something open", () => {
    inEachZone(() => {
      for (const dayKey of DAYS) {
        const now = nagMinuteAt(dayKey, 8 * 60);
        const open = nagOpenTasks(TASKS);
        const record = planNagDay({ previous: null, now, dayKey, settings: NAG_ON, open, salt: "s" });
        const context = (overrides: Partial<NagPlanContext> = {}): NagPlanContext => ({ now, today: dayKey, settings: NAG_ON, permissionState: "granted", tasks: TASKS, plus: true, ...overrides });
        expect(nagPlanFromRecord(record, context())).toHaveLength(7);
        expect(nagPlanFromRecord(record, context({ plus: false }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ plus: undefined }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, style: "calm" } }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, enabled: false } }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ permissionState: "denied" }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ permissionState: "undetermined" }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, nagPausedDate: dayKey } }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ tasks: TASKS.map((task) => ({ ...task, done: true })) }))).toEqual([]);
        expect(nagPlanFromRecord(record, context({ tasks: [] }))).toEqual([]);
        // A pause from yesterday is over; a "pause" dated tomorrow isn't today's.
        expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, nagPausedDate: addDays(dayKey, -1) } }))).toHaveLength(7);
        expect(nagPlanFromRecord(record, context({ settings: { ...NAG_ON, nagPausedDate: addDays(dayKey, 1) } }))).toHaveLength(7);
        // Last of all the day: at 23:59 nothing is left, and nothing is planned.
        expect(nagPlanFromRecord(record, context({ now: nagMinuteAt(dayKey, NAG_WINDOW_LAST_MINUTE) }))).toEqual([]);
      }
    });
  });

  it("a record for another day gives nothing, even when its nags are still to come (the clock put back, or the store a day ahead)", () => {
    inEachZone(() => {
      const dayKey = "2026-10-12";
      const tomorrow = "2026-10-13";
      const open = nagOpenTasks(TASKS);
      // Planned for tomorrow (say the phone's clock was a day ahead, or flew west over the date line).
      const ahead = planNagDay({ previous: null, now: nagMinuteAt(tomorrow, 7 * 60), dayKey: tomorrow, settings: NAG_ON, open, salt: "s" });
      const now = nagMinuteAt(dayKey, 8 * 60);
      expect(ahead.slots.every((slot) => slot.fireAtMs > now.getTime())).toBe(true);
      const base = { now, settings: NAG_ON, permissionState: "granted" as const, tasks: TASKS, plus: true };
      // The store and the clock agree on today: tomorrow's record is not today's.
      expect(nagPlanFromRecord(ahead, { ...base, today: dayKey })).toEqual([]);
      // The store is on tomorrow, the clock is not: nothing yet either.
      expect(nagPlanFromRecord(ahead, { ...base, today: tomorrow })).toEqual([]);
      // Both on tomorrow: there they are.
      expect(nagPlanFromRecord(ahead, { ...base, today: tomorrow, now: nagMinuteAt(tomorrow, 8 * 60) })).toHaveLength(7);
    });
  });

  it("with names hidden a nag's data never carries a task id, whatever the record says", () => {
    const dayKey = "2026-10-12";
    const now = nagMinuteAt(dayKey, 8 * 60);
    const hidden: NotificationConfig = { ...NAG_ON, hideTaskNames: true };
    const record = planNagDay({ previous: null, now, dayKey, settings: hidden, open: nagOpenTasks(TASKS), salt: "s" });
    expect(record.hideNames).toBe(true);
    // A record that says "hidden" but (damaged, or written by another build) still points its slots at tasks.
    const pointed: NagDayRecord = { ...record, slots: record.slots.map((slot) => ({ ...slot, taskId: "t0" })) };
    const plan = nagPlanFromRecord(pointed, { now, today: dayKey, settings: hidden, permissionState: "granted", tasks: TASKS, plus: true });
    expect(plan.length).toBeGreaterThanOrEqual(3);
    for (const item of plan) {
      expect(item.data?.taskId).toBeUndefined();
      expect(JSON.stringify(item)).not.toMatch(/t0|Zorvex|Plimth|Quandle|Brispo/);
    }
  });
});

describe("the day after", () => {
  it("the first nag of a new day is an hour or more after yesterday's last, when the windows meet at midnight", () => {
    inEachZone(() => {
      const yesterday = "2026-10-12";
      const today = "2026-10-13";
      const late: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, nagLevel: "relentless", nagWindow: { startMinutes: 12 * 60, endMinutes: NAG_WINDOW_LAST_MINUTE } };
      const early: NotificationConfig = { ...late, nagWindow: { startMinutes: 0, endMinutes: 12 * 60 } };
      const open = [{ id: "t0", text: "Zorvex" }];
      let held = 0;
      for (let salt = 0; salt < 200; salt += 1) {
        const first = planNagDay({ previous: null, now: nagMinuteAt(yesterday, 11 * 60), dayKey: yesterday, settings: late, open, salt: `s${salt}` });
        const last = first.slots[first.slots.length - 1].fireAtMs;
        // 00:01 the next day: the window is already open.
        const now = nagMinuteAt(today, 1);
        const next = planNagDay({ previous: first, now, dayKey: today, settings: early, open, salt: "unused" });
        expect(next.dayKey).toBe(today);
        expect(next.salt).toBe(first.salt);
        expect(next.draws).toBe(0);
        expect(next.slots.every((slot) => slot.id.startsWith(`daily-tasks:${today}:nag:`))).toBe(true);
        expect(next.slots[0].step).toBe(1);
        expect(next.slots[0].fireAtMs - last).toBeGreaterThanOrEqual(GAP);
        // Without the rule the first could be at 00:21.
        if (last + GAP > now.getTime() + 20 * MIN) held += 1;
      }
      // Yesterday's last was late enough to matter in many of them.
      expect(held).toBeGreaterThan(20);
    });
  });

  it("a new day starts clean: yesterday's nags aren't history, the AI may be asked again, and yesterday's pause is over", () => {
    const yesterday = "2026-10-12";
    const today = "2026-10-13";
    const settings: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagPausedDate: yesterday };
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    const open = nagOpenTasks(tasks);
    const used: NagDayRecord = {
      ...planNagDay({ previous: null, now: nagMinuteAt(yesterday, 8 * 60), dayKey: yesterday, settings, open, salt: "s" }),
      aiCalls: 2,
      aiFor: nagAiKey("mom", "firm", open),
      aiFetchedAt: nagMinuteAt(yesterday, 8 * 60).getTime(),
      source: "ai",
    };
    const now = nagMinuteAt(today, 8 * 60);
    expect(nagDayNeedsPlan(used, { dayKey: today, settings, open })).toBe(true);
    const next = planNagDay({ previous: used, now, dayKey: today, settings, open, salt: "other" });
    expect(next).toMatchObject({ dayKey: today, aiCalls: 0, aiFor: null, aiFetchedAt: null, source: "local", draws: 0, total: 7, salt: "s" });
    expect(next.slots).toHaveLength(7);
    expect(next.slots.map((slot) => slot.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(next.slots.every((slot) => toDateKey(new Date(slot.fireAtMs)) === today)).toBe(true);
    expect(next.version).toBe(used.version + 1);
    expect(nagDayWantsAi(next, open, now)).toBe(true);
    // Paused yesterday: today the nags are back with no tap.
    const context: NagPlanContext = { now, today, settings, permissionState: "granted", tasks, plus: true };
    expect(nagPlanFromRecord(next, context)).toHaveLength(7);
    // And yesterday's record itself gives nothing today.
    expect(nagPlanFromRecord(used, context)).toEqual([]);
  });

  it.each(NAG_PERSONAS.flatMap((persona) => NAG_LEVELS.map((level) => [persona, level] as [NagPersona, NagLevel])))(
    "%s / %s: every nag of a whole default day has words, and none is time-sensitive",
    (persona, level) => {
      const dayKey = "2026-10-12";
      const now = nagMinuteAt(dayKey, 6 * 60);
      const settings: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagPersona: persona, nagLevel: level };
      const tasks = [{ id: "t0", text: "Zorvex", done: false }];
      for (const hideTaskNames of [false, true]) {
        const record = planNagDay({ previous: null, now, dayKey, settings: { ...settings, hideTaskNames }, open: nagOpenTasks(tasks), salt: "s" });
        const plan = nagPlanFromRecord(record, { now, today: dayKey, settings: { ...settings, hideTaskNames }, permissionState: "granted", tasks, plus: true });
        if (!hideTaskNames) expect(plan).toHaveLength(NAG_LEVEL_COUNTS[level]);
        expect(plan.length).toBeGreaterThanOrEqual(3);
        for (const item of plan) {
          expect(item.interruptionLevel).toBe("active");
          expect(["timeSensitive", "critical"]).not.toContain(item.interruptionLevel);
          expect(item.body).not.toBe("");
        }
      }
    },
  );
});

describe("names hidden for a while (fewer general lines than nags)", () => {
  const dayKey = "2026-10-12";
  const open = [{ id: "t0", text: "Zorvex" }];
  const shown: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagLevel: "relentless" };
  const hidden: NotificationConfig = { ...shown, hideTaskNames: true };

  it("as documented: a Relentless day with names hidden has fewer nags than eleven, each with a general line, an hour or more apart", () => {
    const record = planNagDay({ previous: null, now: nagMinuteAt(dayKey, 8 * 60), dayKey, settings: hidden, open, salt: "s" });
    expect(record.total).toBe(11);
    expect(record.slots.length).toBeGreaterThanOrEqual(4);
    expect(record.slots.length).toBeLessThan(11);
    expect(record.slots.every((slot) => slot.taskId === null && !/Zorvex/.test(slot.text))).toBe(true);
    for (let index = 1; index < record.slots.length; index += 1) expect(record.slots[index].fireAtMs - record.slots[index - 1].fireAtMs).toBeGreaterThanOrEqual(GAP);
  });

  // BUG (P3; lib/daily-tasks/nag-plan.ts planNagDay, `future.flatMap`): the
  // nags that get no general line are taken out of the saved record, not
  // just out of the plan. Showing names again the same day plans "words
  // only" from what is left, so the day stays short (Relentless: 7 of 11,
  // Firm: 6 of 7) until tomorrow, even after the switch was on for a moment.
  // The doc says nags still to come keep their id, time and step when names
  // are hidden or shown.
  it.fails("BUG: showing names again the same day brings back the nags that had no general line", () => {
    const first = planNagDay({ previous: null, now: nagMinuteAt(dayKey, 8 * 60), dayKey, settings: shown, open, salt: "s" });
    expect(first.slots).toHaveLength(11);
    const whileHidden = planNagDay({ previous: first, now: nagMinuteAt(dayKey, 8 * 60 + 1), dayKey, settings: hidden, open, salt: "s" });
    const again = planNagDay({ previous: whileHidden, now: nagMinuteAt(dayKey, 8 * 60 + 2), dayKey, settings: shown, open, salt: "s" });
    expect(again.slots.map((slot) => [slot.id, slot.fireAtMs, slot.step])).toEqual(first.slots.map((slot) => [slot.id, slot.fireAtMs, slot.step]));
  });

  // BUG (P3; lib/daily-tasks/nag-plan.ts planNagDay, `step: past.length +
  // index + 1` and `total = past.length + times.length`): after nags were
  // dropped for having no line, the ones that went off no longer have steps
  // 1..k, so a new level or window numbers the rest from a step below the
  // last one that went off, against a smaller total. The steps stop rising
  // and two nags in a row say the same line.
  it.fails("BUG: a new window after names were hidden keeps the steps rising and never repeats a line", () => {
    for (let salt = 0; salt < 40; salt += 1) {
      const morning = planNagDay({ previous: null, now: nagMinuteAt(dayKey, 8 * 60), dayKey, settings: hidden, open, salt: `s${salt}` });
      const redrawn = planNagDay({
        previous: morning,
        now: nagMinuteAt(dayKey, 14 * 60),
        dayKey,
        settings: { ...hidden, nagWindow: { startMinutes: 9 * 60, endMinutes: 22 * 60 } },
        open,
        salt: "unused",
      });
      const steps = redrawn.slots.map((slot) => slot.step);
      expect(steps, `salt ${salt}`).toEqual([...new Set(steps)].sort((x, y) => x - y));
      const texts = redrawn.slots.map((slot) => slot.text);
      expect(new Set(texts).size, `salt ${salt}: ${texts.join(" | ")}`).toBe(texts.length);
    }
  });
});

describe("the phone changes time zone during the day", () => {
  // BUG (P3; lib/daily-tasks/nag-plan.ts nagDayNeedsPlan / nagRecordApplies):
  // the day's times are kept as moments, and nothing notices that the local
  // clock they were drawn for has moved. Planned at 8:00 in Los Angeles for
  // 9:00 to 21:00, then the phone is in Kolkata (20:30, the same date): the
  // record still "applies", so its nags are pending from 21:30 through the
  // night to 9:30 the next morning, all outside the window and most of them
  // on the wrong day. They stay until the app is next opened on the new day.
  it.fails("BUG: after a change of time zone the same day, no nag is left outside the window or on another day", () => {
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    const settings: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
    process.env.TZ = "America/Los_Angeles";
    const dayKey = "2026-10-12";
    const planned = planNagDay({ previous: null, now: nagMinuteAt(dayKey, 8 * 60), dayKey, settings, open: nagOpenTasks(tasks), salt: "s" });
    const instant = nagMinuteAt(dayKey, 8 * 60).getTime();

    process.env.TZ = "Asia/Kolkata";
    const now = new Date(instant);
    expect(toDateKey(now)).toBe(dayKey);
    // What nag-day.ts and the strategy do on the next look.
    const open = nagOpenTasks(tasks);
    const record = nagDayNeedsPlan(planned, { dayKey, settings, open }) ? planNagDay({ previous: planned, now, dayKey, settings, open, salt: "s" }) : planned;
    const plan = nagPlanFromRecord(record, { now, today: dayKey, settings, permissionState: "granted", tasks, plus: true });
    for (const item of plan) {
      const minutes = item.fireAt.getHours() * 60 + item.fireAt.getMinutes();
      expect(toDateKey(item.fireAt), item.fireAt.toString()).toBe(dayKey);
      expect(minutes, item.fireAt.toString()).toBeGreaterThanOrEqual(settings.nagWindow.startMinutes);
      expect(minutes, item.fireAt.toString()).toBeLessThanOrEqual(settings.nagWindow.endMinutes);
    }
  });
});
