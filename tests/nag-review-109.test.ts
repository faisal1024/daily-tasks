// PR 109 review fixes (1.6 G, "make the nag alerts take into account the
// actual task"): a line never names another task or a done one, not even by
// one distinctive word; generic words never drop a line; own lines about a
// done task go quiet; a snooze never brings a nag sooner; own steps are
// marked on the slots; one edit keeps the other tasks' AI lines. Local-time
// fixtures, so it passes under any TZ.

import { describe, expect, it } from "vitest";

import * as server from "../server/providers/nag-contract.mjs";
import {
  MAX_NAG_LINE,
  NAG_STOPWORDS,
  NAG_TEMPLATES,
  nagDistinctiveWords,
  nagLineFitsTask,
  parseNagResponse,
  requestNagLines,
} from "../lib/daily-tasks/nag";
import { fillNagOwnLine, MAX_NAG_OWN_LINES, nagOwnLineProblemMessage, NAG_OWN_LINE_PROBLEMS, NAG_OWN_LINE_UNMATCHED, nagOwnSteps } from "../lib/daily-tasks/nag-own-lines";
import {
  applyAiNagLines,
  nagAiKey,
  nagPlanFromRecord,
  nagRecordStub,
  nagSnoozeNote,
  nagSnoozeOutcome,
  nagTasksKey,
  normalizeNagRecord,
  planNagDay,
  snoozeNagRecord,
  type NagDayRecord,
  type NagPlanContext,
} from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NAG_WINDOW, DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";

const DAY = "2026-10-12";
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagLevel: "relentless" };
type SimTask = { id: string; text: string; done: boolean };
const TASKS: SimTask[] = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
const TEXTS = TASKS.map((task) => task.text);
const openOf = (tasks: SimTask[]) => tasks.filter((task) => !task.done).map(({ id, text }) => ({ id, text }));
const context = (tasks: SimTask[], overrides: Partial<NagPlanContext> = {}): NagPlanContext => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  tasks,
  plus: true,
  ...overrides,
});
const plan = (settings: NotificationConfig = NAG_ON, salt = "rv") =>
  planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(TASKS), salt });
const tick = (id: string) => TASKS.map((task) => (task.id === id ? { ...task, done: true } : task));

