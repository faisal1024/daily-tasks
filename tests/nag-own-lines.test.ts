// 1.6 G (Plus): the user's own nag lines. The line checks, how many go into a
// day and where, what {task} may be filled with, how a nag that went off is
// counted (the 1.4.1 `sent` write-back), and that nothing of them leaves the
// phone. Times are local (new Date(y, m, d, h)), so the file passes under any
// TZ (America/New_York, Asia/Kolkata, Pacific/Kiritimati, Pacific/Pago_Pago).

import { describe, expect, it } from "vitest";

import { nagTaskName } from "../lib/daily-tasks/nag";
import {
  checkNagOwnLine,
  fillNagOwnLine,
  MAX_NAG_OWN_LINE_CHARS,
  MAX_NAG_OWN_LINES,
  nagOwnLineHoldsTask,
  nagOwnSteps,
  normalizeNagOwnLines,
} from "../lib/daily-tasks/nag-own-lines";
import {
  NAG_CATEGORY_ID,
  NAG_GENERAL_CATEGORY_ID,
  nagPlanFromRecord,
  nagRecordWithPlannedWords,
  planNagDay,
  type NagDayRecord,
  type NagPlanContext,
} from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";

const DAY = "2026-10-12";
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);

describe("a line of the user's own is checked as typed and when loaded", () => {
  const problem = (raw: string, existing: string[] = []) => checkNagOwnLine(raw, existing).problem;

  it("accepts a plain line and keeps {task} (any case or spacing) as {task}", () => {
    expect(checkNagOwnLine("Do it now.")).toEqual({ text: "Do it now.", problem: null });
    expect(checkNagOwnLine("Do { Task } now.").text).toBe("Do {task} now.");
    expect(problem("Do {TASK} now.")).toBeNull();
  });

  it("refuses empty, too long (81), a link, a second or a stray brace, a duplicate and a sixth", () => {
    expect(problem("   ")).toBe("empty");
    expect(problem("{task}")).toBe("empty");
    expect(problem("x".repeat(MAX_NAG_OWN_LINE_CHARS))).toBeNull();
    expect(problem("x".repeat(MAX_NAG_OWN_LINE_CHARS + 1))).toBe("long");
    // Counted in characters, not UTF-16 units: 80 emoji fit.
    expect(problem("\u{1F600}".repeat(MAX_NAG_OWN_LINE_CHARS))).toBeNull();
    expect(problem("see https://example.com now")).toBe("link");
    expect(problem("see www.example.com now")).toBe("link");
    expect(problem("mail me@example.com")).toBe("link");
    expect(problem("{task} and {task}")).toBe("placeholder");
    expect(problem("{{task}}")).toBe("placeholder");
    expect(problem("oops {name}")).toBe("placeholder");
    expect(problem("oops {task")).toBe("placeholder");
    expect(problem("Do it.", ["do IT."])).toBe("duplicate");
    expect(problem("Sixth", ["a", "b", "c", "d", "e"])).toBe("full");
  });

  it("takes out bidi marks, overrides, zero-width characters and line breaks, and sees a link hidden by them", () => {
    expect(checkNagOwnLine("‮evil‬ line​!").text).toBe("evil line!");
    expect(checkNagOwnLine("a⁦b⁩c‎d‏e").text).toBe("abcde");
    expect(checkNagOwnLine("one\ntwo\r\nthree").text).toBe("one two three");
    expect(problem("ht​tp://example.com")).toBe("link");
    expect(problem("ww⁠w.example.com")).toBe("link");
    // A line of only invisible characters is empty.
    expect(problem("​‮​")).toBe("empty");
  });

  it("loading again keeps at most five usable lines, once each, and ignores anything that isn't a string list", () => {
    const saved = ["One", "one", "", "http://x.example", 7, null, "Two {task}", "Three", "Four", "Five", "Six", "x".repeat(81)];
    expect(normalizeNagOwnLines(saved)).toEqual(["One", "Two {task}", "Three", "Four", "Five"]);
    expect(normalizeNagOwnLines(saved).length).toBeLessThanOrEqual(MAX_NAG_OWN_LINES);
    expect(normalizeNagOwnLines("nope")).toEqual([]);
    expect(normalizeNagOwnLines(undefined)).toEqual([]);
    expect(normalizeNagOwnLines({ 0: "x" })).toEqual([]);
  });
});

