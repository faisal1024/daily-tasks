// Nag mode (1.4, PR #91), the second review's must-fixes, as rules:
//
// 1. no two nags of a day say the same thing, also after the day was drawn
//    again or names were hidden and shown, and a task was then ticked;
// 2. a day planned with one or two nags left starts on an opening line;
// 3. with names shown most built-in nags name a task, and each task gets
//    its turn;
// 4. Calm leaves a record with no words in it, and Nag again the same day
//    carries the day on (the count, the hour between nags, the AI requests);
// and the smaller ones: the sanitiser's "yourself", clock words and the
// joiners Persian and the Indic scripts are written with, and a task's name
// that ends in an initial.
import { describe, expect, it } from "vitest";

import {
  NAG_LEVELS,
  NAG_PERSONAS,
  NAG_TEMPLATES,
  builtInNagLines,
  nagTaskName,
  parseNagResponse,
  type NagLevel,
  type NagLine,
  type NagPersona,
} from "../lib/daily-tasks/nag";
import {
  MAX_NAG_AI_CALLS_PER_DAY,
  NAG_LEVEL_COUNTS,
  applyAiNagLines,
  isNagRecordStub,
  lineForStep,
  nagAiKey,
  nagDayNeedsPlan,
  nagDayWantsAi,
  nagMinuteAt,
  nagOpenTasks,
  nagPlanFromRecord,
  nagRecordStub,
  normalizeNagRecord,
  planNagDay,
  type NagDayRecord,
} from "../lib/daily-tasks/nag-plan";
import type { ReminderPlan } from "../lib/daily-tasks/reminder-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";
import * as server from "../server/providers/nag-contract.mjs";

const DAY = "2026-10-12";
const HOUR = 60 * 60_000;
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const at = (hour: number, minute = 0) => nagMinuteAt(DAY, hour * 60 + minute);
// Made-up words: none is in any built-in line.
const WORDS = ["Zorvex the plimth", "Quandle a brispo", "Fennock wuxley"];
const tasksOf = (count: number, done: string[] = []) =>
  WORDS.slice(0, count).map((text, index) => ({ id: `t${index}`, text, done: done.includes(`t${index}`) }));

type Stage = "early" | "mid" | "late";
function stageOf(persona: NagPersona, text: string): Stage | "ai" {
  const t = NAG_TEMPLATES[persona];
  const fits = (template: string) => {
    const [head, tail = ""] = template.split("{task}");
    return template.includes("{task}") ? text.startsWith(head) && text.endsWith(tail) && text.length > head.length + tail.length : text === template;
  };
  if (t.early.some(fits)) return "early";
  if ([...t.mid.gentle, ...t.mid.firm].some(fits)) return "mid";
  if ([...t.late.gentle, ...t.late.firm, ...t.late.relentless].some(fits)) return "late";
  return "ai";
}

// ---------------------------------------------------------------------------
// 1. Never the same nag twice in a day
// ---------------------------------------------------------------------------

/**
 * A day played forward as the app does it: at each moment the nags that were
 * pending and whose time has come have gone off (with the words that were
 * pending), the reminders are read from the record as it is (the sync can
 * run before the day is planned again), then the day is planned again if it
 * has to be and the reminders are read once more.
 */