describe("P1: a line uses no distinctive word of another task, and a general line none of any (phone and proxy)", () => {
  const CASES: [string, number | null, boolean][] = [
    // The three lines from the review.
    ["Don't forget the dentist.", null, false],
    ["“Walk the dog” before the dentist closes.", 2, false],
    ["Your report is waiting. So is the dog.", null, false],
    // A plural is the same word.
    ["The reports won't write themselves.", null, false],
    // Fine: its own task only, and a general line with no task's words.
    ["“Walk the dog”. The leash is waiting.", 2, true],
    ["The list is still open.", null, true],
    // Generic words never count (the architect's point): call, write, today, time, list, make, finish...
    ["Time to make a start. Call it a plan: finish one thing today.", null, true],
    ["“Call the dentist” today. Then check the list, and write it off.", 0, true],
  ];

  it.each(CASES)("%j for %s: %s", (text, taskIndex, fits) => {
    expect(nagLineFitsTask(text, taskIndex, TEXTS)).toBe(fits);
    expect(server.nagLineFitsTask(text, taskIndex, TEXTS)).toBe(fits);
  });

  it("a word two tasks share doesn't drop a line about one of them", () => {
    const texts = ["Call the dentist", "Pay the dentist"];
    expect(nagLineFitsTask("“Call the dentist”, please.", 0, texts)).toBe(true);
    expect(server.nagLineFitsTask("“Call the dentist”, please.", 0, texts)).toBe(true);
  });

  it("both sides keep the same stopwords and find the same distinctive words", () => {
    expect([...server.NAG_STOPWORDS]).toEqual([...NAG_STOPWORDS]);
    for (const word of ["make", "work", "read", "list", "call", "send", "check", "finish", "start", "today", "done", "task", "thing", "stuff", "time", "email"]) {
      expect(NAG_STOPWORDS).toContain(word);
    }
    for (const text of [...TEXTS, "Email J.R. the 2026 taxes", "Réserver le café", "20-minute easy run", "Make the bed", "Groceries!"]) {
      expect(server.nagDistinctiveWords(text)).toEqual(nagDistinctiveWords(text));
    }
    expect(nagDistinctiveWords("Call the dentist")).toEqual(["dentist"]);
    expect(nagDistinctiveWords("Email J.R. the 2026 taxes")).toEqual(["taxe"]);
    expect(nagDistinctiveWords("Make the bed")).toEqual([]);
  });

  it("the proxy checks every task it was sent, and the phone every open task, also one past the three sent", async () => {
    const payload = { persona: "mom", level: "firm", tasks: TEXTS.map((text) => ({ text })), count: 4 };
    const lines = [
      { step: 1, taskIndex: null, text: "The leash is by the door. The dog knows." },
      { step: 2, taskIndex: null, text: "Walk-free zone? Not the dog's view." },
      { step: 3, taskIndex: null, text: "Still open, the list." },
    ];
    // "dog" is three letters: not distinctive. "leash" isn't a task's. So these pass;
    // a line with the third task's distinctive word doesn't.
    const third = { step: 4, taskIndex: null, text: "That walk won't happen by itself." };
    expect(server.sanitizeNagLines({ lines: [...lines, third] }, payload).lines.map((line: { text: string }) => line.text)).not.toContain(third.text);

    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          lines: [
            { step: 1, taskIndex: 0, text: "“Call the dentist”. Now." },
            { step: 2, taskIndex: null, text: "The list is open." },
            { step: 3, taskIndex: null, text: "Did the groceries happen?" },
            { step: 4, taskIndex: 1, text: "“Write the report”, please." },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const { lines: got } = await requestNagLines({
      persona: "mom",
      level: "firm",
      tasks: [...TEXTS.map((text) => ({ text })), { text: "Buy groceries" }],
      count: 4,
      planUrl: "https://proxy.example/api/momentum/plan",
      proxySecret: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(got.map((line) => line.text)).toEqual(["“Call the dentist”. Now.", "The list is open.", "“Write the report”, please."]);
    // parseNagResponse on its own: fitTexts defaults to the tasks sent.
    expect(parseNagResponse({ lines: [{ step: 1, taskIndex: null, text: "Did the groceries happen?" }] }, { taskCount: 1, count: 4, ownTexts: ["Call mom"] })).toHaveLength(1);
  });

  it("the prompt: tasks may be nouns or commands, quoted exactly, matched to their effort, never another task", () => {
    expect(server.NAG_SYSTEM_PROMPT).toContain("A task may be a noun");
    expect(server.NAG_SYSTEM_PROMPT).toContain("or a command");
    expect(server.NAG_SYSTEM_PROMPT).toContain("quote it exactly");
    expect(server.NAG_SYSTEM_PROMPT).toContain("Match the nag to the effort of the task");
    expect(server.NAG_SYSTEM_PROMPT).toContain("Never mention another task in a line");
  });
});

describe("P1: a line holding a word of a task since ticked or removed isn't sent", () => {
  const aiDay = () =>
    applyAiNagLines(
      plan(),
      [
        { step: 1, taskIndex: null, text: "Don't forget the dentist." },
        { step: 2, taskIndex: 1, text: "“Write the report”. Then the dentist." },
        { step: 3, taskIndex: null, text: "The list is still open." },
        { step: 4, taskIndex: 2, text: "“Walk the dog”, please." },
      ],
      openOf(TASKS),
      at(8),
    );

  it("while the dentist is open the lines go out; once it is ticked, none naming it does, general ones included", () => {
    const record = aiDay();
    expect(record.slots.map((slot) => slot.text)).toContain("Don't forget the dentist.");
    const before = nagPlanFromRecord(record, context(TASKS)).map((item) => item.body);
    expect(before).toContain("Don't forget the dentist.");
    const after = nagPlanFromRecord(record, context(tick("t0")));
    expect(after.length).toBeGreaterThan(0);
    for (const item of after) expect(item.body, item.body).not.toMatch(/dentist/i);
    expect(after.map((item) => item.body)).toContain("The list is still open.");
    expect(after.map((item) => item.body)).toContain("“Walk the dog”, please.");
  });

  it("the same when the task was removed from the list (the record keeps hashes of its words, never the words)", () => {
    const record = aiDay();
    const removed = TASKS.filter((task) => task.id !== "t0");
    for (const item of nagPlanFromRecord(record, context(removed))) expect(item.body, item.body).not.toMatch(/dentist/i);
    expect(JSON.stringify(record.taskWords)).not.toMatch(/dentist|report|walk/i);
    // Saved and loaded, it still knows; a stub (back to Calm) keeps none of it.
    const loaded = normalizeNagRecord(JSON.parse(JSON.stringify(record)))!;
    for (const item of nagPlanFromRecord(loaded, context(removed))) expect(item.body, item.body).not.toMatch(/dentist/i);
    expect(nagRecordStub(record, at(8)).taskWords).toBeUndefined();
  });

  it("a word an open task has too doesn't count as the done task's", () => {
    const tasks: SimTask[] = [
      { id: "a", text: "Call the dentist", done: true },
      { id: "b", text: "Pay the dentist", done: false },
    ];
    const record = applyAiNagLines(
      planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: NAG_ON, open: openOf(tasks.map((task) => ({ ...task, done: false }))), salt: "rv" }),
      [
        { step: 1, taskIndex: 1, text: "“Pay the dentist”, please." },
        { step: 2, taskIndex: null, text: "The list is still open." },
        { step: 3, taskIndex: 1, text: "Still: “Pay the dentist”." },
      ],
      openOf(tasks.map((task) => ({ ...task, done: false }))),
      at(8),
    );
    expect(nagPlanFromRecord(record, context(tasks)).map((item) => item.body)).toContain("“Pay the dentist”, please.");
  });
});

describe("P2: an own line about a task ticked today isn't said", () => {
  const settings = { ...NAG_ON, nagOwnLines: ["Dentist. Now. I mean it."] };

  it("said while the dentist is open; never once it is ticked or removed; {task} lines still are", () => {
    let seen = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const record = plan(settings, `own${seed}`);
      const open = nagPlanFromRecord(record, context(TASKS, { settings }));
      if (open.some((item) => item.body === "Dentist. Now. I mean it.")) seen += 1;
      for (const tasks of [tick("t0"), TASKS.filter((task) => task.id !== "t0")]) {
        for (const item of nagPlanFromRecord(record, context(tasks, { settings }))) expect(item.body).not.toMatch(/dentist/i);
      }
      const named = { ...NAG_ON, nagOwnLines: ["No more excuses: {task}."] };
      const withTask = nagPlanFromRecord(plan(named, `own${seed}`), context(tick("t0"), { settings: named }));
      expect(withTask.some((item) => item.body.startsWith("No more excuses: “"))).toBe(true);
    }
    expect(seen).toBe(20);
  });

  it("with names hidden after the day was planned, a {task} line is never filled in, whatever task the slot was for", () => {
    const named = { ...NAG_ON, nagOwnLines: ["No more excuses: {task}."] };
    for (let seed = 0; seed < 20; seed += 1) {
      const record = plan(named, `hid${seed}`);
      const hidden = { ...named, hideTaskNames: true };
      for (const item of nagPlanFromRecord(record, context(TASKS, { settings: hidden }))) {
        expect(item.body).not.toMatch(/No more excuses|dentist|report|walk/i);
        expect(item.data?.taskId).toBeUndefined();
      }
    }
  });
});

