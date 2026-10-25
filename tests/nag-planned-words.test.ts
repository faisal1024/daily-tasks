// 1.4.1: nagRecordWithPlannedWords, the record with the words the plan puts
// in for the slots still to come written back. All dates are local time.
import { describe, expect, it } from "vitest";

import { builtInNagLines, type NagLine } from "../lib/daily-tasks/nag";
import { nagPlanFromRecord, nagRecordWithPlannedWords, planNagDay, type NagDayRecord, type NagPlanContext } from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";

const DAY = "2026-10-12";
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const HIDDEN: NotificationConfig = { ...NAG_ON, hideTaskNames: true };
const TASKS = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
const OPEN = TASKS.map(({ id, text }) => ({ id, text }));
const TICKED = [TASKS[0], TASKS[1], { ...TASKS[2], done: true }];

const context = (overrides: Partial<NagPlanContext> = {}): NagPlanContext => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  tasks: TASKS,
  plus: true,
  ...overrides,
});
const plan = (settings: NotificationConfig = NAG_ON): NagDayRecord => planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: OPEN, salt: "salt-a" });
const bodies = (record: NagDayRecord | null, ctx: NagPlanContext) => nagPlanFromRecord(record, ctx).map((item) => item.body);

describe("nagRecordWithPlannedWords", () => {
  const record = plan();

  it("writes the words of a ticked task's slots that are still to come, and only those; the version stays", () => {
    // Some of t2's slots have gone off by 12:00 and some haven't.
    const now = at(12);
    const named = record.slots.filter((slot) => slot.taskId === "t2");
    expect(named.some((slot) => slot.fireAtMs <= now.getTime())).toBe(true);
    expect(named.some((slot) => slot.fireAtMs > now.getTime())).toBe(true);

    const ctx = context({ now, tasks: TICKED });
    const written = nagRecordWithPlannedWords(record, ctx);
    expect(written).not.toBeNull();
    expect(written?.version).toBe(record.version);
    written?.slots.forEach((slot, index) => {
      const before = record.slots[index];
      if (slot.fireAtMs <= now.getTime()) expect(slot, "a nag that went off keeps what it said").toEqual(before);
      else if (before.taskId === "t2") expect(slot.text).not.toBe(before.text);
      else expect(slot).toEqual(before);
    });
    // The scheduled plan is the one the record now holds: nothing to reschedule.
    expect(bodies(written, ctx)).toEqual(bodies(record, ctx));
    expect(JSON.stringify(written?.slots.filter((slot) => slot.fireAtMs > now.getTime()))).not.toMatch(/Walk the dog/i);
  });

  it("writes nothing when nothing changed: the record as planned, or the one just written", () => {
    expect(nagRecordWithPlannedWords(record, context())).toBeNull();
    const ctx = context({ tasks: TICKED });
    const written = nagRecordWithPlannedWords(record, ctx);
    expect(written).not.toBeNull();
    expect(nagRecordWithPlannedWords(written, ctx)).toBeNull();
    // And nothing at all when the record doesn't apply (another day, or none).
    expect(nagRecordWithPlannedWords(null, ctx)).toBeNull();
    expect(nagRecordWithPlannedWords(record, context({ tasks: TICKED, today: "2026-10-13", now: new Date(2026, 9, 13, 8) }))).toBeNull();
  });

  it("writes nothing in the just-hidden case: the record still shows names, the settings now hide them", () => {
    const ctx = context({ tasks: TICKED, settings: HIDDEN });
    // The plan does change (general lines), but planNagDay is the one to rewrite this record.
    expect(nagPlanFromRecord(record, ctx).length).toBeGreaterThan(0);
    expect(nagRecordWithPlannedWords(record, ctx)).toBeNull();
  });

  it("writes nothing for a slot with no line left; the slot keeps its words and isn't scheduled", () => {
    // Every line of the next task's set is already said by another slot, so the ticked task's last slot has none.
    const count = record.total;
    const set: NagLine[] = builtInNagLines({ persona: "mom", level: "firm", tasks: [OPEN[0]], count, seed: `${DAY}|salt-a` });
    expect(set.length).toBeGreaterThanOrEqual(count);
    const last = record.slots.length - 1;
    const slots = record.slots.map((slot, index) => {
      if (index === last) return { ...slot, text: "Gone with the dog walk", taskId: "t2" };
      // Slot 0 says the line the last slot would have been given.
      const line = set[index === 0 ? last : index];
      return { ...slot, text: line.text, taskId: line.taskIndex === null ? null : "t0" };
    });
    const crafted = { ...record, slots };
    const ctx = context({ tasks: TICKED, now: at(7) });
    expect(nagPlanFromRecord(crafted, ctx)).toHaveLength(slots.length - 1);
    expect(nagRecordWithPlannedWords(crafted, ctx)).toBeNull();
  });

  it("with names hidden never writes a task's name or id, even replacing an affectionate AI line", () => {
    const hiddenRecord = plan(HIDDEN);
    expect(hiddenRecord.hideNames).toBe(true);
    const ai = { ...hiddenRecord, source: "ai" as const, slots: hiddenRecord.slots.map((slot) => ({ ...slot, text: "I love you, do the thing", taskId: null })) };
    const ctx = context({ settings: HIDDEN, tasks: TASKS });
    const written = nagRecordWithPlannedWords(ai, ctx);
    expect(written).not.toBeNull();
    expect(written?.slots.every((slot) => slot.taskId === null)).toBe(true);
    expect(JSON.stringify(written?.slots)).not.toMatch(/dentist|report|Walk the dog|love/i);
    expect(written?.version).toBe(ai.version);
  });
});
