// 1.6 G: "Snooze 1 hour" on a nag. The next nag comes an hour after the tap,
// or at its own time when that was later (a snooze never brings a nag sooner), any nag left less than an hour after it is
// taken out, outside the window the day goes quiet, and `snoozedUntil` holds
// a redrawn day back. Local-time fixtures, so it passes under any TZ
// (America/New_York, Asia/Kolkata, Pacific/Kiritimati, Pacific/Pago_Pago).

import { describe, expect, it } from "vitest";

import {
  nagPlanFromRecord,
  NAG_SNOOZE_MINUTES,
  normalizeNagRecord,
  planNagDay,
  snoozeNagRecord,
  type NagDayRecord,
  type NagSlot,
} from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NAG_WINDOW, DEFAULT_NOTIFICATIONS, type NagWindow, type NotificationConfig } from "../lib/daily-tasks/types";

const DAY = "2026-10-12";
const MIN = 60_000;
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
const ms = (hour: number, minute = 0) => at(hour, minute).getTime();
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagLevel: "relentless" };
const TASKS = [
  { id: "t0", text: "Zorvex the plimth", done: false },
  { id: "t1", text: "Quandle a brispo", done: false },
];

const slot = (step: number, hour: number, minute: number, text = `Line ${step}`): NagSlot => {
  const when = at(hour, minute);
  const id = `daily-tasks:${DAY}:nag:${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
  return { id, fireAtMs: when.getTime(), step, text, taskId: step % 2 ? "t0" : null };
};
const base = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: NAG_ON, open: TASKS.map(({ id, text }) => ({ id, text })), salt: "snz" });
const recordOf = (slots: NagSlot[]): NagDayRecord => ({ ...base, slots, total: slots.length, version: 7 });
const times = (record: NagDayRecord) => record.slots.map((item) => item.fireAtMs);
const W: NagWindow = DEFAULT_NAG_WINDOW; // 09:00 to 21:00

describe("Snooze 1 hour: the next nag is moved to the tap plus an hour", () => {
  it("a nag that was later stays where it was (never sooner), keeping its id, step and words; the nags after it stay", () => {
    const record = recordOf([slot(1, 10, 0), slot(2, 11, 30), slot(3, 12, 30), slot(4, 14, 0), slot(5, 16, 0)]);
    const next = snoozeNagRecord(record, at(10, 5), W);
    expect(times(next)).toEqual([ms(10, 0), ms(11, 30), ms(12, 30), ms(14, 0), ms(16, 0)]);
    expect(next.slots[1]).toEqual(record.slots[1]);
    expect(NAG_SNOOZE_MINUTES).toBe(60);
    expect(next.snoozedUntil).toBe(ms(11, 5));
    expect(next.version).toBe(8);
  });

  it("a nag that was sooner is moved later, and the nags now within the hour after it are taken out", () => {
    const record = recordOf([slot(1, 10, 0), slot(2, 11, 0), slot(3, 12, 10), slot(4, 12, 45), slot(5, 14, 0), slot(6, 16, 0)]);
    // Tapped at 10:30 on the 10:00 nag: one hour on is 11:30, after the 11:00 nag.
    const next = snoozeNagRecord(record, at(10, 30), W);
    // 12:10 is 40 minutes after 11:30 and 12:45 is 75: only 12:10 goes.
    expect(times(next)).toEqual([ms(10, 0), ms(11, 30), ms(12, 45), ms(14, 0), ms(16, 0)]);
    expect(next.slots[1].step).toBe(2);
    expect(next.slots[1].text).toBe("Line 2");
    // A nag exactly an hour after stays.
    const edge = snoozeNagRecord(recordOf([slot(1, 10, 0), slot(2, 11, 0), slot(3, 12, 30)]), at(10, 30), W);
    expect(times(edge)).toEqual([ms(10, 0), ms(11, 30), ms(12, 30)]);
  });

  it("every nag of the day still has an hour between it and the one before, inside the window, with its own id", () => {
    for (const level of ["gentle", "firm", "relentless"] as const) {
      for (let seed = 0; seed < 20; seed += 1) {
        const settings = { ...NAG_ON, nagLevel: level };
        const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: TASKS.map(({ id, text }) => ({ id, text })), salt: `p${seed}` });
        const first = planned.slots[0].fireAtMs;
        for (const lag of [1, 15, 45, 119]) {
          const tap = new Date(first + lag * MIN);
          const out = snoozeNagRecord(planned, tap, W);
          const until = Math.ceil((tap.getTime() + 60 * MIN) / MIN) * MIN;
          const future = out.slots.filter((item) => item.fireAtMs > tap.getTime());
          const ctx = `${level} seed ${seed} lag ${lag}`;
          future.forEach((item, index) => {
            expect(item.fireAtMs, ctx).toBeGreaterThanOrEqual(until);
            if (index > 0) expect(item.fireAtMs - future[index - 1].fireAtMs, ctx).toBeGreaterThanOrEqual(60 * MIN);
            expect(item.fireAtMs, ctx).toBeLessThanOrEqual(ms(21, 0));
          });
          // The first nag after the tap is the snooze, or its own time when that was later (never sooner).
          const planNext = planned.slots.find((item) => item.fireAtMs > tap.getTime() && item.text !== "");
          const expected = planNext ? Math.max(until, planNext.fireAtMs) : null;
          if (until <= ms(21, 0) && expected !== null) expect(future[0]?.fireAtMs, ctx).toBe(expected);
          // Nobody gained a nag or a time.
          const original = new Set(planned.slots.map((item) => item.fireAtMs));
          out.slots.filter((item) => item.fireAtMs !== until).forEach((item) => expect(original.has(item.fireAtMs), ctx).toBe(true));
          expect(new Set(out.slots.map((item) => item.id)).size, ctx).toBe(out.slots.length);
          expect(out.slots.filter((item) => item.fireAtMs <= tap.getTime())).toEqual(planned.slots.filter((item) => item.fireAtMs <= tap.getTime()));
        }
      }
    }
  });

  it("a slot with no words isn't the snoozed one: the first nag with words is, and the wordless ones before it go", () => {
    const record = recordOf([slot(1, 10, 0), slot(2, 10, 40, ""), slot(3, 11, 45), slot(4, 14, 0)]);
    const next = snoozeNagRecord(record, at(10, 5), W);
    // 11:45 is after 11:05, so it keeps its time.
    expect(times(next)).toEqual([ms(10, 0), ms(11, 45), ms(14, 0)]);
    expect(next.slots[1].text).toBe("Line 3");
    const sooner = snoozeNagRecord(recordOf([slot(1, 10, 0), slot(2, 10, 40, ""), slot(3, 10, 50), slot(4, 14, 0)]), at(10, 5), W);
    expect(times(sooner)).toEqual([ms(10, 0), ms(11, 5), ms(14, 0)]);
    expect(sooner.slots[1].text).toBe("Line 3");
  });

  it("does not change the record it is given", () => {
    const record = recordOf([slot(1, 10, 0), slot(2, 11, 30)]);
    const before = JSON.stringify(record);
    snoozeNagRecord(record, at(10, 5), W);
    expect(JSON.stringify(record)).toBe(before);
  });
});

describe("Snooze 1 hour at the end of the window", () => {
  it("the window's last minute is still inside: the next nag goes there", () => {
    const record = recordOf([slot(1, 19, 0), slot(2, 20, 30)]);
    const next = snoozeNagRecord(record, at(20, 0), W);
    expect(times(next)).toEqual([ms(19, 0), ms(21, 0)]);
  });

  it("a minute past it, the rest of the day goes quiet (the nag that would have come is gone)", () => {
    const record = recordOf([slot(1, 19, 0), slot(2, 20, 30)]);
    const next = snoozeNagRecord(record, at(20, 1), W);
    expect(times(next)).toEqual([ms(19, 0)]);
    expect(next.snoozedUntil).toBe(ms(21, 1));
    expect(nagPlanFromRecord(next, { now: at(20, 2), today: DAY, settings: NAG_ON, permissionState: "granted", tasks: TASKS, plus: true })).toEqual([]);
  });

  it("an hour that runs into the next day is quiet too, also for a window that ends at 23:59", () => {
    const late: NagWindow = { startMinutes: 20 * 60, endMinutes: 23 * 60 + 59 };
    const record = recordOf([slot(1, 21, 0), slot(2, 23, 30)]);
    const next = snoozeNagRecord(record, at(23, 10), late);
    expect(times(next)).toEqual([ms(21, 0)]);
    // Tapped at 22:30 the hour ends 23:30, inside the window.
    expect(times(snoozeNagRecord(recordOf([slot(1, 21, 0), slot(2, 23, 20)]), at(22, 30), late))).toEqual([ms(21, 0), ms(23, 30)]);
  });
});

describe("snoozedUntil holds back a day that is drawn again", () => {
  const open = TASKS.map(({ id, text }) => ({ id, text }));

  it("another level after a snooze starts no earlier than the snooze's end (and not an hour before its own nag)", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: { ...NAG_ON, nagLevel: "gentle" }, open, salt: `r${seed}` });
      const tap = new Date(planned.slots[0].fireAtMs + 40 * MIN);
      const snoozed = snoozeNagRecord(planned, tap, W);
      const until = snoozed.snoozedUntil!;
      const now = new Date(tap.getTime() + MIN);
      const redrawn = planNagDay({ previous: snoozed, now, dayKey: DAY, settings: { ...NAG_ON, nagLevel: "relentless" }, open, salt: "ignored" });
      const future = redrawn.slots.filter((item) => item.fireAtMs > now.getTime());
      expect(future.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const item of future) expect(item.fireAtMs, `seed ${seed}`).toBeGreaterThanOrEqual(until);
      expect(redrawn.snoozedUntil).toBe(until);
    }
  });

  it("the same level and window keep the snoozed day as it is", () => {
    const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: NAG_ON, open, salt: "same" });
    const tap = new Date(planned.slots[0].fireAtMs + 5 * MIN);
    const snoozed = snoozeNagRecord(planned, tap, W);
    const again = planNagDay({ previous: snoozed, now: new Date(tap.getTime() + MIN), dayKey: DAY, settings: NAG_ON, open, salt: "same" });
    expect(times(again)).toEqual(times(snoozed));
  });

  it("a record that missed the snooze (a slot before snoozedUntil) schedules nothing for that slot", () => {
    const record = { ...recordOf([slot(1, 10, 0), slot(2, 10, 40), slot(3, 12, 0)]), snoozedUntil: ms(11, 5) };
    const plan = nagPlanFromRecord(record, { now: at(10, 5), today: DAY, settings: NAG_ON, permissionState: "granted", tasks: TASKS, plus: true });
    expect(plan.map((item) => item.fireAt.getTime())).toEqual([ms(12, 0)]);
  });

  it("is kept when the record is loaded, and dropped when it isn't a time", () => {
    const record = { ...recordOf([slot(1, 10, 0)]), snoozedUntil: ms(11, 5) };
    expect(normalizeNagRecord(JSON.parse(JSON.stringify(record)))?.snoozedUntil).toBe(ms(11, 5));
    for (const junk of ["soon", -1, 0, Number.NaN, null, 9e15]) {
      expect(normalizeNagRecord({ ...JSON.parse(JSON.stringify(record)), snoozedUntil: junk })).not.toHaveProperty("snoozedUntil");
    }
  });
});