describe("own steps are marked on the slots when the day is planned", () => {
  it("one nag in three is marked, whatever the number of lines, and the plan's own nags are among them", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const record = plan(NAG_ON, `mark${seed}`);
      const marked = record.slots.filter((slot) => slot.own).map((slot) => slot.step);
      expect(marked).toEqual(nagOwnSteps(record.total, MAX_NAG_OWN_LINES, `${DAY}|${record.salt}`));
      for (const count of [1, 3, 5]) {
        const lines = ["One of mine.", "Two of mine.", "Three of mine.", "Four of mine.", "Five of mine."].slice(0, count);
        const settings = { ...NAG_ON, nagOwnLines: lines };
        const items = nagPlanFromRecord(record, context(TASKS, { settings }));
        const ownAt = items.filter((item) => lines.includes(item.body)).map((item) => item.data?.step);
        expect(ownAt.length).toBe(Math.min(count, marked.length));
        for (const step of ownAt) expect(marked).toContain(step);
      }
    }
  });

  it("a nag that went off at an own step counts as own (no write-back needed): the next own line waits", () => {
    const settings = { ...NAG_ON, nagOwnLines: ["One of mine.", "Two of mine."] };
    const record = plan(settings, "mark1");
    const steps = record.slots.filter((slot) => slot.own).map((slot) => slot.step);
    expect(steps.length).toBeGreaterThan(1);
    // A snooze took out the nags between the first two own steps.
    const first = record.slots.find((slot) => slot.step === steps[0])!;
    const second = record.slots.find((slot) => slot.step === steps[1])!;
    const squeezed: NagDayRecord = { ...record, slots: record.slots.filter((slot) => slot.step <= first.step || slot.step >= second.step) };
    const items = nagPlanFromRecord(squeezed, context(TASKS, { settings, now: new Date(first.fireAtMs + 60_000) }));
    const next = items.find((item) => item.id === second.id);
    expect(next).toBeDefined();
    expect(["One of mine.", "Two of mine."]).not.toContain(next!.body);
    // Without the squeeze, that step says one of the lines.
    const plain = nagPlanFromRecord(record, context(TASKS, { settings, now: new Date(first.fireAtMs + 60_000) })).find((item) => item.id === second.id);
    expect(["One of mine.", "Two of mine."]).toContain(plain!.body);
  });
});