function playDay(start: { salt: string; settings: NotificationConfig; ai: boolean }) {
  let settings = start.settings;
  let tasks = tasksOf(3);
  let record: NagDayRecord | null = null;
  let pending: ReminderPlan = [];
  const wentOff: string[] = [];
  const problems: string[] = [];

  const check = (now: Date, plan: ReminderPlan, when: string) => {
    const bodies = [...wentOff, ...plan.map((item) => item.body)];
    const twice = bodies.filter((body, index) => bodies.indexOf(body) !== index);
    if (twice.length > 0) problems.push(`${when} at ${now.getHours()}:${now.getMinutes()}: ${JSON.stringify(twice)}`);
    for (const item of plan) if (!item.body) problems.push(`${when}: an empty nag`);
  };

  const look = (now: Date, change: () => void = () => {}) => {
    for (const item of pending) if (item.fireAt.getTime() <= now.getTime()) wentOff.push(item.body);
    change();
    const context = { now, today: DAY, settings, permissionState: "granted" as const, tasks, plus: true };
    // The sync that beats the planning.
    pending = nagPlanFromRecord(record, context);
    check(now, pending, "before the day is planned again");
    const open = nagOpenTasks(tasks);
    if (open.length > 0 && (!record || nagDayNeedsPlan(record, { dayKey: DAY, settings, open }))) {
      record = planNagDay({ previous: record, now, dayKey: DAY, settings, open, salt: start.salt });
      if (start.ai && nagDayWantsAi(record, open, now)) {
        const asked: NagDayRecord = { ...record, aiCalls: record.aiCalls + 1, aiFor: nagAiKey(record.persona, record.level, open), aiFetchedAt: now.getTime() };
        const lines: NagLine[] = Array.from({ length: Math.max(4, asked.total) }, (_unused, index) => ({
          step: index + 1,
          taskIndex: index % open.length,
          text: `AI ${asked.aiCalls}.${index + 1} about ${open[index % open.length].text}`,
        }));
        record = applyAiNagLines(asked, lines, open, now);
      }
    }
    pending = nagPlanFromRecord(record, context);
    check(now, pending, "after");
  };
  return {
    look,
    set: (change: Partial<NotificationConfig>) => () => {
      settings = { ...settings, ...change };
    },
    tick: (id: string) => () => {
      tasks = tasks.map((task) => (task.id === id ? { ...task, done: true } : task));
    },
    end: () => {
      look(at(23, 30));
      return { wentOff, problems };
    },
  };
}

