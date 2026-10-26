// 1.6 G, the owner's report: a nag must never name a task that isn't the one
// it is about. This file lives the whole class of edits (reorder, text edit,
// words swapped, Swap in, Not today, tick) against both a built-in day and a
// day of AI lines, with the stale record still in place (before the replan)
// and after it; checks that the proxy and the phone agree on every line they
// are asked about; and that a record saved before 1.6 is planned again once.
// Local-time fixtures: passes under any TZ.

import { describe, expect, it } from "vitest";

import * as server from "../server/providers/nag-contract.mjs";
import { NAG_LEVELS, NAG_PERSONAS, nagLineFitsTask, nagTaskName, parseNagResponse, type NagLevel, type NagPersona } from "../lib/daily-tasks/nag";
import {
  applyAiNagLines,
  nagDayNeedsPlan,
  nagDayWantsAi,
  nagPlanFromRecord,
  nagRecordWithPlannedWords,
  nagTasksChanged,
  nagTasksKey,
  planNagDay,
  type NagDayRecord,
  type NagPlanContext,
} from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";

const DAY = "2026-10-12";
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);

// Made-up words that appear in no built-in line, so a body that holds one is naming that task.
const POOL = ["Zorvex the plimth", "Quandle a brispo", "Fennock wuxley", "Drambo the kleptu", "Snorble a gweft", "Plonk the trivvle", "Wibble a harnstock", "Yarrow the flonk"];
type Task = { id: string; text: string; done: boolean };

function settingsFor(persona: NagPersona, level: NagLevel, extra: Partial<NotificationConfig> = {}): NotificationConfig {
  return { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagPersona: persona, nagLevel: level, nagWindow: { startMinutes: 8 * 60, endMinutes: 22 * 60 }, ...extra };
}
const openOf = (tasks: Task[]) => tasks.filter((task) => !task.done).map(({ id, text }) => ({ id, text }));
const ctx = (settings: NotificationConfig, tasks: Task[], now: Date): NagPlanContext => ({ now, today: DAY, settings, permissionState: "granted", tasks, plus: true });

/** A tiny seeded generator, so a failing sequence is the same sequence next time. */
function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Every nag that goes out is about a task that is open now and names it with
 * its words as they are now, or is about no task and names none of the words
 * any task has had.
 */
function expectNagsFit(items: ReturnType<typeof nagPlanFromRecord>, tasks: Task[], label: string) {
  const open = tasks.filter((task) => !task.done);
  for (const item of items) {
    const body = item.body.toLowerCase();
    const taskId = item.data?.taskId as string | undefined;
    const own = taskId === undefined ? undefined : open.find((task) => task.id === taskId);
    if (taskId !== undefined) {
      expect(own, `${label}: "${item.body}" is for ${taskId}, which isn't open`).toBeTruthy();
      expect(item.body.includes(nagTaskName(own!.text)), `${label}: "${item.body}" doesn't name "${own!.text}"`).toBe(true);
    }
    for (const phrase of POOL) {
      const named = body.includes(phrase.toLowerCase());
      const isOwn = own !== undefined && own.text.toLowerCase() === phrase.toLowerCase();
      expect(named, `${label}: "${item.body}" names "${phrase}"${isOwn ? "" : ` but is for ${taskId === undefined ? "no task" : own?.text}`}`).toBe(isOwn);
    }
  }
}

type Edit = "reorder" | "edit" | "swapWords" | "swapIn" | "notToday" | "tick" | "untick";

function applyEdit(tasks: Task[], edit: Edit, random: () => number, nextId: () => string): Task[] {
  const used = new Set(tasks.map((task) => task.text));
  const freshText = () => POOL.filter((text) => !used.has(text))[Math.floor(random() * Math.max(1, POOL.filter((text) => !used.has(text)).length))] ?? "Yarrow the flonk";
  const pick = () => Math.floor(random() * tasks.length);
  const list = tasks.map((task) => ({ ...task }));
  switch (edit) {
    case "reorder":
      return list.sort(() => random() - 0.5);
    case "edit": {
      const task = list[pick()];
      task.text = freshText();
      return list;
    }
    case "swapWords": {
      const a = pick();
      const b = (a + 1 + Math.floor(random() * (list.length - 1))) % list.length;
      [list[a].text, list[b].text] = [list[b].text, list[a].text];
      return list;
    }
    case "swapIn": {
      // Swap in: the task goes, another comes, sometimes with the words of the one that went (or one the day has).
      const at = pick();
      const gone = list[at];
      const words = random() < 0.5 ? gone.text : random() < 0.5 ? list[(at + 1) % list.length].text : freshText();
      list.splice(at, 1, { id: nextId(), text: words, done: false });
      return list;
    }
    case "notToday":
    {
      const gone = pick();
      return list.length > 1 ? list.filter((_task, index) => index !== gone) : list;
    }
    case "tick": {
      const task = list[pick()];
      task.done = true;
      return list;
    }
    case "untick":
      list.forEach((task) => (task.done = false));
      return list;
  }
}
const EDITS: Edit[] = ["reorder", "edit", "swapWords", "swapIn", "notToday", "tick", "untick"];