describe("which steps of the day say one of the user's lines", () => {
  it("at most one in three, never two in a row, within the day, rising, and the same for the same seed", () => {
    for (const total of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16]) {
      for (const count of [0, 1, 2, 3, 4, 5]) {
        for (let seed = 0; seed < 40; seed += 1) {
          const steps = nagOwnSteps(total, count, `s${seed}`);
          expect(steps.length, `${total}/${count}`).toBeLessThanOrEqual(Math.floor(total / 3));
          expect(steps.length).toBeLessThanOrEqual(count);
          expect(steps.length).toBe(Math.min(Math.floor(total / 3), count));
          steps.forEach((step, index) => {
            expect(step).toBeGreaterThanOrEqual(1);
            expect(step).toBeLessThanOrEqual(total);
            if (index > 0) expect(step - steps[index - 1], `${total}/${count} seed ${seed}: ${steps.join(",")}`).toBeGreaterThanOrEqual(2);
          });
          expect(nagOwnSteps(total, count, `s${seed}`)).toEqual(steps);
        }
      }
    }
  });

  it("garbage in gives no steps", () => {
    expect(nagOwnSteps(Number.NaN, 3, "x")).toEqual([]);
    expect(nagOwnSteps(11, Number.NaN, "x")).toEqual([]);
    expect(nagOwnSteps(-5, 3, "x")).toEqual([]);
    expect(nagOwnSteps(11, -1, "x")).toEqual([]);
  });
});