describe("no two nags of a day say the same thing", () => {
  const SEEDS = 60;

  it("property: another level mid-day and then a tick, for every voice, level and many days", () => {
    let nags = 0;
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        for (const next of NAG_LEVELS.filter((other) => other !== level)) {
          for (let seed = 0; seed < SEEDS; seed += 1) {
            for (const ai of [false, true]) {
              const day = playDay({ salt: `salt-${seed}`, settings: { ...NAG_ON, nagPersona: persona, nagLevel: level }, ai });
              day.look(at(8));
              day.look(at(12, 30), day.set({ nagLevel: next }));
              day.look(at(13, 5), day.tick("t0"));
              day.look(at(16, 40), day.tick("t1"));
              const { wentOff, problems } = day.end();
              expect(problems, `${persona} ${level} to ${next}, seed ${seed}, ai ${ai}`).toEqual([]);
              expect(new Set(wentOff).size).toBe(wentOff.length);
              expect(wentOff.length).toBeGreaterThan(0);
              nags += wentOff.length;
            }
          }
        }
      }
    }
    expect(nags).toBeGreaterThan(5_000);
  });

  it("property: names hidden, shown again and then a tick, for every voice, level and many days", () => {
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        for (let seed = 0; seed < SEEDS * 2; seed += 1) {
          for (const ai of [false, true]) {
            const day = playDay({ salt: `salt-${seed}`, settings: { ...NAG_ON, nagPersona: persona, nagLevel: level }, ai });
            day.look(at(8));
            day.look(at(11, 10), day.set({ hideTaskNames: true }));
            day.look(at(13, 40), day.set({ hideTaskNames: false }));
            day.look(at(14, 5), day.tick("t0"));
            day.look(at(17, 20), day.tick("t2"));
            const { wentOff, problems } = day.end();
            expect(problems, `${persona} ${level}, seed ${seed}, ai ${ai}`).toEqual([]);
            expect(new Set(wentOff).size).toBe(wentOff.length);
          }
        }
      }
    }
  });

  it("a line put in for a ticked task is never one another slot already has", () => {
    // Every slot but one says the general line the ticked slot would be given.
    for (const persona of NAG_PERSONAS) {
      for (let seed = 0; seed < 40; seed += 1) {
        const settings = { ...NAG_ON, nagPersona: persona };
        const tasks = tasksOf(2);
        const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: nagOpenTasks(tasks), salt: `s${seed}` });
        const [next] = nagOpenTasks(tasksOf(2, ["t0"]));
        const forNext = builtInNagLines({ persona, level: "firm", tasks: [next], count: planned.total, seed: `${DAY}|s${seed}` });
        // The record as a redraw can leave it: slot 2 names t0, slot 5 already says what slot 2 would be given.
        const own = lineForStep(forNext, 2, planned.total) as NagLine;
        const record: NagDayRecord = {
          ...planned,
          slots: planned.slots.map((slot) => (slot.step === 2 ? { ...slot, taskId: "t0" } : slot.step === 5 ? { ...slot, text: own.text, taskId: own.taskIndex === null ? null : "t1" } : slot)),
        };
        const plan = nagPlanFromRecord(record, { now: at(8), today: DAY, settings, permissionState: "granted", tasks: tasksOf(2, ["t0"]), plus: true });
        const bodies = plan.map((item) => item.body);
        expect(new Set(bodies).size, `${persona} ${seed}: ${JSON.stringify(bodies)}`).toBe(bodies.length);
        expect(bodies).toContain(own.text);
        // The same answer on every sync, and as the day's nags go off.
        expect(nagPlanFromRecord(record, { now: at(8), today: DAY, settings, permissionState: "granted", tasks: tasksOf(2, ["t0"]), plus: true })).toEqual(plan);
        const later = new Date(record.slots[2].fireAtMs + 1);
        const rest = nagPlanFromRecord(record, { now: later, today: DAY, settings, permissionState: "granted", tasks: tasksOf(2, ["t0"]), plus: true });
        expect(rest).toEqual(plan.filter((item) => item.fireAt.getTime() > later.getTime()));
      }
    }
  });

  it("when a step's line was said and nothing later is left, the nag has no line: an opening line never ends a day that got pushier", () => {
    for (const persona of NAG_PERSONAS) {
      for (let seed = 0; seed < 40; seed += 1) {
        const settings = { ...NAG_ON, nagPersona: persona, nagLevel: "relentless" as const };
        const tasks = tasksOf(1);
        const open = nagOpenTasks(tasks);
        const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open, salt: `s${seed}` });
        const lines = builtInNagLines({ persona, level: "relentless", tasks: open, count: planned.total, seed: `${DAY}|s${seed}` });
        // The last line of the day was already said by a nag that went off.
        const last = lines[lines.length - 1].text;
        const previous: NagDayRecord = { ...planned, slots: planned.slots.map((slot, index) => (index === 0 ? { ...slot, fireAtMs: at(7).getTime(), id: "daily-tasks:2026-10-12:nag:0700", text: last } : slot)) };
        const again = planNagDay({ previous, now: at(8), dayKey: DAY, settings: { ...settings, nagPersona: persona }, open: nagOpenTasks([...tasks, { id: "t9", text: "Glimber", done: false }]), salt: "unused" });
        const texts = again.slots.map((slot) => slot.text).filter(Boolean);
        expect(new Set(texts).size).toBe(texts.length);
        const final = again.slots[again.slots.length - 1];
        if (final.text) expect(stageOf(persona, final.text), final.text).toBe("late");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. A short day starts at the start
// ---------------------------------------------------------------------------

describe("a day with only one or two nags left", () => {
  const cases = NAG_PERSONAS.flatMap((persona) => NAG_LEVELS.map((level) => ({ persona, level })));

  it.each([
    ["19:30", at(19, 30), 1],
    ["18:30", at(18, 30), 2],
  ] as const)("Nag turned on at %s (window 9:00 to 21:00): the first nag is an opening line, built-in or the AI's, for every voice and level", (_name, now, count) => {
    for (const { persona, level } of cases) {
      for (let seed = 0; seed < 25; seed += 1) {
        for (const taskCount of [1, 2, 3]) {
          const settings = { ...NAG_ON, nagPersona: persona, nagLevel: level };
          const open = nagOpenTasks(tasksOf(taskCount));
          const record = planNagDay({ previous: null, now, dayKey: DAY, settings, open, salt: `s${seed}` });
          expect(record.slots).toHaveLength(count);
          expect(record.total).toBe(count);
          const said = record.slots.map((slot) => stageOf(persona, slot.text));
          expect(said[0], `${persona} ${level} ${seed}: ${record.slots[0].text}`).toBe("early");
          if (count === 2) expect(said[1], record.slots[1].text).toBe("late");
          expect(record.slots[0].text).not.toMatch(/more than once|lost count|STILL|Fourth quarter|Overtime|Double time/);

          // The AI is asked for four (the least it writes) and one or two are used: the first, and the last.
          const lines: NagLine[] = [1, 2, 3, 4].map((step) => ({ step, taskIndex: 0, text: `AI ${step}` }));
          const withAi = applyAiNagLines(record, lines, open, now);
          expect(withAi.slots.map((slot) => slot.text)).toEqual(count === 1 ? ["AI 1"] : ["AI 1", "AI 4"]);
        }
      }
    }
  });

  it("three nags: an opening, a middle and a closing line", () => {
    for (const { persona, level } of cases) {
      const open = nagOpenTasks(tasksOf(2));
      const record = planNagDay({ previous: null, now: at(17, 20), dayKey: DAY, settings: { ...NAG_ON, nagPersona: persona, nagLevel: level }, open, salt: "s" });
      expect(record.slots).toHaveLength(3);
      expect(record.slots.map((slot) => stageOf(persona, slot.text))).toEqual(["early", "mid", "late"]);
    }
  });

  it("a full day is unchanged: line n for nag n, ending on the level's hottest", () => {
    for (const { persona, level } of cases) {
      const open = nagOpenTasks(tasksOf(3));
      const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: { ...NAG_ON, nagPersona: persona, nagLevel: level }, open, salt: "s" });
      const lines = builtInNagLines({ persona, level, tasks: open, count: record.total, seed: `${DAY}|s` });
      expect(record.slots.map((slot) => slot.text)).toEqual(lines.map((line) => line.text));
    }
  });

  it("the three lines the review named read differently now", () => {
    const all = NAG_PERSONAS.flatMap((persona) => {
      const t = NAG_TEMPLATES[persona];
      return [...t.early, ...t.mid.gentle, ...t.mid.firm, ...t.late.gentle, ...t.late.firm, ...t.late.relentless];
    });
    for (const gone of ["I've lost count of my messages. Your list is still open.", "Hours later and {task} is STILL on my board.", "New day, fresh start. Pick one thing and go."]) {
      expect(all).not.toContain(gone);
    }
    expect(NAG_TEMPLATES.mom.late.relentless).toContain("I've lost count of my reminders. Your list is still open.");
    expect(NAG_TEMPLATES.drill.late.firm).toContain("{task} is STILL on my board, recruit. I checked.");
    expect(NAG_TEMPLATES.coach.early).toContain("Fresh start. Pick one thing and go.");
  });
});