describe("a nag never names a task that isn't the one it is about, through any edit", () => {
  const START: Task[] = [
    { id: "t0", text: POOL[0], done: false },
    { id: "t1", text: POOL[1], done: false },
    { id: "t2", text: POOL[2], done: false },
  ];
  const aiLines = (tasks: Task[]) => [
    ...tasks.map((task, index) => ({ step: index * 3 + 1, taskIndex: index, text: `AI: ${nagTaskName(task.text)}, please.` })),
    ...tasks.map((task, index) => ({ step: index * 3 + 2, taskIndex: index, text: `More AI on ${nagTaskName(task.text)} now.` })),
    ...Array.from({ length: 6 }, (_unused, index) => ({ step: index * 2 + 3, taskIndex: null, text: `AI general ${index}: the list waits.` })),
  ];

  it.each([false, true])("random sequences of edits, with the day's record as it was (not yet planned again) and after the replan (AI lines: %s)", (withAi) => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const random = rng(seed * 7919);
      const persona = NAG_PERSONAS[seed % NAG_PERSONAS.length];
      const level = NAG_LEVELS[seed % NAG_LEVELS.length];
      const settings = settingsFor(persona, level);
      let tasks = START.map((task) => ({ ...task }));
      let record: NagDayRecord = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt: `w${seed}` });
      if (withAi) record = applyAiNagLines(record, aiLines(tasks), openOf(tasks), at(8));
      let counter = 100;
      const steps = 1 + Math.floor(random() * 4);
      const trail: string[] = [];
      for (let step = 0; step < steps; step += 1) {
        const edit = EDITS[Math.floor(random() * EDITS.length)];
        tasks = applyEdit(tasks, edit, random, () => `n${counter++}`);
        trail.push(edit);
        const label = `${withAi ? "ai" : "built-in"} seed ${seed} ${persona}/${level} after ${trail.join(" > ")}`;
        const now = at(8, 1 + step);
        // Between the edit and the replan: the record is the old one.
        expectNagsFit(nagPlanFromRecord(record, ctx(settings, tasks, now)), tasks, `${label} (stale)`);
        // The write-back of the words it put in changes nothing that goes out.
        const noted = nagRecordWithPlannedWords(record, ctx(settings, tasks, now));
        if (noted) expectNagsFit(nagPlanFromRecord(noted, ctx(settings, tasks, now)), tasks, `${label} (noted)`);
        // The replan (as ensureNagDay does when the tasks changed), AI lines kept only where they still fit.
        if (tasks.some((task) => !task.done) && nagDayNeedsPlan(record, { dayKey: DAY, settings, open: openOf(tasks) })) {
          record = planNagDay({ previous: record, now, dayKey: DAY, settings, open: openOf(tasks), salt: `w${seed}` });
          expectNagsFit(nagPlanFromRecord(record, ctx(settings, tasks, now)), tasks, `${label} (replanned)`);
        }
      }
    }
  });

  it("a reorder, a tick, a Not today and an undone tick plan nothing again; an edit, a swap of words and a Swap in do", () => {
    const settings = settingsFor("mom", "firm");
    const record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(START), salt: "need" });
    const needs = (tasks: Task[]) => nagDayNeedsPlan(record, { dayKey: DAY, settings, open: openOf(tasks) });
    expect(needs([START[2], START[0], START[1]])).toBe(false);
    expect(needs([{ ...START[0], done: true }, START[1], START[2]])).toBe(false);
    expect(needs([START[1], START[2]])).toBe(false);
    expect(needs([{ ...START[0], text: POOL[3] }, START[1], START[2]])).toBe(true);
    expect(needs([{ ...START[0], text: START[1].text }, { ...START[1], text: START[0].text }, START[2]])).toBe(true);
    expect(needs([{ id: "n1", text: START[0].text, done: false }, START[1], START[2]])).toBe(true);
    // A tiny edit (a typo fixed) is an edit.
    expect(needs([{ ...START[0], text: `${START[0].text}s` }, START[1], START[2]])).toBe(true);
  });

  it("the key holds no words and no task id in the clear", () => {
    const key = nagTasksKey(openOf(START));
    for (const task of START) {
      expect(key).not.toContain(task.id === "t0" ? "plimth" : task.text.split(" ")[0].toLowerCase());
    }
  });

  it("with names hidden, no line holds a task's words after any edit", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const random = rng(seed * 104729);
      const settings = settingsFor("drill", "relentless", { hideTaskNames: true });
      let tasks = START.map((task) => ({ ...task }));
      const record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt: `h${seed}` });
      tasks = applyEdit(tasks, EDITS[Math.floor(random() * EDITS.length)], random, () => "nx");
      for (const item of nagPlanFromRecord(record, ctx(settings, tasks, at(8, 2)))) {
        for (const phrase of POOL) expect(item.body.toLowerCase()).not.toContain(phrase.toLowerCase());
        expect(item.data).not.toHaveProperty("taskId");
      }
    }
  });
});

