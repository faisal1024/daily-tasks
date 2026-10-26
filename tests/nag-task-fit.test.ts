// 1.6 G: "Make the nag alerts take into account the actual task." A nag about a
// task names that task as it is now, and only that one: the record's tasks
// key binds each task's words to its id, a slot whose task was edited since
// is stale until the day is planned again, AI lines must quote (or have the
// whole words of) the task they are attached to, and the built-in lines read
// right with any short task.

import { describe, expect, it } from "vitest";

import * as server from "../server/providers/nag-contract.mjs";
import { NAG_PERSONAS, NAG_TEMPLATES, nagLineFitsTask, nagTaskName, parseNagResponse } from "../lib/daily-tasks/nag";
import {
  applyAiNagLines,
  nagDayNeedsPlan,
  nagPlanFromRecord,
  nagTasksChanged,
  nagTasksKey,
  planNagDay,
  type NagDayRecord,
  type NagPlanContext,
} from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";

const DAY = "2026-10-12";
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagLevel: "relentless" };
const TASKS = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
const open = (tasks: typeof TASKS) => tasks.filter((task) => !task.done).map(({ id, text }) => ({ id, text }));
const context = (tasks: typeof TASKS, overrides: Partial<NagPlanContext> = {}): NagPlanContext => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  tasks,
  plus: true,
  ...overrides,
});
const plan = (tasks: typeof TASKS = TASKS): NagDayRecord =>
  planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: NAG_ON, open: open(tasks), salt: "fit" });

/** Every nag about a task names that task's words as they are now, and no other task's. */
function expectEachNagFitsItsTask(items: ReturnType<typeof nagPlanFromRecord>, tasks: typeof TASKS) {
  for (const item of items) {
    const taskId = item.data?.taskId;
    for (const task of tasks) {
      const named = item.body.includes(nagTaskName(task.text));
      if (task.id === taskId) expect(named, `${item.body} (for ${task.text})`).toBe(true);
      else expect(named, `${item.body} names ${task.text}, but is for ${String(taskId)}`).toBe(false);
    }
  }
}

describe("the tasks key binds each task's words to the task", () => {
  it("a reorder, a tick or a removal is no change; an edit, a swap of words or a new task is", () => {
    const key = nagTasksKey(open(TASKS));
    expect(nagTasksChanged(key, open([TASKS[2], TASKS[0], TASKS[1]]))).toBe(false);
    expect(nagTasksChanged(key, open(TASKS.slice(1)))).toBe(false);
    expect(nagTasksChanged(key, [{ id: "t0", text: "Email the landlord" }])).toBe(true);
    // Two tasks swap their words: the same words, but not for the same tasks.
    expect(nagTasksChanged(key, [{ id: "t0", text: "Write the report" }, { id: "t1", text: "Call the dentist" }])).toBe(true);
    // Swapped in: another task (id) with words the day had.
    expect(nagTasksChanged(key, [{ id: "t9", text: "Walk the dog" }])).toBe(true);
    // A key saved before 1.6 (words only) knows no task: planned again once.
    expect(nagTasksChanged("abc,def", open(TASKS))).toBe(true);
    expect(key).not.toMatch(/dentist|report|dog/i);
  });
});