describe("one edit keeps the other tasks' AI lines", () => {
  it("only the edited task's lines go, and a general line that now names a task", () => {
    const record = applyAiNagLines(
      plan(),
      [
        { step: 1, taskIndex: 0, text: "AI: “Call the dentist”, please." },
        { step: 2, taskIndex: 1, text: "AI: “Write the report”, please." },
        { step: 3, taskIndex: null, text: "AI: the plumber can wait. The list can't." },
        { step: 4, taskIndex: 2, text: "AI: “Walk the dog”, please." },
        { step: 5, taskIndex: null, text: "AI: the list, please." },
      ],
      openOf(TASKS),
      at(8),
    );
    const asked = { ...record, aiFor: nagAiKey("mom", "relentless", openOf(TASKS)) };
    const edited = TASKS.map((task) => (task.id === "t0" ? { ...task, text: "Call the plumber" } : task));
    const after = planNagDay({ previous: asked, now: at(8, 1), dayKey: DAY, settings: NAG_ON, open: openOf(edited), salt: "rv" });
    const texts = after.slots.map((slot) => slot.text);
    expect(after.source).toBe("ai");
    expect(texts).not.toContain("AI: “Call the dentist”, please.");
    expect(texts).not.toContain("AI: the plumber can wait. The list can't.");
    expect(texts).toContain("AI: “Write the report”, please.");
    expect(texts).toContain("AI: “Walk the dog”, please.");
    expect(texts).toContain("AI: the list, please.");
    // Pinned to what the lines were written for, so an AI request that failed later can't bring the old ones back.
    expect(after.linesFor).toBe(nagTasksKey(openOf(TASKS)));
    const failedAsk = { ...after, aiFor: nagAiKey("mom", "relentless", openOf(edited)) };
    const again = planNagDay({ previous: failedAsk, now: at(8, 2), dayKey: DAY, settings: { ...NAG_ON, nagWindow: { startMinutes: 9 * 60, endMinutes: 20 * 60 } }, open: openOf(edited), salt: "rv" });
    expect(again.slots.map((slot) => slot.text)).not.toContain("AI: “Call the dentist”, please.");
  });
});