describe("{task} in a line of the user's own", () => {
  it("is the task's name, cleaned and quoted like a built-in line's, and never reaches the AI-shaped braces twice", () => {
    expect(fillNagOwnLine("Do {task} now.", "Call the dentist.")).toBe(`Do ${nagTaskName("Call the dentist.")} now.`);
    // The task's words are not read as a template again.
    expect(fillNagOwnLine("Do {task} now.", "fix {task} $& bug")).toBe(`Do ${nagTaskName("fix {task} $& bug")} now.`);
    expect(fillNagOwnLine("Do {task} now.", null)).toBeNull();
    expect(fillNagOwnLine("No task here.", null)).toBe("No task here.");
  });

  it("with names hidden, a line holding an open task's words is not used (3 characters or more)", () => {
    expect(nagOwnLineHoldsTask("Mom says: Call the dentist!", ["call the dentist"])).toBe(true);
    expect(nagOwnLineHoldsTask("Mom says nothing", ["call the dentist"])).toBe(false);
    expect(nagOwnLineHoldsTask("an 'ok' line", ["ok"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A whole day, as the phone lives it: planned at 08:00, synced at the start
// and just before each nag, the `sent` notes written back, each nag read.
// ---------------------------------------------------------------------------

const ALPHA = { id: "t0", text: "Zorvex the plimth", done: false };
const BETA = { id: "t1", text: "Quandle a brispo", done: false };
const GAMMA = { id: "t2", text: "Fennock wuxley", done: false };
type Task = { id: string; text: string; done: boolean };

const settingsWith = (overrides: Partial<NotificationConfig>): NotificationConfig => ({
  ...DEFAULT_NOTIFICATIONS,
  style: "nag",
  nagConfirmed: true,
  nagLevel: "relentless",
  nagWindow: { startMinutes: 8 * 60, endMinutes: 22 * 60 },
  ...overrides,
});
const openOf = (tasks: Task[]) => tasks.filter((task) => !task.done).map(({ id, text }) => ({ id, text }));
const context = (settings: NotificationConfig, tasks: Task[], now: Date, extra: Partial<NagPlanContext> = {}): NagPlanContext => ({
  now,
  today: DAY,
  settings,
  permissionState: "granted",
  tasks,
  plus: true,
  ...extra,
});

interface Fired {
  body: string;
  taskId: unknown;
  categoryId: string | undefined;
  step: unknown;
}

/** Lives the day; returns what each nag said when it went off, in order, and the final record. */
function liveDay(settings: NotificationConfig, tasks: Task[], salt: string, syncsPerNag = 1): { fired: Fired[]; record: NagDayRecord } {
  let record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt });
  const slots = [...record.slots].sort((a, b) => a.fireAtMs - b.fireAtMs);
  const fired: Fired[] = [];
  const sync = (now: Date) => {
    const ctx = context(settings, tasks, now);
    record = nagRecordWithPlannedWords(record, ctx) ?? record;
    return nagPlanFromRecord(record, ctx);
  };
  sync(at(8));
  for (const slot of slots) {
    let item;
    for (let i = 0; i < syncsPerNag; i += 1) item = sync(new Date(slot.fireAtMs - 60_000 + i)).find((it) => it.id === slot.id);
    if (item) fired.push({ body: item.body, taskId: item.data?.taskId, categoryId: item.categoryId, step: item.data?.step });
  }
  // One more sync after the last nag: the said lines don't come back.
  sync(new Date(slots[slots.length - 1].fireAtMs + 60_000));
  return { fired, record };
}

const OWN = ["Own line one.", "Own line two for {task}.", "Own line three."];
const ownBodies = (tasks: Task[], lines: string[]) => {
  const bodies = new Set<string>();
  for (const line of lines) {
    if (!line.includes("{task}")) bodies.add(line);
    else for (const task of tasks) bodies.add(line.replace("{task}", nagTaskName(task.text)));
  }
  return bodies;
};

describe("a day with lines of the user's own", () => {
  const TASKS = [ALPHA, BETA, GAMMA];
  const LEVELS = [
    ["gentle", 4],
    ["firm", 7],
    ["relentless", 11],
  ] as const;

  it.each(LEVELS)("%s: at most 1 in 3 nags, never two in a row, each line once, and they do appear", (level, count) => {
    for (let seed = 0; seed < 25; seed += 1) {
      const settings = settingsWith({ nagLevel: level, nagOwnLines: OWN });
      const { fired, record } = liveDay(settings, TASKS, `salt${seed}`);
      expect(fired.length, `seed ${seed}`).toBe(count);
      const mine = ownBodies(TASKS, OWN);
      const flags = fired.map((item) => mine.has(item.body));
      const used = fired.filter((item) => mine.has(item.body)).map((item) => item.body);
      expect(used.length, `seed ${seed}: ${fired.map((item) => item.body).join(" | ")}`).toBe(Math.min(Math.floor(record.total / 3), OWN.length));
      expect(used.length).toBeLessThanOrEqual(Math.floor(fired.length / 3));
      flags.forEach((flag, index) => {
        if (flag && index > 0) expect(flags[index - 1], `seed ${seed}: two in a row at ${index}`).toBe(false);
      });
      // Each line (as it was written) once a day at most; no body twice at all.
      expect(new Set(fired.map((item) => item.body)).size).toBe(fired.length);
      const written = used.map((body) => OWN.find((line) => ownBodies(TASKS, [line]).has(body)));
      expect(new Set(written).size).toBe(written.length);
    }
  });

  it("one line only, on a day with several own steps: it is said once and not again, however often it is synced", () => {
    for (let seed = 0; seed < 15; seed += 1) {
      const settings = settingsWith({ nagOwnLines: ["Only mine."] });
      const { fired } = liveDay(settings, TASKS, `one${seed}`, 3);
      expect(fired.filter((item) => item.body === "Only mine.").length).toBe(1);
    }
  });

  it("the sent write-back counts them: the record notes the line, and a later redraw of the day doesn't say it again", () => {
    const settings = settingsWith({ nagOwnLines: ["Only mine."] });
    let record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(TASKS), salt: "redraw" });
    record = nagRecordWithPlannedWords(record, context(settings, TASKS, at(8))) ?? record;
    const withNote = record.slots.filter((slot) => slot.sent === "Only mine.");
    expect(withNote).toHaveLength(1);
    // That nag goes off; later the user changes the level (the rest of the day is drawn again).
    const goneOff = new Date(withNote[0].fireAtMs + 60_000);
    const redrawn = planNagDay({ previous: record, now: goneOff, dayKey: DAY, settings: { ...settings, nagLevel: "firm" }, open: openOf(TASKS), salt: "redraw" });
    const items = nagPlanFromRecord(redrawn, context({ ...settings, nagLevel: "firm" }, TASKS, goneOff));
    expect(items.some((item) => item.body === "Only mine.")).toBe(false);
  });

  it("a stand-in for a ticked task counts like an own line: the next own line waits a nag", () => {
    // A ticked task's nag is a stand-in; it is counted like an own line, so the next own line waits.
    const settings = settingsWith({ nagLevel: "firm", nagOwnLines: OWN });
    for (let seed = 0; seed < 15; seed += 1) {
      const tasks: Task[] = [ALPHA, BETA, GAMMA];
      let record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt: `tick${seed}` });
      const ticked: Task[] = [{ ...ALPHA, done: true }, BETA, GAMMA];
      const fired: string[] = [];
      for (const slot of [...record.slots].sort((a, b) => a.fireAtMs - b.fireAtMs)) {
        const list = slot.step > 2 ? ticked : tasks;
        const ctx = context(settings, list, new Date(slot.fireAtMs - 60_000));
        record = nagRecordWithPlannedWords(record, ctx) ?? record;
        const item = nagPlanFromRecord(record, ctx).find((it) => it.id === slot.id);
        if (item) fired.push(item.body);
      }
      const mine = ownBodies(tasks, OWN);
      fired.forEach((body, index) => {
        if (index > 0 && mine.has(body)) expect(mine.has(fired[index - 1]), `seed ${seed}`).toBe(false);
      });
    }
  });
});

describe("{task} in a day's own lines", () => {
  const NAMED = ["Time for {task}, I mean it."];

  it("names the nag's task, quoted, with that task's id (so Mark done ticks it); a line without {task} is a general nag", () => {
    const settings = settingsWith({ nagOwnLines: ["Plain own line.", ...NAMED] });
    const { fired } = liveDay(settings, [ALPHA, BETA, GAMMA], "named");
    const named = fired.filter((item) => item.body.startsWith("Time for"));
    expect(named.length).toBeGreaterThan(0);
    for (const item of named) {
      const task = [ALPHA, BETA, GAMMA].find((candidate) => item.body === `Time for ${nagTaskName(candidate.text)}, I mean it.`);
      expect(task, item.body).toBeTruthy();
      expect(item.taskId).toBe(task!.id);
      expect(item.categoryId).toBe(NAG_CATEGORY_ID);
    }
    const plain = fired.filter((item) => item.body === "Plain own line.");
    for (const item of plain) {
      expect(item.taskId).toBeUndefined();
      expect(item.categoryId).toBe(NAG_GENERAL_CATEGORY_ID);
    }
  });

  it("never fills a sensitive task: the next open task that isn't one, and when all are sensitive the line isn't used", () => {
    const sensitive: Task = { id: "s0", text: "Call the oncologist", done: false };
    const settings = settingsWith({ nagOwnLines: NAMED });
    for (let seed = 0; seed < 20; seed += 1) {
      const mixed = liveDay(settings, [sensitive, BETA, GAMMA], `sens${seed}`).fired;
      for (const item of mixed) {
        expect(item.body, item.body).not.toMatch(/oncolog/i);
        if (item.body.startsWith("Time for")) expect(item.taskId).not.toBe("s0");
      }
      expect(mixed.some((item) => item.body.startsWith("Time for"))).toBe(true);
      const allSensitive = liveDay(settings, [sensitive, { id: "s1", text: "Pay the overdue bill", done: false }], `sens2${seed}`).fired;
      expect(allSensitive.some((item) => item.body.startsWith("Time for")), "all sensitive").toBe(false);
      for (const item of allSensitive) expect(item.body).not.toMatch(/oncolog|overdue|bill/i);
    }
  });

  it("with names hidden: lines with {task} are not used, plain ones are, unless they hold an open task's words; no nag carries a task id", () => {
    const lines = [...NAMED, "Plain own line.", `Remember to ${ALPHA.text.toLowerCase()} please.`];
    const settings = settingsWith({ hideTaskNames: true, nagOwnLines: lines });
    for (let seed = 0; seed < 20; seed += 1) {
      const { fired } = liveDay(settings, [ALPHA, BETA, GAMMA], `hide${seed}`);
      for (const item of fired) {
        expect(item.body).not.toMatch(/Time for/);
        expect(item.body.toLowerCase()).not.toContain(ALPHA.text.toLowerCase());
        expect(item.taskId).toBeUndefined();
        expect(item.categoryId).toBe(NAG_GENERAL_CATEGORY_ID);
      }
      expect(fired.some((item) => item.body === "Plain own line.")).toBe(true);
    }
  });

  it("a task that is edited before the nag goes off: the line names it with its new words", () => {
    const settings = settingsWith({ nagOwnLines: NAMED });
    for (let seed = 0; seed < 10; seed += 1) {
      const record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf([ALPHA, BETA, GAMMA]), salt: `edit${seed}` });
      const edited = [{ ...ALPHA, text: "Drambo the kleptu" }, BETA, GAMMA];
      const items = nagPlanFromRecord(record, context(settings, edited, at(8, 1)));
      for (const item of items) {
        expect(item.body).not.toMatch(/zorvex|plimth/i);
        if (item.body.startsWith("Time for") && item.data?.taskId) {
          const task = edited.find((candidate) => candidate.id === item.data!.taskId)!;
          expect(item.body).toBe(`Time for ${nagTaskName(task.text)}, I mean it.`);
        }
      }
    }
  });
});