// ---------------------------------------------------------------------------
// 3. Most built-in nags name a task
// ---------------------------------------------------------------------------

describe("with names shown, a built-in day names the tasks", () => {
  const SEEDS = 2_000;
  /** How many of a level's nags name a task: every stage's lines but one general line in a stage of two or more. */
  const NAMING: Record<NagLevel, number> = { gentle: 3, firm: 4, relentless: 8 };

  it("property (2,000 days per voice, level and 1 to 3 tasks): the full count, no line twice, at least half name a task, and every task is named", () => {
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        const count = NAG_LEVEL_COUNTS[level];
        for (const taskCount of [1, 2, 3]) {
          const tasks = tasksOf(taskCount);
          for (let seed = 0; seed < SEEDS; seed += 1) {
            const lines = builtInNagLines({ persona, level, tasks, count, seed: `2026-10-12|${seed}` });
            const where = `${persona} ${level} ${taskCount} tasks, seed ${seed}`;
            if (lines.length !== count) expect(lines, where).toHaveLength(count);
            if (new Set(lines.map((line) => line.text)).size !== count) throw new Error(`${where}: a line twice`);
            const naming = lines.filter((line) => line.taskIndex !== null);
            if (naming.length !== NAMING[level]) expect(naming.length, where).toBe(NAMING[level]);
            if (naming.length < (level === "gentle" ? 2 : count / 2)) throw new Error(`${where}: only ${naming.length} of ${count} name a task`);
            for (const line of naming) {
              if (!line.text.includes(nagTaskName(tasks[line.taskIndex as number].text))) throw new Error(`${where}: ${line.text}`);
            }
            if (count >= 2 * taskCount) {
              const named = new Set(naming.map((line) => line.taskIndex));
              if (named.size !== taskCount) throw new Error(`${where}: named ${[...named].join(",")}`);
            }
          }
        }
      }
    }
    expect(NAMING).toEqual({ gentle: 3, firm: 4, relentless: 8 });
  }, 60_000);

  it("a stage with two or more nags keeps exactly one general line; a stage with one names a task", () => {
    const stages: Record<NagLevel, number[]> = { gentle: [2, 1, 1], firm: [3, 2, 2], relentless: [4, 4, 3] };
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        for (let seed = 0; seed < 200; seed += 1) {
          const lines = builtInNagLines({ persona, level, tasks: tasksOf(2), count: NAG_LEVEL_COUNTS[level], seed });
          let from = 0;
          for (const size of stages[level]) {
            const general = lines.slice(from, from + size).filter((line) => line.taskIndex === null);
            expect(general.length, `${persona} ${level} ${seed}`).toBe(size >= 2 ? 1 : 0);
            from += size;
          }
          expect(lines.map((line) => stageOf(persona, line.text))).toEqual(stages[level].flatMap((size, index) => Array<Stage>(size).fill((["early", "mid", "late"] as const)[index])));
        }
      }
    }
  });

  it("names hidden: unchanged, the full count from general lines", () => {
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        for (let seed = 0; seed < 200; seed += 1) {
          const lines = builtInNagLines({ persona, level, tasks: [], count: NAG_LEVEL_COUNTS[level], seed });
          expect(lines).toHaveLength(NAG_LEVEL_COUNTS[level]);
          expect(lines.every((line) => line.taskIndex === null && !line.text.includes("{task}"))).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Calm, then Nag again the same day
// ---------------------------------------------------------------------------

describe("Calm leaves a stub of the day, and Nag again carries it on", () => {
  const settings = { ...NAG_ON, nagLevel: "relentless" as const };
  const open = nagOpenTasks(tasksOf(3));
  const withAi = (record: NagDayRecord, now: Date): NagDayRecord => {
    const asked = { ...record, aiCalls: record.aiCalls + 1, aiFor: nagAiKey(record.persona, record.level, open), aiFetchedAt: now.getTime() };
    return applyAiNagLines(asked, Array.from({ length: asked.total }, (_unused, index) => ({ step: index + 1, taskIndex: index % 3, text: `AI ${index + 1}: ${WORDS[index % 3]}` })), open, now);
  };

  it("the stub holds no task text, no line and no task id; it keeps the day, the salt, the zone, the AI count and the nags that went off", () => {
    const planned = withAi(planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open, salt: "salty" }), at(8));
    const now = at(14, 30);
    const stub = nagRecordStub(planned, now);
    const raw = JSON.stringify(stub);
    expect(raw).not.toMatch(/zorvex|plimth|quandle|brispo|fennock|wuxley|AI \d/i);
    expect(raw).not.toMatch(/"t[0-2]"/);
    expect(stub).toMatchObject({
      dayKey: DAY,
      salt: "salty",
      zone: planned.zone,
      aiCalls: 1,
      aiFor: planned.aiFor,
      aiFetchedAt: planned.aiFetchedAt,
      lines: [],
      lineTasks: [],
      tasksKey: "",
      source: "local",
    });
    const wentOff = planned.slots.filter((slot) => slot.fireAtMs <= now.getTime());
    expect(wentOff.length).toBeGreaterThan(0);
    expect(stub.slots).toEqual(wentOff.map(({ id, fireAtMs, step }) => ({ id, fireAtMs, step, text: "", taskId: null })));
    expect(isNagRecordStub(stub, now)).toBe(true);
    expect(isNagRecordStub(planned, now)).toBe(false);
    // It survives a save and a load as it is.
    expect(normalizeNagRecord(JSON.parse(raw))).toEqual(stub);
    // With Nag back on, nothing is pending from it until the day is planned again, and it does need planning.
    expect(nagPlanFromRecord(stub, { now, today: DAY, settings, permissionState: "granted", tasks: tasksOf(3), plus: true })).toEqual([]);
    expect(nagDayNeedsPlan(stub, { dayKey: DAY, settings, open })).toBe(true);
  });

  it("a nag at 14:55, Calm, Nag again at 15:00: the next nag is no earlier than 15:55", () => {
    for (const level of NAG_LEVELS) {
      for (let seed = 0; seed < 50; seed += 1) {
        const levelSettings = { ...NAG_ON, nagLevel: level };
        const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: levelSettings, open, salt: `s${seed}` });
        // One nag went off at 14:55.
        const record: NagDayRecord = { ...planned, total: 1, slots: [{ ...planned.slots[0], id: `daily-tasks:${DAY}:nag:1455`, fireAtMs: at(14, 55).getTime(), step: 1 }] };
        const stub = nagRecordStub(record, at(15));
        const again = planNagDay({ previous: stub, now: at(15), dayKey: DAY, settings: levelSettings, open, salt: "another" });
        const next = again.slots.filter((slot) => slot.fireAtMs > at(15).getTime());
        expect(next.length).toBeGreaterThan(0);
        expect(next[0].fireAtMs).toBeGreaterThanOrEqual(at(15, 55).getTime());
        // The day's count is the level's, less the one that went off.
        expect(again.slots.length).toBeLessThanOrEqual(NAG_LEVEL_COUNTS[level]);
        expect(again.salt).toBe(`s${seed}`);
        expect(again.slots[0]).toMatchObject({ fireAtMs: at(14, 55).getTime(), text: "" });
        expect(next.map((slot) => slot.step)).toEqual(next.map((_slot, index) => index + 2));
      }
    }
  });

  it("Calm and Nag over and over through a Relentless day: never more than 11 nags in all, an hour apart, and the AI isn't asked a third time", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const window = { startMinutes: 0, endMinutes: 1439 };
      const daySettings = { ...settings, nagWindow: window };
      let record = withAi(planNagDay({ previous: null, now: at(0, 5), dayKey: DAY, settings: daySettings, open, salt: `s${seed}` }), at(0, 5));
      let asked = 1;
      for (let turn = 0; turn < 12; turn += 1) {
        const calmAt = at(1 + turn * 2, (seed * 7) % 60);
        const nagAt = new Date(calmAt.getTime() + 5 * 60_000);
        record = nagRecordStub(record, calmAt);
        expect(JSON.stringify(record)).not.toMatch(/zorvex|quandle|fennock|AI \d/i);
        // A task reworded while in Calm, on some turns: a reason to ask the AI again.
        const nowOpen = turn % 3 === 1 ? nagOpenTasks([...tasksOf(2), { id: "t2", text: `Glimber ${turn}`, done: false }]) : open;
        record = planNagDay({ previous: record, now: nagAt, dayKey: DAY, settings: daySettings, open: nowOpen, salt: "another" });
        if (nagDayWantsAi(record, nowOpen, nagAt)) {
          asked += 1;
          record = { ...record, aiCalls: record.aiCalls + 1, aiFor: nagAiKey(record.persona, record.level, nowOpen), aiFetchedAt: nagAt.getTime() };
        }
        expect(record.slots.length, `seed ${seed}, turn ${turn}`).toBeLessThanOrEqual(11);
        const times = record.slots.map((slot) => slot.fireAtMs);
        for (let index = 1; index < times.length; index += 1) expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(HOUR);
        expect(new Set(record.slots.map((slot) => slot.id)).size).toBe(record.slots.length);
      }
      expect(asked).toBeLessThanOrEqual(MAX_NAG_AI_CALLS_PER_DAY);
      expect(record.aiCalls).toBeLessThanOrEqual(MAX_NAG_AI_CALLS_PER_DAY);
    }
  });

  it("a stub of yesterday: today is a new day, an hour or more after yesterday's last nag, with the same salt", () => {
    const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open, salt: "salty" });
    const stub = nagRecordStub(planned, nagMinuteAt("2026-10-13", 5));
    expect(stub.slots).toHaveLength(planned.slots.length);
    const tuesday = planNagDay({ previous: stub, now: nagMinuteAt("2026-10-13", 5), dayKey: "2026-10-13", settings, open, salt: "another" });
    expect(tuesday).toMatchObject({ dayKey: "2026-10-13", salt: "salty", aiCalls: 0, aiFor: null });
    expect(tuesday.slots.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The sanitiser and the task's name
// ---------------------------------------------------------------------------

describe("the proxy's sanitiser, second pass", () => {
  const keep = (text: string, ownTexts: string[] = []) => expect(server.cleanNagLine(text, { persona: "mom", ownTexts }), text).toBe(text);
  const drop = (text: string, ownTexts: string[] = []) => expect(server.cleanNagLine(text, { persona: "mom", ownTexts }), text).toBe("");

  it("'yourself' and 'nobody' are ordinary words; harm said to the person is still dropped", () => {
    for (const text of ["Do yourself a favor and tick one.", "Be kind to yourself. Then tick one.", "Do the list yourself, sweetheart.", "Nobody ticks a list like you do."]) {
      keep(text);
      expect(server.hitsNagBlocklist(text)).toBe(false);
    }
    for (const text of ["Don't hurt yourself over the list.", "Go kill yourself, says the list.", "Go hang yourself, says the list.", "I hate yourself and the list.", "You could end yourself over this list."]) {
      drop(text);
      expect(server.hitsNagBlocklist(text)).toBe(true);
    }
    // Not unlocked by a task that has the word.
    drop("Go hurt yourself.", ["Treat yourself", "Hurt locker rewatch"]);
  });

  it.each(server.NAG_CLOCK_WORDS as string[])("a line from the model with '%s' is dropped: the app picks the time", (word) => {
    drop(`Good ${word} to you. The list is still open.`);
    drop(`${word[0].toUpperCase()}${word.slice(1)}s are for lists, sweetheart.`);
    expect(server.hasNagClockWord(`It is ${word.toUpperCase()}. Tick one.`)).toBe(true);
  });

  it("the clock words are whole words, and the task's own words don't count", () => {
    expect(server.NAG_CLOCK_WORDS).toEqual(["morning", "afternoon", "evening", "tonight", "noon", "midnight", "breakfast", "lunch", "dinner", "bedtime"]);
    for (const text of ["Evenings out the score: one tick.", "A luncheon of ticks, please.", "No one is mourning the list.", "Afternoonish, the list said nothing."]) {
      if (/evenings/i.test(text)) drop(text);
      else keep(text);
    }
    keep("Did “Book dinner with Sam” happen yet? Only asking.", ["Book dinner with Sam"]);
    keep("Dinner is on your list, sweetheart.", ["Book dinner with Sam"]);
    drop("Dinner is on your list, sweetheart.", ["Call the dentist"]);
    drop("Tick it before bedtime.", ["Book dinner with Sam"]);
    const result = server.sanitizeNagLines(
      {
        lines: [
          { step: 1, taskIndex: 0, text: "Just checking on the dentist." },
          { step: 2, taskIndex: null, text: "Good morning! The list is waiting." },
          { step: 3, taskIndex: 0, text: "The dentist again. Only asking." },
          { step: 4, taskIndex: null, text: "Still open tonight, I see." },
          { step: 5, taskIndex: null, text: "One tick would be lovely." },
        ],
      },
      { persona: "mom", level: "firm", tasks: [{ text: "Call the dentist" }], count: 7 },
    );
    expect(result.lines.map((line: NagLine) => line.text)).toEqual(["Just checking on the dentist.", "The dentist again. Only asking.", "One tick would be lovely."]);
    expect(result.lines.map((line: NagLine) => line.step)).toEqual([1, 2, 3]);
  });

  it("the prompt names the same words", () => {
    for (const word of server.NAG_CLOCK_WORDS as string[]) expect(server.NAG_SYSTEM_PROMPT).toContain(word);
  });

  it("every built-in line still passes, with a task named", () => {
    for (const persona of NAG_PERSONAS) {
      const t = NAG_TEMPLATES[persona];
      for (const template of [...t.early, ...t.mid.gentle, ...t.mid.firm, ...t.late.gentle, ...t.late.firm, ...t.late.relentless]) {
        const text = template.replace("{task}", () => nagTaskName("Zorvex the plimth"));
        expect(server.cleanNagLine(text, { persona, ownTexts: ["Zorvex the plimth"] }), text).toBe(text);
        expect(Array.from(template.replace("{task}", () => nagTaskName("W".repeat(60)))).length).toBeLessThanOrEqual(110);
      }
    }
  });
});

describe("the joiners Persian and the Indic scripts are written with", () => {
  const ZWNJ = String.fromCharCode(0x200c);
  const ZWJ = String.fromCharCode(0x200d);
  const ZWSP = String.fromCharCode(0x200b);
  // "I want" in Persian, written with a zero-width non-joiner; a Devanagari conjunct held open with a joiner.
  const persian = `${String.fromCharCode(0x0645, 0x06cc)}${ZWNJ}${String.fromCharCode(0x062e, 0x0648, 0x0627, 0x0647, 0x0645)}`;
  const devanagari = `${String.fromCharCode(0x0915, 0x094d)}${ZWJ}${String.fromCharCode(0x0937)}`;

  it("the proxy keeps them in a line that is shown, between two letters of such a script, and nowhere else", () => {
    expect(server.cleanNagLine(`${persian} one tick.`, { persona: "mom" })).toBe(`${persian} one tick.`);
    expect(server.cleanNagLine(`${devanagari} one tick.`, { persona: "mom" })).toBe(`${devanagari} one tick.`);
    expect(server.cleanNagLine(`One${ZWNJ} ti${ZWJ}ck${ZWSP}, please.${ZWNJ}`, { persona: "mom" })).toBe("One tick, please.");
    // The user's own text too: it goes into the prompt as typed.
    expect(server.oneLine(`${persian} ${devanagari} a${ZWNJ}b${ZWSP}c`)).toBe(`${persian} ${devanagari} abc`);
  });

  it("the checks read a copy without them: a joiner hides nothing", () => {
    expect(server.foldForMatch(`${persian} st${ZWNJ}up${ZWJ}id`)).not.toMatch(new RegExp(`[${ZWNJ}${ZWJ}]`));
    expect(server.cleanNagLine(`What a st${ZWNJ}upid list.`, { persona: "mom" })).toBe("");
    expect(server.cleanNagLine(`Visit ex${ZWJ}ample.com for the list.`, { persona: "mom" })).toBe("");
    expect(server.hitsNagBlocklist(`I will k${ZWJ}ill you.`)).toBe(true);
    // The same line twice, once with a joiner: one is kept.
    const twice = server.sanitizeNagLines(
      { lines: [1, 2, 3, 4].map((step) => ({ step, taskIndex: null, text: step === 2 ? `${persian} tick` : step === 3 ? `${persian.replace(ZWNJ, "")} tick` : `Line ${step}, sweetheart.` })) },
      { persona: "mom", level: "firm", tasks: [{ text: "Call the dentist" }], count: 7 },
    );
    expect(twice.lines).toHaveLength(3);
  });

  it("the app does the same: lines from the proxy and a task's name keep them, stray ones go", () => {
    const parsed = parseNagResponse(
      {
        lines: [
          { step: 1, taskIndex: null, text: `${persian} one tick.` },
          { step: 2, taskIndex: null, text: `${devanagari} one tick.` },
          { step: 3, taskIndex: null, text: `One${ZWNJ} ti${ZWJ}ck${ZWSP}, please.` },
          { step: 4, taskIndex: null, text: `See ht${ZWNJ}tps://example.test for the list.` },
          { step: 5, taskIndex: null, text: `${persian.replace(ZWNJ, "")} one tick.` },
        ],
      },
      { taskCount: 1, count: 7 },
    );
    expect(parsed.map((line) => line.text)).toEqual([`${persian} one tick.`, `${devanagari} one tick.`, "One tick, please."]);
    expect(nagTaskName(`${persian} a${ZWNJ}b`)).toBe(`“${persian} ab”`);
    // A joiner inside an emoji stays, as before.
    const family = `${String.fromCodePoint(0x1f468)}${ZWJ}${String.fromCodePoint(0x1f469)}`;
    expect(nagTaskName(`Call ${family}`)).toBe(`“Call ${family}”`);
    const lines = builtInNagLines({ persona: "mom", level: "firm", tasks: [{ text: persian }], count: 7, seed: 1 });
    expect(lines.some((line) => line.text.includes(persian))).toBe(true);
  });
});

describe("a task's name that ends in an initial", () => {
  it("keeps the initial's full stop; other punctuation at the end still comes off", () => {
    expect(nagTaskName("Email J.R.")).toBe("“Email J.R.”");
    expect(nagTaskName("Call Dr. J.")).toBe("“Call Dr. J.”");
    expect(nagTaskName("Lunch with A. B.  ")).toBe("“Lunch with A. B.”");
    expect(nagTaskName("Fix the bike!")).toBe("“Fix the bike”");
    expect(nagTaskName("Finish the report.")).toBe("“Finish the report”");
    expect(nagTaskName("Why is the sink leaking?")).toBe("“Why is the sink leaking”");
    expect(nagTaskName("Email J.R.!")).toBe("“Email J.R”");
    expect(nagTaskName("Wait...")).toBe("“Wait”");
  });

  it("a built-in line with such a name passes the proxy's sanitiser and stays within 110 characters", () => {
    for (const persona of NAG_PERSONAS) {
      const lines = builtInNagLines({ persona, level: "relentless", tasks: [{ text: "Email J.R." }], count: 11, seed: 3 });
      for (const line of lines) {
        expect(server.cleanNagLine(line.text, { persona, ownTexts: ["Email J.R."] }), line.text).toBe(line.text);
        expect(Array.from(line.text).length).toBeLessThanOrEqual(110);
      }
      expect(lines.some((line) => line.text.includes("“Email J.R.”"))).toBe(true);
    }
  });
});