describe("P2: a snooze never brings a nag sooner, and says when the next one comes", () => {
  it("the next nag moves to the later of the hour and its own time", () => {
    const record = plan();
    const future = record.slots.filter((slot) => slot.fireAtMs > at(8).getTime());
    const tap = new Date(future[0].fireAtMs - 2 * 60 * 60_000);
    if (tap.getTime() > at(9).getTime()) {
      const out = snoozeNagRecord(record, tap, DEFAULT_NAG_WINDOW);
      expect(out.slots.find((slot) => slot.id === future[0].id)?.fireAtMs).toBe(future[0].fireAtMs);
    }
    const late = snoozeNagRecord(record, new Date(future[0].fireAtMs - 10 * 60_000), DEFAULT_NAG_WINDOW);
    expect(late.slots.find((slot) => slot.id === future[0].id)?.fireAtMs).toBe(future[0].fireAtMs + 50 * 60_000);
  });

  it("the note", () => {
    const format = (hour: number, minute: number) => `${hour}:${String(minute).padStart(2, "0")}`;
    expect(nagSnoozeNote({ nextAt: at(15, 40).getTime(), pastWindow: false }, format)).toBe("Next nag around 15:40");
    expect(nagSnoozeNote({ nextAt: null, pastWindow: true })).toBe("No more nags today (past your nag hours)");
    expect(nagSnoozeNote({ nextAt: null, pastWindow: false })).toBe("No more nags today");
    const record = plan();
    const out = snoozeNagRecord(record, at(20, 30), DEFAULT_NAG_WINDOW);
    expect(nagSnoozeOutcome(out, at(20, 30), DEFAULT_NAG_WINDOW)).toEqual({ nextAt: null, pastWindow: true });
  });
});

describe("P3: own lines, the built-in lines", () => {
  it("a filled own line is never over MAX_NAG_LINE", () => {
    const long = `${"x".repeat(130)} {task}`;
    const filled = fillNagOwnLine(long, "A very long task name that goes on and on and on")!;
    expect(Array.from(filled).length).toBeLessThanOrEqual(MAX_NAG_LINE);
    expect(filled.endsWith("…")).toBe(true);
    expect(fillNagOwnLine("Short {task}.", "Taxes")).toBe("Short “Taxes”.");
  });

  it("unmatched braces get their own message", () => {
    expect(nagOwnLineProblemMessage("placeholder", "oops {task")).toBe(NAG_OWN_LINE_UNMATCHED);
    expect(nagOwnLineProblemMessage("placeholder", "{task} and {task}")).toBe(NAG_OWN_LINE_PROBLEMS.placeholder);
    expect(nagOwnLineProblemMessage("long", "x")).toBe(NAG_OWN_LINE_PROBLEMS.long);
  });

  it("the rewritten lines assume no kind of task", () => {
    const all = Object.values(NAG_TEMPLATES).flatMap((pools) => [
      ...pools.early,
      ...pools.mid.gentle,
      ...pools.mid.firm,
      ...pools.late.gentle,
      ...pools.late.firm,
      ...pools.late.relentless,
    ]);
    for (const gone of [
      "Small list today. I've mowed bigger lawns. Still, a list is a list.",
      "I put {task} on the list so I wouldn't have to say it. Here I am.",
      "No more stalling. Time to move on {task}.",
      "Fourth quarter. {task}. Leave it all out there.",
      "{task}! DROP AND GIVE ME TEN MINUTES, MAGGOT!",
      "Are you doing {task}, or are you 'about to' do it?",
    ]) {
      expect(all).not.toContain(gone);
    }
    for (const line of all) expect(line, line).not.toMatch(/\b(?:minutes?|doing \{task\}|move on \{task\}|leave it all)\b/i);
  });
});