describe("a record saved before 1.6 is planned again once", () => {
  // The 1.5 key: a hash of each task's words alone (nag-plan's textKey).
  const oldKey = (texts: string[]) =>
    [
      ...new Set(
        texts.map((text) => {
          const clean = text.trim().toLowerCase().replace(/\s+/g, " ");
          let hash = 2166136261;
          for (let index = 0; index < clean.length; index += 1) hash = Math.imul(hash ^ clean.charCodeAt(index), 16777619) >>> 0;
          return hash.toString(36);
        }),
      ),
    ]
      .sort()
      .join(",");
  const tasks: Task[] = [
    { id: "t0", text: POOL[0], done: false },
    { id: "t1", text: POOL[1], done: false },
    { id: "t2", text: POOL[2], done: false },
  ];
  const settings = settingsFor("mom", "firm");

  it("the 1.5 key makes the day need a plan, the new one does not, and the plan does not need another", () => {
    const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt: "old" });
    const legacy: NagDayRecord = { ...planned, tasksKey: oldKey(tasks.map((task) => task.text)) };
    expect(nagDayNeedsPlan(legacy, { dayKey: DAY, settings, open: openOf(tasks) })).toBe(true);
    const again = planNagDay({ previous: legacy, now: at(8, 30), dayKey: DAY, settings, open: openOf(tasks), salt: "old" });
    expect(nagDayNeedsPlan(again, { dayKey: DAY, settings, open: openOf(tasks) })).toBe(false);
    expect(nagTasksChanged(again.tasksKey, openOf(tasks))).toBe(false);
    // Nags that already went off are kept as they were.
    const gone = planned.slots.filter((slot) => slot.fireAtMs <= at(12).getTime());
    const later = planNagDay({ previous: { ...legacy }, now: at(12), dayKey: DAY, settings, open: openOf(tasks), salt: "old" });
    expect(later.slots.slice(0, gone.length)).toEqual(gone);
  });

  it("until it is, no nag goes out about a task with another's words", () => {
    const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt: "old2" });
    const legacy: NagDayRecord = { ...planned, tasksKey: oldKey(tasks.map((task) => task.text)) };
    expectNagsFit(nagPlanFromRecord(legacy, ctx(settings, tasks, at(8, 5))), tasks, "legacy");
  });

  it("the AI asked about the old key is asked again once when the day is planned again, and not past the daily two", () => {
    const planned = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt: "old3" });
    const legacyAi: NagDayRecord = { ...planned, aiCalls: 1, aiFor: `mom|firm|${oldKey(tasks.map((task) => task.text))}` };
    expect(nagDayWantsAi(legacyAi, openOf(tasks), at(8, 5))).toBe(true);
    expect(nagDayWantsAi({ ...legacyAi, aiCalls: 2 }, openOf(tasks), at(8, 5))).toBe(false);
    const asked: NagDayRecord = { ...legacyAi, aiCalls: 2, aiFor: `mom|firm|${nagTasksKey(openOf(tasks))}` };
    expect(nagDayWantsAi({ ...asked, aiCalls: 1 }, openOf(tasks), at(8, 5))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The proxy and the phone drop the same lines
// ---------------------------------------------------------------------------

describe("the proxy and the phone agree on every line they are asked about", () => {
  const TASK_SETS: string[][] = [
    ["Call the dentist", "Reply to Sam", "Write up the notes from the planning meeting for everyone"],
    ["Zorvex the plimth", "Zorvex the plimth report", "Taxes"],
    ["Café résumé", "Naïve Zoë’s thing", "Pay rent \u{1F3E0}"],
    ["Run 5k", "Do", "Email J.R."],
    ["\u{1F3C3}\u{1F3FD} Run", "Walk the dog!", "Wibble a harnstock..."],
    ["Pneumonoultramicroscopicsilicovolcanoconiosis and then some more words to make it long", "Sam", "Plonk"],
  ];
  const Q = (value: string) => `“${value}”`;
  const lineTemplates = (tasks: string[]): string[] => {
    const out: string[] = ["The list is still open.", "Nothing to see here.", "Time to start. Anything."];
    for (const task of tasks) {
      const lower = task.toLowerCase();
      const upper = task.toUpperCase();
      const words = task.split(" ");
      const prefix = words.slice(0, Math.max(2, Math.ceil(words.length / 2))).join(" ");
      out.push(
        `${Q(task)}. Still open.`,
        `"${task}" still open.`,
        `${Q(lower)} is waiting.`,
        `${Q(upper)} is waiting.`,
        `${Q(task.replace(/[.!?]+$/, ""))} please`,
        `${Q(`${task}.`)} please`,
        `${Q(`${prefix}…`)} please`,
        `${Q(`${prefix}...`)} please`,
        `${Q(prefix)} please`,
        `${Q(words.slice(0, 1).join(" "))} please`,
        `Do ${task} now.`,
        `Do ${lower} now.`,
        `Do ${task}x now.`,
        `Do x${task} now.`,
        `${task}, ${task}!`,
        `The ${words[0].toLowerCase()} thing`,
        `${Q("Something else entirely")} then.`,
        `A ${Q(task)} and a ${Q("nothing")}.`,
        `${Q(task.normalize("NFD"))} still`,
        `${Q(task.replace(/’/g, "'"))} still`,
        `${Q(task.replace(/'/g, "’"))} still`,
        `${Q(`​${task}`)} zero width`,
      );
    }
    for (const a of tasks) for (const b of tasks) if (a !== b) out.push(`${Q(a)} before ${Q(b)}.`, `${Q(a)}, then ${b}.`, `${b}? ${Q(a)}.`);
    return out;
  };

  it("nagLineFitsTask: the same answer for every line, task index and task set", () => {
    let compared = 0;
    for (const tasks of TASK_SETS) {
      for (const text of lineTemplates(tasks)) {
        for (const index of [null, ...tasks.map((_task, i) => i), 7]) {
          const phone = nagLineFitsTask(text, index, tasks);
          const proxy = server.nagLineFitsTask(text, index, tasks);
          expect(proxy, `${JSON.stringify(text)} for ${String(index)} in ${JSON.stringify(tasks)}`).toBe(phone);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(1500);
  });

  it("a line for a task is kept only when it names that task, and never when it also names another (both sides)", () => {
    for (const tasks of TASK_SETS) {
      tasks.forEach((task, index) => {
        const quoted = `${Q(task)}. Still open.`;
        // Quoting the first task of a set whose first task contains the others' words is the known overlap; skip tasks that hold another's words.
        const overlaps = tasks.some((other, i) => i !== index && task.toLowerCase().includes(other.toLowerCase()));
        if (!overlaps && server.nagLineFitsTask(quoted, index, tasks)) {
          expect(nagLineFitsTask(quoted, index, tasks)).toBe(true);
        }
        tasks.forEach((other, otherIndex) => {
          if (otherIndex === index) return;
          if (task.toLowerCase().includes(other.toLowerCase()) || other.toLowerCase().includes(task.toLowerCase())) return;
          // A line quoting another task never fits this one, on either side.
          expect(nagLineFitsTask(`${Q(other)}. Still open.`, index, tasks), `${other} as ${task}`).toBe(false);
          expect(server.nagLineFitsTask(`${Q(other)}. Still open.`, index, tasks), `${other} as ${task}`).toBe(false);
        });
      });
    }
  });

  it("an answer is filtered the same on both sides, line by line", () => {
    const tasks = TASK_SETS[0];
    const lines = lineTemplates(tasks).flatMap((text, i) => [null, 0, 1, 2].map((taskIndex, j) => ({ step: i * 4 + j + 1, taskIndex, text })));
    const proxyKept = server
      .sanitizeNagLines({ lines }, { persona: "mom", level: "firm", tasks: tasks.map((text) => ({ text })), count: 16 })
      .lines.map((line: { text: string; taskIndex: number | null }) => `${line.taskIndex}|${line.text}`);
    const phoneKept = lines.filter((line) => nagLineFitsTask(line.text, line.taskIndex, tasks)).map((line) => `${line.taskIndex}|${line.text}`);
    // The proxy cleans a line first (its cap, blocklists), so it keeps no more than the task check alone would.
    for (const kept of proxyKept) expect(phoneKept, kept).toContain(kept);
    const parsed = parseNagResponse({ lines }, { taskCount: 3, count: 16, ownTexts: tasks }).map((line) => `${line.taskIndex}|${line.text}`);
    for (const kept of parsed) expect(phoneKept).toContain(kept);
    expect(parsed.length).toBeGreaterThan(0);
  });
});
