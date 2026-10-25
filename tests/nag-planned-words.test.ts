// 1.4.1: nagRecordWithPlannedWords, the record with each slot still to come
// noting the words it is scheduled with (`sent`) when they aren't its own.
// `text` and `taskId` never change. All dates are local time.
import { describe, expect, it } from "vitest";

import { builtInNagLines, type NagLine } from "../lib/daily-tasks/nag";
import {
  isNagRecordStub,
  nagPlanFromRecord,
  nagRecordStub,
  nagRecordWithPlannedWords,
  normalizeNagRecord,
  planNagDay,
  type NagDayRecord,
  type NagPlanContext,
} from "../lib/daily-tasks/nag-plan";
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

  it("notes the words of a ticked task's slots that are still to come, and only those; text, task and version stay", () => {
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
      if (slot.fireAtMs <= now.getTime()) expect(slot, "a nag that went off is not touched").toEqual(before);
      else if (before.taskId === "t2") {
        expect({ text: slot.text, taskId: slot.taskId }).toEqual({ text: before.text, taskId: before.taskId });
        expect(slot.sent).toBeDefined();
        expect(slot.sent).not.toBe(before.text);
        expect(slot.sent).not.toMatch(/Walk the dog/i);
      } else expect(slot).toEqual(before);
    });
    // The scheduled plan is unchanged by the note: nothing to reschedule.
    expect(bodies(written, ctx)).toEqual(bodies(record, ctx));
    const future = written?.slots.filter((slot) => slot.fireAtMs > now.getTime()) ?? [];
    expect(future.filter((slot) => slot.sent !== undefined).map((slot) => slot.sent)).toEqual(
      nagPlanFromRecord(record, ctx).filter((item, index) => item.body !== future[index]?.text).map((item) => item.body),
    );
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
    const notes = (written?.slots ?? []).map((slot) => slot.sent);
    expect(notes.every((sent) => sent !== undefined)).toBe(true);
    expect(JSON.stringify(notes)).not.toMatch(/dentist|report|Walk the dog|love/i);
    expect(written?.version).toBe(ai.version);
  });

  it("an undone tick brings the task's own lines back, and the note comes off", () => {
    const ticked = context({ tasks: TICKED });
    const written = nagRecordWithPlannedWords(record, ticked);
    expect(written).not.toBeNull();
    if (!written) return;
    // Unticked: the plan from the noted record is the day's own one again.
    expect(bodies(written, context())).toEqual(bodies(record, context()));
    expect(nagPlanFromRecord(written, context()).filter((item) => item.data?.taskId === "t2").length).toBe(
      nagPlanFromRecord(record, context()).filter((item) => item.data?.taskId === "t2").length,
    );
    const cleared = nagRecordWithPlannedWords(written, context());
    expect(cleared?.slots).toEqual(record.slots);
  });

  it("a note never changes a nag still to come: a stale one is ignored by the plan", () => {
    const written = nagRecordWithPlannedWords(record, context({ tasks: TICKED }));
    if (!written) throw new Error("expected a note");
    // As if the write landed late, after the untick: the pending nags are the day's own.
    expect(nagPlanFromRecord(written, context())).toEqual(nagPlanFromRecord(record, context()));
    // Even a nonsense note on every slot still to come.
    const garbage = { ...record, slots: record.slots.map((slot) => ({ ...slot, sent: "Stale words" })) };
    expect(nagPlanFromRecord(garbage, context())).toEqual(nagPlanFromRecord(record, context()));
  });

  it("a nag that went off with put-in words is never said again on a redraw", () => {
    const now = at(12);
    const ticked = context({ now: at(8), tasks: TICKED });
    const written = nagRecordWithPlannedWords(record, ticked);
    if (!written) throw new Error("expected a note");
    const saidPast = written.slots.filter((slot) => slot.fireAtMs <= now.getTime()).map((slot) => slot.sent ?? slot.text);
    for (const level of ["gentle", "relentless"] as const) {
      const again = planNagDay({ previous: written, now, dayKey: DAY, settings: { ...NAG_ON, nagLevel: level }, open: OPEN.slice(0, 2), salt: "x" });
      const future = again.slots.filter((slot) => slot.fireAtMs > now.getTime());
      for (const slot of future) {
        expect(saidPast).not.toContain(slot.text);
        expect(slot.sent).toBeUndefined();
      }
    }
  });

  it("records saved before 1.4.1 (no note) and with one load; a note equal to the text is dropped", () => {
    const raw = JSON.parse(JSON.stringify(record));
    expect(normalizeNagRecord(raw)?.slots).toEqual(record.slots);
    raw.slots[0].sent = "Said instead";
    raw.slots[1].sent = raw.slots[1].text;
    raw.slots[2].sent = 42;
    const loaded = normalizeNagRecord(raw);
    expect(loaded?.slots[0].sent).toBe("Said instead");
    expect(loaded?.slots[1]).not.toHaveProperty("sent");
    expect(loaded?.slots[2]).not.toHaveProperty("sent");
  });

  it("back to Calm takes the notes out with the words", () => {
    const written = nagRecordWithPlannedWords(record, context({ tasks: TICKED }));
    if (!written) throw new Error("expected a note");
    const late = new Date(Math.max(...written.slots.map((slot) => slot.fireAtMs)) + 1);
    const withPastNotes = { ...written, slots: written.slots.map((slot) => ({ ...slot, sent: slot.sent ?? "x" })) };
    const stub = nagRecordStub(withPastNotes, late);
    expect(stub.slots.every((slot) => slot.sent === undefined)).toBe(true);
    expect(isNagRecordStub(stub, late)).toBe(true);
    expect(isNagRecordStub(withPastNotes, late)).toBe(false);
  });
});