describe("lines of the user's own are for Plus, in Nag, with reminders on", () => {
  it("nothing without Plus, in Calm, with reminders off, without permission or paused today", () => {
    const settings = settingsWith({ nagOwnLines: OWN });
    const tasks = [ALPHA, BETA, GAMMA];
    const record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(tasks), salt: "gate" });
    const now = at(8, 1);
    expect(nagPlanFromRecord(record, context(settings, tasks, now)).length).toBeGreaterThan(0);
    expect(nagPlanFromRecord(record, context(settings, tasks, now, { plus: false }))).toEqual([]);
    expect(nagPlanFromRecord(record, context(settings, tasks, now, { plus: undefined }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ ...settings, style: "calm" }, tasks, now))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ ...settings, enabled: false }, tasks, now))).toEqual([]);
    expect(nagPlanFromRecord(record, context(settings, tasks, now, { permissionState: "denied" }))).toEqual([]);
    expect(nagPlanFromRecord(record, context({ ...settings, nagPausedDate: DAY }, tasks, now))).toEqual([]);
  });

  it("never time-sensitive, and the record keeps no own line in its lines or its task key", () => {
    const settings = settingsWith({ nagOwnLines: ["Secret own words {task}."] });
    const { fired, record } = liveDay(settings, [ALPHA, BETA, GAMMA], "priv");
    expect(fired.length).toBeGreaterThan(0);
    const plan = nagPlanFromRecord(record, context(settings, [ALPHA, BETA, GAMMA], at(8, 1)));
    for (const item of plan) expect(item.interruptionLevel).not.toBe("timeSensitive");
    // What is saved for the AI-side bookkeeping holds no own line.
    expect(JSON.stringify({ lines: record.lines, lineTasks: record.lineTasks, tasksKey: record.tasksKey, aiFor: record.aiFor })).not.toMatch(/secret/i);
  });
});