describe("a nag never names a task as it no longer is", () => {
  it("as planned, each nag names its own task", () => {
    expectEachNagFitsItsTask(nagPlanFromRecord(plan(), context(TASKS)), TASKS);
  });

  it("a reorder plans nothing again and changes no nag", () => {
    const record = plan();
    const reordered = [TASKS[2], TASKS[0], TASKS[1]];
    expect(nagDayNeedsPlan(record, { dayKey: DAY, settings: NAG_ON, open: open(reordered) })).toBe(false);
    expect(nagPlanFromRecord(record, context(reordered))).toEqual(nagPlanFromRecord(record, context(TASKS)));
  });

  it("an edited task: until the day is planned again, its nags name it with its new words, never the old ones", () => {
    const record = plan();
    const edited = TASKS.map((task) => (task.id === "t0" ? { ...task, text: "Email the landlord" } : task));
    expect(nagDayNeedsPlan(record, { dayKey: DAY, settings: NAG_ON, open: open(edited) })).toBe(true);
    const items = nagPlanFromRecord(record, context(edited));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.body).not.toMatch(/dentist/i);
    expectEachNagFitsItsTask(items, edited);
    // And once planned again, the same holds.
    const replanned = planNagDay({ previous: record, now: at(8, 5), dayKey: DAY, settings: NAG_ON, open: open(edited), salt: "fit" });
    expectEachNagFitsItsTask(nagPlanFromRecord(replanned, context(edited, { now: at(8, 5) })), edited);
  });

  it("two tasks that swap their words: no nag goes out about one with the other's words", () => {
    const record = plan();
    const swapped = TASKS.map((task) => (task.id === "t0" ? { ...task, text: "Write the report" } : task.id === "t1" ? { ...task, text: "Call the dentist" } : task));
    expectEachNagFitsItsTask(nagPlanFromRecord(record, context(swapped)), swapped);
  });

  it("swapped in (a new task with a removed one's words): the removed task's nags go to an open one, named as it is", () => {
    const record = plan();
    const swappedIn = [{ id: "t9", text: "Call the dentist", done: false }, TASKS[1], TASKS[2]];
    const items = nagPlanFromRecord(record, context(swappedIn));
    for (const item of items) expect(item.data?.taskId).not.toBe("t0");
    expectEachNagFitsItsTask(items, swappedIn);
  });

  it("the AI's lines are kept only for the same tasks with the same words: after a swap of words those two tasks' lines go", () => {
    const record = plan();
    const ai = applyAiNagLines(
      record,
      [
        { step: 1, taskIndex: 0, text: "AI: “Call the dentist”, please." },
        { step: 2, taskIndex: 1, text: "AI: “Write the report”, please." },
        { step: 3, taskIndex: 2, text: "AI: “Walk the dog”, please." },
        { step: 4, taskIndex: null, text: "AI: the list, please." },
      ],
      open(TASKS),
      at(8),
    );
    const sameTasks = planNagDay({ previous: { ...ai, aiFor: `mom|relentless|${nagTasksKey(open(TASKS))}` }, now: at(8, 1), dayKey: DAY, settings: { ...NAG_ON, nagWindow: NAG_ON.nagWindow }, open: open(TASKS), salt: "fit" });
    expect(sameTasks.source).toBe("ai");
    const swapped = TASKS.map((task) => (task.id === "t0" ? { ...task, text: "Write the report" } : task.id === "t1" ? { ...task, text: "Call the dentist" } : task));
    const after = planNagDay({ previous: { ...ai, aiFor: `mom|relentless|${nagTasksKey(open(TASKS))}` }, now: at(8, 1), dayKey: DAY, settings: NAG_ON, open: open(swapped), salt: "fit" });
    // 1.6 G review: one edit no longer drops every AI line. The swapped tasks'
    // lines go; the untouched task's line and the general one stay.
    expect(after.source).toBe("ai");
    const texts = after.slots.map((slot) => slot.text);
    expect(texts.some((text) => /dentist|report/i.test(text) && text.startsWith("AI:"))).toBe(false);
    expect(texts).toContain("AI: “Walk the dog”, please.");
    expect(texts).toContain("AI: the list, please.");
    expectEachNagFitsItsTask(nagPlanFromRecord(after, context(swapped, { now: at(8, 1) })), swapped);
    // Before it is planned again, the stale AI slots aren't said about the wrong task either.
    expectEachNagFitsItsTask(nagPlanFromRecord(ai, context(swapped)), swapped);
  });
});