describe("lines of the user's own changed during the day", () => {
  const TASKS = [ALPHA, BETA, GAMMA];

  it("a task edited into a sensitive one after the day was planned is never named by a line of the user's own", () => {
    const settings = settingsWith({ nagOwnLines: ["Time for {task}, I mean it."] });
    for (let seed = 0; seed < 20; seed += 1) {
      const record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings, open: openOf(TASKS), salt: `late${seed}` });
      for (const edited of [{ ...ALPHA, text: "Call the oncologist" }, { ...BETA, text: "Pay the overdue bill" }, { ...GAMMA, text: "Meet the lawyer" }]) {
        const list = TASKS.map((task) => (task.id === edited.id ? edited : task));
        for (const item of nagPlanFromRecord(record, context(settings, list, at(8, 1)))) {
          expect(item.body, item.body).not.toMatch(/oncolog|overdue|bill|lawyer/i);
        }
      }
    }
  });

  // Found by this test (seed 8): the own steps used to be drawn from the number of usable lines, so
  // adding lines after one was said moved them, and two own lines could come in a row. Now the own
  // steps are marked on the slots when the day is planned (NagSlot.own), whatever the line count.
  it("adding lines after one was said doesn't put two of them in a row", () => {
    const first = settingsWith({ nagOwnLines: ["Own line one."] });
    const more = settingsWith({ nagOwnLines: ["Own line one.", "Own line two.", "Own line three."] });
    const mine = new Set(["Own line one.", "Own line two.", "Own line three."]);
    for (let seed = 0; seed < 40; seed += 1) {
      let record = planNagDay({ previous: null, now: at(8), dayKey: DAY, settings: first, open: openOf(TASKS), salt: `grow${seed}` });
      const slots = [...record.slots].sort((a, b) => a.fireAtMs - b.fireAtMs);
      const fired: string[] = [];
      let settings = first;
      for (const slot of slots) {
        const ctx = context(settings, TASKS, new Date(slot.fireAtMs - 60_000));
        record = nagRecordWithPlannedWords(record, ctx) ?? record;
        const item = nagPlanFromRecord(record, ctx).find((it) => it.id === slot.id);
        if (item) fired.push(item.body);
        // Right after the first own line went off, the user adds two more.
        if (settings === first && item && mine.has(item.body)) settings = more;
      }
      fired.forEach((body, index) => {
        if (index > 0 && mine.has(body)) expect(mine.has(fired[index - 1]), `seed ${seed}: ${fired.join(" | ")}`).toBe(false);
      });
    }
  });
});