describe("an AI line names the task it is for, and only that one (proxy and phone)", () => {
  const TASK_TEXTS = ["Call the dentist", "Reply to Sam", "Write up the notes from the planning meeting for everyone"];
  const CASES: [string, number | null, boolean][] = [
    ["“Call the dentist”. I'm only asking.", 0, true],
    ["\"call the DENTIST\" still open.", 0, true],
    ["Call the dentist. I'll wait.", 0, true],
    ["“Write up the notes from the planning…” please.", 2, true],
    ["“Write up the notes from the planning meeting for everyone”, champ.", 2, true],
    // A paraphrase, or no name at all.
    ["The dentist thing. Still waiting.", 0, false],
    ["Lace up. Time to go.", 0, false],
    // The quote is another task, or the line names another task too.
    ["“Reply to Sam”. I'm only asking.", 0, false],
    ["“Call the dentist”, then reply to Sam.", 0, false],
    // A quote that isn't the task at all.
    ["“Call the plumber”. Still open.", 0, false],
    // Too short a start of a long task.
    ["“Write up…” please.", 2, false],
    // A general line names no task.
    ["The list is still open.", null, true],
    ["“Reply to Sam” is still open.", null, false],
    ["Did you reply to Sam yet?", null, false],
  ];

  it.each(CASES)("%j for %s: %s", (text, taskIndex, fits) => {
    expect(nagLineFitsTask(text, taskIndex, TASK_TEXTS)).toBe(fits);
    expect(server.nagLineFitsTask(text, taskIndex, TASK_TEXTS)).toBe(fits);
  });

  it("the proxy drops mismatched lines from an answer, and the phone does too", () => {
    const payload = { persona: "mom", level: "firm", tasks: TASK_TEXTS.map((text) => ({ text })), count: 6 };
    const lines = CASES.map(([text, taskIndex], index) => ({ step: index + 1, taskIndex, text }));
    const expected = CASES.filter(([, , fits]) => fits).map(([text]) => text);
    expect(server.sanitizeNagLines({ lines }, { ...payload, count: 16 }).lines.map((line: { text: string }) => line.text)).toEqual(expected);
    expect(parseNagResponse({ lines }, { taskCount: 3, count: 16, ownTexts: TASK_TEXTS }).map((line) => line.text)).toEqual(expected);
  });

  it("the prompt asks for the task quoted exactly, fitted to its kind, and no plural for a general line", () => {
    expect(server.NAG_SYSTEM_PROMPT).toContain("quote the task's text exactly as written");
    expect(server.NAG_SYSTEM_PROMPT).toContain("Never imply it is a different kind of task");
    expect(server.NAG_SYSTEM_PROMPT).toContain("doesn't assume how many tasks are open");
  });
});

describe("the built-in lines read right with any short task", () => {
  const SAMPLES = ["Call the dentist", "Taxes", "20-minute easy run", "Reply to Sam", "Groceries", "Email J.R."];

  it("every {task} line names the task, quoted, and passes the task check on both sides", () => {
    for (const persona of NAG_PERSONAS) {
      const pools = NAG_TEMPLATES[persona];
      const templates = [...pools.early, ...pools.mid.gentle, ...pools.mid.firm, ...pools.late.gentle, ...pools.late.firm, ...pools.late.relentless];
      for (const template of templates.filter((line) => line.includes("{task}"))) {
        for (const task of SAMPLES) {
          const text = template.replace("{task}", () => nagTaskName(task));
          expect(nagLineFitsTask(text, 0, [task]), text).toBe(true);
          expect(server.nagLineFitsTask(text, 0, [task]), text).toBe(true);
        }
      }
      for (const template of templates.filter((line) => !line.includes("{task}"))) {
        expect(nagLineFitsTask(template, null, SAMPLES), template).toBe(true);
      }
    }
  });

  it("no line takes the task for a person, a place, a workout or something simple, and no general line counts the tasks", () => {
    const all = NAG_PERSONAS.flatMap((persona) => {
      const pools = NAG_TEMPLATES[persona];
      return [...pools.early, ...pools.mid.gentle, ...pools.mid.firm, ...pools.late.gentle, ...pools.late.firm, ...pools.late.relentless];
    });
    for (const line of all) {
      expect(line, line).not.toMatch(/\{task\} reports for duty|\{task\} is still (?:standing|present)|Lace up\. \{task\}|rep on \{task\}|\{task\} is your next rep|stretching\. Time to move on|\{task\}\. Simple\./);
      if (!line.includes("{task}")) expect(line, line).not.toMatch(/\b(?:pick any one|any item|all three|these tasks|those tasks|both tasks)\b/i);
    }
  });
});
