// Task-aware reminders (1.4, PR #89): what each reminder says, which ones may
// state counts, what is safe to put in a notification, the 64 limit, and the
// times across clock changes. All fixtures are local time.
import { afterEach, describe, expect, it, vi } from "vitest";

import { toDateKey } from "../lib/daily-tasks/date";
import {
  buildReminderCopy,
  GENERIC_REMINDER_COPY,
  MAX_REMINDER_TASK_CHARS,
  NAME_FREE_REMINDER_BODIES,
  reminderGraphemes,
  reminderTaskName,
  reminderVariantIndex,
  type ReminderCopyInput,
  type ReminderKind,
  type ReminderTask,
} from "../lib/daily-tasks/reminder-copy";
import {
  combineStrategies,
  createDebounced,
  fitPlanToLimit,
  IOS_PENDING_NOTIFICATION_LIMIT,
  morningsStrategy,
  REMINDER_SYNC_DEBOUNCE_MS,
  reminderCopyContext,
  taskAwareStrategy,
  yesterdayOpenTexts,
  type ReminderContext,
  type ReminderPlan,
  type ReminderStrategy,
} from "../lib/daily-tasks/reminder-plan";
import { planReminders, planUpcomingMornings } from "../lib/daily-tasks/reminders";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { DEFAULT_NOTIFICATIONS, type DayTaskRecord, type TomorrowDraft } from "../lib/daily-tasks/types";

const KINDS: ReminderKind[] = ["morning", "progress", "evening"];
const GENERIC_BODIES = KINDS.map((kind) => GENERIC_REMINDER_COPY[kind].body);
const GENERIC_TITLES = KINDS.map((kind) => GENERIC_REMINDER_COPY[kind].title);
/** What a reminder may say with names hidden: the general lines, the name-free ones, and the empty day's prompt. */
const NAME_FREE_BODY = (body: string) =>
  [...GENERIC_BODIES, ...NAME_FREE_REMINDER_BODIES.day, ...NAME_FREE_REMINDER_BODIES.evening].includes(body) ||
  /^(Nothing picked yet\.|A fresh page\.) [^:·]+$/.test(body);
/** The wording of a reminder written ahead of its delivery: true whether or not the task was ticked since. */
const HEDGED =
  /Still open\?|Still open tonight\?|If it's still open|Anything still open|If there's five minutes left today|^(Today's three|On today's list): [^.]*\. Anything/;
/** Words that would be wrong after a tick the app never saw. */
const ASSERTS_OPEN = /Still open:|Still open tonight[:.]|First up|Next:|to go|\d/;

const task = (text: string, done = false): ReminderTask => ({ id: `id-${text}`, text, done });
/** A reminder as it shows: title, then body. */
const shown = (words: { title: string; body: string } | null | undefined) => (words ? `${words.title} | ${words.body}` : "");
const DENTIST = task("Call the dentist");
const REPORT = task("Write the report");
const WALK = task("Walk");

/** Monday 12 October 2026 at the given local time. */
const monday = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);

function context(overrides: Partial<ReminderContext> = {}): ReminderContext {
  const now = overrides.now ?? monday(9, 5);
  return {
    now,
    today: toDateKey(now),
    settings: DEFAULT_NOTIFICATIONS,
    permissionState: "granted",
    tasks: [],
    locked: false,
    yesterdayOpen: [],
    draft: null,
    pending: [],
    lastDeliveredAt: null,
    ...overrides,
  };
}

/** A plan, soonest first. */
const planFor = (overrides: Partial<ReminderContext> = {}): ReminderPlan =>
  taskAwareStrategy(context(overrides)).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());

function copy(overrides: Partial<ReminderCopyInput> = {}) {
  return buildReminderCopy({
    kind: "progress",
    dayKey: "2026-10-12",
    slotIndex: 0,
    tasks: [],
    locked: false,
    yesterdayOpen: [],
    hideNames: false,
    certain: true,
    ...overrides,
  });
}

/** Every wording a situation can produce: each kind, each slot, a few days. Title and body, as shown. */
function everyVariant(overrides: Partial<ReminderCopyInput>): { title: string; body: string; taskId?: string }[] {
  const out: { title: string; body: string; taskId?: string }[] = [];
  for (const kind of overrides.kind ? [overrides.kind] : KINDS) {
    for (const dayKey of ["2026-10-12", "2026-10-13", "2026-12-31"]) {
      for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
        const words = copy({ ...overrides, kind, dayKey, slotIndex });
        if (!words) throw new Error("expected a reminder");
        out.push(words);
      }
    }
  }
  return out;
}
const lines = (overrides: Partial<ReminderCopyInput>) => everyVariant(overrides).map(shown);

describe("which reminders may state counts", () => {
  const tasks = [task("Alpha", true), task("Bravo"), task("Charlie")];

  it("only the earliest remaining slot today states the count; the later ones are true either way", () => {
    const today = planFor({ now: monday(9, 5), tasks }).filter((item) => item.id.includes(":2026-10-12:"));
    expect(today.map((item) => item.fireAt.getHours())).toEqual([10, 12, 14, 16, 17, 18, 19, 20, 21, 22]);
    expect(shown(today[0])).toMatch(/1 of 3 done|1 done, 2 to go/);
    expect(shown(today[0])).toContain("Bravo");
    for (const later of today.slice(1)) {
      expect(shown(later)).toMatch(/Bravo|Charlie/);
      expect(later.body).toMatch(HEDGED);
      // No counts, nothing that says it is open: a tick on the widget would make them wrong.
      expect(shown(later)).not.toMatch(ASSERTS_OPEN);
    }
  });

  it("the earliest slot is the next one by the clock, whatever its kind", () => {
    // 16:30: the progress nudges are over, so the 17:00 evening one is next.
    const today = planFor({ now: monday(16, 30), tasks }).filter((item) => item.id.includes(":2026-10-12:"));
    expect(today[0].id).toBe("daily-tasks:2026-10-12:evening:1700");
    // The next one says it plainly, in the evening's words.
    expect(shown(today[0])).toMatch(/Still open tonight|Still open: Bravo\.|No rush\. If there's five minutes left today: Bravo\./);
    expect(today.slice(1).every((item) => HEDGED.test(item.body))).toBe(true);
    expect(today.slice(1).some((item) => ASSERTS_OPEN.test(shown(item)))).toBe(false);

    const hourly = planFor({
      now: monday(9, 5),
      tasks,
      settings: { ...DEFAULT_NOTIFICATIONS, hourly: true },
    }).filter((item) => item.id.includes(":2026-10-12:"));
    expect(hourly).toHaveLength(12);
    expect(hourly.filter((item) => /\d/.test(shown(item))).map((item) => item.id)).toEqual([
      "daily-tasks:2026-10-12:progress:1000",
    ]);
  });

  it("tomorrow's nudge is true either way about what is open today, with no counts; the days after ask plainly", () => {
    const mornings = planFor({ now: monday(9, 5), tasks }).filter((item) => item.id.includes(":morning:"));
    expect(mornings.map((item) => item.id)).toEqual([
      "daily-tasks:2026-10-13:morning:0800",
      "daily-tasks:2026-10-14:morning:0800",
      "daily-tasks:2026-10-15:morning:0800",
      "daily-tasks:2026-10-16:morning:0800",
      "daily-tasks:2026-10-17:morning:1000",
      "daily-tasks:2026-10-18:morning:1000",
    ]);
    const [tomorrow, ...after] = mornings;
    expect(tomorrow.title).toBe("A calm start");
    expect(tomorrow.body).toMatch(
      /^(From yesterday: (Bravo|Charlie)\. Still open\? It could be one of today's three\.|From yesterday's list: (Bravo|Charlie)\. Want it in today's three\?|Yesterday's list: Bravo · Charlie\. Anything to bring into today\?)$/,
    );
    expect(tomorrow.body).not.toMatch(/\d|Alpha/);
    for (const later of after) {
      expect(later.body).toMatch(/^(Nothing picked yet\.|A fresh page\.)/);
      expect(shown(later)).not.toMatch(/Alpha|Bravo|Charlie|yesterday/);
    }
  });

  it("every morning slot of an empty day is plain about it (nothing there can be ticked from the widget)", () => {
    const slots = planReminders({
      now: monday(7, 30),
      taskCount: 0,
      completedCount: 0,
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted",
      copy: { dayKey: "2026-10-12", tasks: [], locked: false, yesterdayOpen: ["Renew passport"], hideNames: false },
    });
    expect(slots.map((slot) => slot.at.getHours())).toEqual([8, 9, 10, 11, 12]);
    for (const slot of slots) {
      expect(shown(slot)).toMatch(/Still open from yesterday/);
      expect(shown(slot)).toContain("Renew passport.");
      expect(shown(slot)).not.toMatch(/Still open\?|From yesterday's list|Yesterday's list/);
    }
  });
});

describe("what a reminder says", () => {
  const THREE = [DENTIST, REPORT, WALK];

  it("none done: the first task, as the title or as 'First up', or the whole list", () => {
    const all = lines({ kind: "progress", tasks: THREE });
    expect(new Set(all)).toEqual(
      new Set([
        "Call the dentist | First up today. Five minutes is a start.",
        "A small nudge | First up: Call the dentist. A small start counts.",
        "A small nudge | Today's three: Call the dentist · Write the report · Walk. Begin anywhere.",
        "A small nudge | First up: Call the dentist. Just the first step.",
      ]),
    );
    // Two tasks are not "three".
    expect(lines({ kind: "progress", tasks: [DENTIST, WALK] })).toContain(
      "A small nudge | On today's list: Call the dentist · Walk. Begin anywhere.",
    );
  });

  it("a one-task day is never 'first': it is today's one thing", () => {
    const all = lines({ kind: "progress", tasks: [DENTIST] });
    expect(new Set(all)).toEqual(
      new Set([
        "A small nudge | Today's one thing: Call the dentist. Five minutes is a start.",
        "A small nudge | Just one today: Call the dentist. Begin anywhere.",
        "Call the dentist | Today's one thing. A small start counts.",
      ]),
    );
    for (const certain of [true, false]) {
      for (const line of lines({ tasks: [DENTIST], certain })) {
        expect(line).not.toMatch(/First up|Today's first|Up first|Today's three|On today's list/);
      }
    }
  });

  it("some done: the count, and the first one still open in Today's order", () => {
    const tasks = [task("Call the dentist", true), REPORT, WALK];
    expect(new Set(lines({ kind: "progress", tasks }))).toEqual(
      new Set([
        "Next: Write the report | 1 of 3 done.",
        "A small nudge | 1 of 3 done. Next: Write the report.",
        "Next: Write the report | 1 done, 2 to go.",
      ]),
    );
    // "Next" follows the list's order, not the order things were done in.
    for (const line of lines({ kind: "progress", tasks: [DENTIST, task("Write the report", true), WALK, task("Read")] })) {
      expect(line).toMatch(/Next: Call the dentist/);
      expect(line).toMatch(/1 of 4 done\.|1 done, 3 to go\./);
    }
  });

  it("one left: 'One to go' with it, and no count", () => {
    const tasks = [task("Call the dentist", true), task("Write the report", true), WALK];
    expect(new Set(lines({ kind: "progress", tasks }))).toEqual(
      new Set([
        "One to go: Walk | A small finish is still a finish.",
        "A small nudge | One to go: Walk. Five minutes is a start.",
        "A small nudge | Just one left: Walk.",
      ]),
    );
  });

  it("written ahead: task first, present tense, true whether or not it was ticked since", () => {
    const tasks = [task("Call the dentist", true), REPORT, WALK];
    const all = lines({ kind: "progress", tasks, certain: false });
    expect(new Set(all)).toEqual(
      new Set([
        "Write the report | Still open? A small start counts.",
        "Walk | Still open? A small start counts.",
        "A small nudge | Write the report. Still open? Five minutes is a start.",
        "A small nudge | Walk. Still open? Five minutes is a start.",
        "A small nudge | Today's three: Call the dentist · Write the report · Walk. Anything still open?",
        "A small nudge | Write the report. If it's still open, a small start counts.",
        "A small nudge | Walk. If it's still open, a small start counts.",
      ]),
    );
    for (const situation of [{ tasks }, { tasks: THREE }, { tasks: [DENTIST] }, { yesterdayOpen: ["Renew passport", "Buy stamps"] }]) {
      for (const line of lines({ ...situation, certain: false })) {
        expect(line).not.toMatch(/Next up was|Last time|next was|Checking in/);
        if ("tasks" in situation) expect(line).not.toMatch(ASSERTS_OPEN);
      }
    }
  });

  it("written ahead, each slot names the next open task in turn: open[slotIndex % open.length]", () => {
    const tasks = [task("Alpha", true), task("Bravo"), task("Charlie"), task("Delta")];
    const open = ["Bravo", "Charlie", "Delta"];
    for (let slotIndex = 0; slotIndex < 12; slotIndex++) {
      const words = copy({ tasks, certain: false, slotIndex });
      // The whole-list lines name them all, and carry no single task's id.
      if (/Alpha · Bravo · Charlie · Delta/.test(words?.body ?? "")) {
        expect(words?.taskId).toBeUndefined();
        continue;
      }
      const expected = open[slotIndex % open.length];
      expect(shown(words)).toContain(expected);
      expect(words?.taskId).toBe(`id-${expected}`);
      for (const other of open.filter((name) => name !== expected)) expect(shown(words)).not.toContain(other);
    }
    // The next reminder always names the next task.
    for (let slotIndex = 0; slotIndex < 12; slotIndex++) {
      expect(shown(copy({ tasks, slotIndex }))).toContain("Bravo");
      expect(copy({ tasks, slotIndex })?.taskId).toBe("id-Bravo");
    }
  });

  it("the evening has evening wording, whatever the kind ('Every hour' runs progress reminders into it)", () => {
    const tasks = [task("Call the dentist", true), REPORT, WALK];
    expect(new Set(lines({ kind: "evening", tasks }))).toEqual(
      new Set([
        "Still time today | Still open tonight: Write the report. Five minutes still counts.",
        "Still time today | Still open: Write the report. A small finish is still a finish.",
        "Still time today | No rush. If there's five minutes left today: Write the report.",
        "Write the report | Still open tonight. Five minutes still counts.",
      ]),
    );
    const ahead = lines({ kind: "evening", tasks: [REPORT], certain: false });
    expect(new Set(ahead)).toEqual(
      new Set([
        "Still time today | Write the report. Still open tonight? Five minutes still counts.",
        "Write the report | No rush. If it's still open, a small finish is still a finish.",
        "Still time today | If there's five minutes left today: Write the report. No rush.",
      ]),
    );
    expect(lines({ kind: "evening", tasks, certain: false })).toContain(
      "Still time today | Today's three: Call the dentist · Write the report · Walk. Anything still open tonight?",
    );
    expect(new Set(lines({ kind: "progress", evening: true, tasks }))).toEqual(new Set(lines({ kind: "evening", tasks })));

    const hourly = planFor({ now: monday(9, 5), tasks, settings: { ...DEFAULT_NOTIFICATIONS, hourly: true } }).filter((item) =>
      item.id.includes(":2026-10-12:"),
    );
    for (const item of hourly) {
      const evening = item.fireAt.getHours() >= 17;
      expect(item.id).toContain(":progress:");
      if (evening) expect(shown(item)).toMatch(/tonight|No rush|Still time today/);
      else expect(shown(item)).not.toMatch(/tonight|No rush|Still time today/);
    }
  });

  it("nothing set, something open from yesterday: each slot offers the next of them, some name them all", () => {
    const all = lines({ kind: "morning", yesterdayOpen: ["Renew passport", "Buy stamps"] });
    expect(new Set(all)).toEqual(
      new Set([
        "Still open from yesterday | Renew passport. Want it in today's three?",
        "Still open from yesterday | Buy stamps. Want it in today's three?",
        "A calm start | Still open from yesterday: Renew passport. It could be one of today's three.",
        "A calm start | Still open from yesterday: Buy stamps. It could be one of today's three.",
        "A calm start | 2 still open from yesterday: Renew passport and Buy stamps. Want them in today's three?",
        "Still open from yesterday | Renew passport. A small start today counts.",
        "Still open from yesterday | Buy stamps. A small start today counts.",
      ]),
    );
    expect(lines({ kind: "morning", yesterdayOpen: ["A", "B", "C"] })).toContain(
      "A calm start | 3 still open from yesterday: A, B and C. Want them in today's three?",
    );
    // One only: no "2 still open", no "them".
    for (const line of lines({ kind: "morning", yesterdayOpen: ["Renew passport"] })) {
      expect(line).toContain("Renew passport.");
      expect(line).not.toMatch(/\d|them/);
    }
    // Written the evening before: true either way.
    expect(new Set(lines({ kind: "morning", yesterdayOpen: ["Renew passport", "Buy stamps"], certain: false }))).toEqual(
      new Set([
        "A calm start | From yesterday: Renew passport. Still open? It could be one of today's three.",
        "A calm start | From yesterday: Buy stamps. Still open? It could be one of today's three.",
        "A calm start | From yesterday's list: Renew passport. Want it in today's three?",
        "A calm start | From yesterday's list: Buy stamps. Want it in today's three?",
        "A calm start | Yesterday's list: Renew passport · Buy stamps. Anything to bring into today?",
      ]),
    );
  });

  it("nothing set, nothing left over: a plain prompt under the slot's own title", () => {
    for (const kind of KINDS) {
      for (const words of everyVariant({ kind })) {
        expect(words.title).toBe(GENERIC_REMINDER_COPY[kind].title);
        expect(words.body).toMatch(/^(Nothing picked yet\.|A fresh page\.)/);
      }
    }
    expect(lines({ kind: "morning" })).toContain("A calm start | Nothing picked yet. What are today's three?");
  });

  it("everything done: no reminder at all (hidden names or not)", () => {
    const tasks = [task("Call the dentist", true), task("Walk", true)];
    for (const kind of KINDS) {
      expect(copy({ kind, tasks })).toBeNull();
      expect(copy({ kind, tasks, hideNames: true })).toBeNull();
      expect(copy({ kind, tasks, certain: false })).toBeNull();
    }
    // Nothing left today; the next days' morning nudges remain.
    const plan = planFor({ now: monday(9, 5), tasks });
    expect(plan.map((item) => item.id).filter((id) => id.includes(":2026-10-12:"))).toEqual([]);
    expect(plan).toHaveLength(6);
  });

  it("never says 'missed' or 'overdue', never uses a dash, in any situation or variant", () => {
    const situations: Partial<ReminderCopyInput>[] = [
      { tasks: [DENTIST, REPORT, WALK] },
      { tasks: [DENTIST] },
      { tasks: [task("Call the dentist", true), REPORT, WALK] },
      { tasks: [task("Call the dentist", true), task("Write the report", true), WALK] },
      { yesterdayOpen: ["Renew passport"] },
      { yesterdayOpen: ["Renew passport", "Buy stamps"] },
      {},
      { locked: true },
    ];
    const all = situations.flatMap((situation) => [
      ...lines({ ...situation, certain: true }),
      ...lines({ ...situation, certain: false }),
      ...lines({ ...situation, hideNames: true }),
    ]);
    expect(all.filter((line) => /missed|overdue|late\b|fail|behind|forgot|should|must|—|–/i.test(line))).toEqual([]);
  });

  it("items that name one task carry its id (never its text) and their kind", () => {
    const tasks = [task("Call the dentist", true), REPORT, WALK];
    const plan = planFor({ now: monday(9, 5), tasks });
    const ids = new Set(tasks.map((item) => item.id));
    for (const item of plan) {
      expect(["morning", "progress", "evening"]).toContain(item.kind);
      const named = tasks.filter((t) => shown(item).includes(t.text));
      if (item.data) {
        expect(Object.keys(item.data)).toEqual(["taskId"]);
        expect(ids.has(item.data.taskId as string)).toBe(true);
        expect(named.map((t) => t.id)).toEqual([item.data.taskId]);
      } else if (!item.id.includes(":morning:")) {
        // (Tomorrow's morning names one of today's as "from yesterday", by text only.)
        expect(named.length === 1).toBe(false);
      }
    }
    expect(plan.filter((item) => item.data).length).toBeGreaterThanOrEqual(6);
  });
});

/** A day's reminders as they would show, planned from 07:30. */
const dayOf = (tasks: ReminderTask[], overrides: Partial<ReminderContext> = {}) =>
  planFor({ now: monday(7, 30), tasks, ...overrides }).map(
    (item) => `${item.id.slice("daily-tasks:".length)} | ${item.title} | ${item.body}`,
  );

describe("a full day's copy", () => {
  it("three tasks", () => {
    expect(dayOf([DENTIST, REPORT, WALK])).toMatchInlineSnapshot(`
      [
        "2026-10-12:progress:1000 | A small nudge | First up: Call the dentist. A small start counts.",
        "2026-10-12:progress:1200 | A small nudge | Today's three: Call the dentist · Write the report · Walk. Anything still open?",
        "2026-10-12:progress:1400 | A small nudge | Walk. If it's still open, a small start counts.",
        "2026-10-12:progress:1600 | Call the dentist | Still open? A small start counts.",
        "2026-10-12:evening:1700 | Write the report | No rush. If it's still open, a small finish is still a finish.",
        "2026-10-12:evening:1800 | Still time today | Today's three: Call the dentist · Write the report · Walk. Anything still open tonight?",
        "2026-10-12:evening:1900 | Still time today | If there's five minutes left today: Call the dentist. No rush.",
        "2026-10-12:evening:2000 | Still time today | Write the report. Still open tonight? Five minutes still counts.",
        "2026-10-12:evening:2100 | Walk | No rush. If it's still open, a small finish is still a finish.",
        "2026-10-12:evening:2200 | Still time today | Today's three: Call the dentist · Write the report · Walk. Anything still open tonight?",
        "2026-10-13:morning:0800 | A calm start | From yesterday: Write the report. Still open? It could be one of today's three.",
        "2026-10-14:morning:0800 | A calm start | Nothing picked yet. One is enough to begin.",
        "2026-10-15:morning:0800 | A calm start | Nothing picked yet. What are today's three?",
        "2026-10-16:morning:0800 | A calm start | Nothing picked yet. Three small things is plenty.",
        "2026-10-17:morning:1000 | A calm start | A fresh page. What are today's three?",
        "2026-10-18:morning:1000 | A calm start | Nothing picked yet. One is enough to begin.",
      ]
    `);
  });

  it("two tasks", () => {
    expect(dayOf([DENTIST, WALK])).toMatchInlineSnapshot(`
      [
        "2026-10-12:progress:1000 | A small nudge | First up: Call the dentist. A small start counts.",
        "2026-10-12:progress:1200 | A small nudge | On today's list: Call the dentist · Walk. Anything still open?",
        "2026-10-12:progress:1400 | A small nudge | Call the dentist. If it's still open, a small start counts.",
        "2026-10-12:progress:1600 | Walk | Still open? A small start counts.",
        "2026-10-12:evening:1700 | Call the dentist | No rush. If it's still open, a small finish is still a finish.",
        "2026-10-12:evening:1800 | Still time today | On today's list: Call the dentist · Walk. Anything still open tonight?",
        "2026-10-12:evening:1900 | Still time today | If there's five minutes left today: Call the dentist. No rush.",
        "2026-10-12:evening:2000 | Still time today | Walk. Still open tonight? Five minutes still counts.",
        "2026-10-12:evening:2100 | Call the dentist | No rush. If it's still open, a small finish is still a finish.",
        "2026-10-12:evening:2200 | Still time today | On today's list: Call the dentist · Walk. Anything still open tonight?",
        "2026-10-13:morning:0800 | A calm start | From yesterday: Walk. Still open? It could be one of today's three.",
        "2026-10-14:morning:0800 | A calm start | Nothing picked yet. One is enough to begin.",
        "2026-10-15:morning:0800 | A calm start | Nothing picked yet. What are today's three?",
        "2026-10-16:morning:0800 | A calm start | Nothing picked yet. Three small things is plenty.",
        "2026-10-17:morning:1000 | A calm start | A fresh page. What are today's three?",
        "2026-10-18:morning:1000 | A calm start | Nothing picked yet. One is enough to begin.",
      ]
    `);
  });

  it("one task", () => {
    expect(dayOf([DENTIST])).toMatchInlineSnapshot(`
      [
        "2026-10-12:progress:1000 | Call the dentist | Today's one thing. A small start counts.",
        "2026-10-12:progress:1200 | Call the dentist | Still open? A small start counts.",
        "2026-10-12:progress:1400 | A small nudge | Call the dentist. Still open? Five minutes is a start.",
        "2026-10-12:progress:1600 | A small nudge | Call the dentist. If it's still open, a small start counts.",
        "2026-10-12:evening:1700 | Still time today | Call the dentist. Still open tonight? Five minutes still counts.",
        "2026-10-12:evening:1800 | Call the dentist | No rush. If it's still open, a small finish is still a finish.",
        "2026-10-12:evening:1900 | Still time today | If there's five minutes left today: Call the dentist. No rush.",
        "2026-10-12:evening:2000 | Still time today | Call the dentist. Still open tonight? Five minutes still counts.",
        "2026-10-12:evening:2100 | Call the dentist | No rush. If it's still open, a small finish is still a finish.",
        "2026-10-12:evening:2200 | Still time today | If there's five minutes left today: Call the dentist. No rush.",
        "2026-10-13:morning:0800 | A calm start | From yesterday: Call the dentist. Still open? It could be one of today's three.",
        "2026-10-14:morning:0800 | A calm start | Nothing picked yet. One is enough to begin.",
        "2026-10-15:morning:0800 | A calm start | Nothing picked yet. What are today's three?",
        "2026-10-16:morning:0800 | A calm start | Nothing picked yet. Three small things is plenty.",
        "2026-10-17:morning:1000 | A calm start | A fresh page. What are today's three?",
        "2026-10-18:morning:1000 | A calm start | Nothing picked yet. One is enough to begin.",
      ]
    `);
  });

  it("nothing set, two open from yesterday", () => {
    expect(dayOf([], { yesterdayOpen: ["Renew passport", "Buy stamps"] })).toMatchInlineSnapshot(`
      [
        "2026-10-12:morning:0800 | A calm start | Still open from yesterday: Renew passport. It could be one of today's three.",
        "2026-10-12:morning:0900 | A calm start | 2 still open from yesterday: Renew passport and Buy stamps. Want them in today's three?",
        "2026-10-12:morning:1000 | Still open from yesterday | Buy stamps. A small start today counts.",
        "2026-10-12:morning:1100 | Still open from yesterday | Renew passport. Want it in today's three?",
        "2026-10-12:morning:1200 | A calm start | Still open from yesterday: Buy stamps. It could be one of today's three.",
        "2026-10-13:morning:0800 | A calm start | A fresh page. What are today's three?",
        "2026-10-14:morning:0800 | A calm start | Nothing picked yet. One is enough to begin.",
        "2026-10-15:morning:0800 | A calm start | Nothing picked yet. What are today's three?",
        "2026-10-16:morning:0800 | A calm start | Nothing picked yet. Three small things is plenty.",
        "2026-10-17:morning:1000 | A calm start | A fresh page. What are today's three?",
        "2026-10-18:morning:1000 | A calm start | Nothing picked yet. One is enough to begin.",
      ]
    `);
  });

  it("three tasks with names hidden: no task text in any title or body", () => {
    const hidden = planFor({
      now: monday(7, 30),
      tasks: [DENTIST, REPORT, WALK],
      yesterdayOpen: ["Renew passport"],
      settings: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true },
    });
    expect(hidden).toHaveLength(16);
    for (const item of hidden) {
      expect(shown(item)).not.toMatch(/dentist|report|Walk|passport/i);
      expect(GENERIC_TITLES).toContain(item.title);
      expect(NAME_FREE_BODY(item.body), item.body).toBe(true);
      expect(item.data).toBeUndefined();
    }
  });

  it("three tasks with names hidden: the day's reminders take turns, so two in a row never read the same", () => {
    const today = planFor({
      now: monday(7, 30),
      tasks: [DENTIST, REPORT, WALK],
      settings: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true },
    }).filter((item) => item.id.includes(":2026-10-12:"));
    expect(today.map((item) => item.fireAt.getHours())).toEqual([10, 12, 14, 16, 17, 18, 19, 20, 21, 22]);
    for (let i = 1; i < today.length; i++) expect(today[i].body).not.toBe(today[i - 1].body);
    // By day the day's lines under the nudge's title; from 17:00 the evening's under its own.
    for (const item of today.slice(0, 4)) {
      expect(item.title).toBe("A small nudge");
      expect(NAME_FREE_REMINDER_BODIES.day).toContain(item.body);
    }
    for (const item of today.slice(4)) {
      expect(item.title).toBe("Still time today");
      expect(NAME_FREE_REMINDER_BODIES.evening).toContain(item.body);
    }
    // All four of each are heard over the day.
    expect(new Set(today.slice(0, 4).map((item) => item.body)).size).toBe(4);
    expect(new Set(today.slice(4).map((item) => item.body)).size).toBe(4);
  });

  it("the name-free lines: four by day, four for the evening, calm and plain", () => {
    expect(NAME_FREE_REMINDER_BODIES.day).toEqual([
      "Today's three are waiting when you are.",
      "A small start still counts.",
      "Five minutes is a start.",
      "Pick one of today's three and begin anywhere.",
    ]);
    expect(NAME_FREE_REMINDER_BODIES.evening).toEqual([
      "A small finish is still a finish.",
      "No rush. Five minutes still counts.",
      "Still time for one of today's three.",
      "Today's three are here if there's time tonight.",
    ]);
    const all = [...NAME_FREE_REMINDER_BODIES.day, ...NAME_FREE_REMINDER_BODIES.evening];
    expect(new Set(all).size).toBe(8);
    for (const line of all) {
      expect(line).not.toMatch(/missed|overdue|late\b|fail|behind|forgot|should|must|[\u2012-\u2015]| - |!/i);
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it("names hidden: every slot is one step on from the one before, whatever the day, and names no task", () => {
    const tasks = [task("Call the dentist", true), REPORT, WALK];
    for (const evening of [false, true]) {
      const pool = evening ? NAME_FREE_REMINDER_BODIES.evening : NAME_FREE_REMINDER_BODIES.day;
      for (const dayKey of ["2026-10-12", "2026-10-13", "2026-12-31"]) {
        const bodies = Array.from({ length: 8 }, (_, slotIndex) => {
          const words = copy({ kind: "progress", dayKey, slotIndex, tasks, hideNames: true, evening, certain: slotIndex === 0 });
          expect(words?.title).toBe(evening ? "Still time today" : "A small nudge");
          expect(words?.taskId).toBeUndefined();
          return words?.body ?? "";
        });
        for (let i = 0; i < bodies.length; i++) {
          expect(pool).toContain(bodies[i]);
          expect(bodies[i]).toBe(pool[(pool.indexOf(bodies[0]) + i) % pool.length]);
        }
      }
    }
    // An empty day with names hidden: the plain prompt, and yesterday's tasks stay unnamed.
    for (const words of everyVariant({ hideNames: true, yesterdayOpen: ["Renew passport"] })) {
      expect(words.body).toMatch(/^(Nothing picked yet\.|A fresh page\.)/);
      expect(shown(words)).not.toMatch(/passport/i);
    }
    // A set day with nothing on it: the general line, as with names shown.
    expect(copy({ kind: "morning", locked: true, hideNames: true, yesterdayOpen: ["Renew passport"] })).toEqual(
      GENERIC_REMINDER_COPY.morning,
    );
  });
});

describe("yesterdayOpenTexts", () => {
  const record = (text: string, completed = false): DayTaskRecord =>
    ({ id: text, text, completed, carriedOver: false, rolloverOutcome: null }) as DayTaskRecord;
  const pending = (sourceDate: string) => ({
    pendingRollover: { sourceDate, tasks: [record("Renew passport"), record("Walk", true), record("Buy stamps")] },
  });

  it("the open ones, in order, when the card is from exactly the day before", () => {
    expect(yesterdayOpenTexts(pending("2026-10-11"), "2026-10-12")).toEqual(["Renew passport", "Buy stamps"]);
    // Over a month end and a clock change (calendar days, not 24 hours).
    expect(yesterdayOpenTexts(pending("2026-02-28"), "2026-03-01")).toHaveLength(2);
    expect(yesterdayOpenTexts(pending("2026-03-08"), "2026-03-09")).toHaveLength(2);
    expect(yesterdayOpenTexts(pending("2026-11-01"), "2026-11-02")).toHaveLength(2);
    expect(yesterdayOpenTexts(pending("2025-12-31"), "2026-01-01")).toHaveLength(2);
  });

  it("nothing from an older day, the same day, a later day, or no card", () => {
    expect(yesterdayOpenTexts(pending("2026-10-10"), "2026-10-12")).toEqual([]);
    expect(yesterdayOpenTexts(pending("2026-10-12"), "2026-10-12")).toEqual([]);
    expect(yesterdayOpenTexts(pending("2026-10-13"), "2026-10-12")).toEqual([]);
    expect(yesterdayOpenTexts(pending("2026-09-11"), "2026-10-12")).toEqual([]);
    expect(yesterdayOpenTexts({ pendingRollover: null }, "2026-10-12")).toEqual([]);
  });

  it("a set (locked) day with nothing on it gets the general line: nothing can be added, so nothing is offered", () => {
    expect(copy({ kind: "morning", locked: true, yesterdayOpen: ["Renew passport"] })).toEqual(
      GENERIC_REMINDER_COPY.morning,
    );
    const today = planFor({ now: monday(7, 30), locked: true, yesterdayOpen: ["Renew passport"] }).filter((item) =>
      item.id.includes(":2026-10-12:"),
    );
    expect(today).toHaveLength(5);
    expect(today.every((item) => item.body === GENERIC_REMINDER_COPY.morning.body)).toBe(true);
    // Tomorrow starts open again, whatever today's lock says.
    expect(planFor({ now: monday(7, 30), locked: true })[5].body).toMatch(/^(Nothing picked yet\.|A fresh page\.)/);
  });
});

describe("the day the tasks belong to and the clock's day", () => {
  const tasks = [DENTIST, WALK];

  it("tomorrow's nudge says 'from yesterday' only when the tasks' day is the clock's day", () => {
    const base = {
      now: monday(21, 30),
      settings: DEFAULT_NOTIFICATIONS,
      permissionState: "granted" as const,
    };
    const copyFor = (dayKey: string) => ({ dayKey, tasks, locked: false, yesterdayOpen: [], hideNames: false });
    const same = planUpcomingMornings({ ...base, copy: copyFor("2026-10-12") });
    expect(same[0].identifier).toBe("daily-tasks:2026-10-13:morning:0800");
    expect(same[0].body).toMatch(/yesterday/i);
    expect(same[0].body).toMatch(/Call the dentist|Walk/);

    // 00:00:10 before the store has changed day: the tasks are the 12th's,
    // the clock says the 13th, so "tomorrow" (the 14th) is not the day after them.
    const afterMidnight = planUpcomingMornings({ ...base, now: new Date(2026, 9, 13, 0, 0, 10), copy: copyFor("2026-10-12") });
    expect(afterMidnight[0].identifier).toBe("daily-tasks:2026-10-14:morning:0800");
    expect(afterMidnight.map((slot) => slot.body).join(" ")).not.toMatch(/yesterday|dentist|Walk/i);
  });

  it("just after midnight, before the store has changed day: its tasks are yesterday's", () => {
    const now = new Date(2026, 9, 13, 0, 0, 10);
    const stale = context({ now, today: "2026-10-12", tasks: [task("Call the dentist", true), WALK, REPORT], locked: true });
    expect(reminderCopyContext(stale)).toEqual({
      dayKey: "2026-10-13",
      tasks: [],
      locked: false,
      yesterdayOpen: ["Walk", "Write the report"],
      hideNames: false,
    });
    const plan = taskAwareStrategy(stale).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
    // The 13th reads as an empty day (morning slots), with the 12th's open ones "from yesterday".
    const clockDay = plan.filter((item) => item.id.includes(":2026-10-13:"));
    expect(clockDay.map((item) => item.id)).toEqual([8, 9, 10, 11, 12].map((h) => `daily-tasks:2026-10-13:morning:${String(h).padStart(2, "0")}00`));
    for (const item of clockDay) {
      expect(shown(item)).toMatch(/Still open from yesterday/i);
      expect(shown(item)).toMatch(/Walk|Write the report/);
      expect(shown(item)).not.toMatch(/dentist|First up|Next:|\d of \d/);
    }
    // Nothing is known about the 14th.
    expect(plan.filter((item) => !item.id.includes(":2026-10-13:")).map(shown).join(" ")).not.toMatch(/yesterday|Walk|report/i);
    // Everything done on the 12th: a plain empty day.
    const allDone = taskAwareStrategy(context({ now, today: "2026-10-12", tasks: [task("Walk", true)] }));
    expect(allDone.filter((item) => item.id.includes(":2026-10-13:"))).toHaveLength(5);
    expect(allDone.map(shown).join(" ")).not.toMatch(/Walk|yesterday/);
  });

  it("a store two or more days behind the clock says nothing about its tasks", () => {
    const stale = context({ now: monday(7, 30), today: "2026-10-10", tasks: [WALK], yesterdayOpen: ["Renew passport"] });
    expect(reminderCopyContext(stale)).toMatchObject({ dayKey: "2026-10-12", tasks: [], yesterdayOpen: [] });
    expect(taskAwareStrategy(stale).map(shown).join(" ")).not.toMatch(/Walk|passport|yesterday/);
  });

  // After flying west the store stays on its day (the 13th) while the clock reads the 12th.
  it("after westward travel: the store's tasks go out on the clock's day, and their own day's morning names them", () => {
    const plan = planFor({ now: monday(9, 5), today: "2026-10-13", tasks });
    const clockDay = plan.filter((item) => item.id.includes(":2026-10-12:"));
    // The rest of the clock's day names the store day's tasks.
    expect(clockDay.map((item) => item.fireAt.getHours())).toEqual([10, 12, 14, 16, 17, 18, 19, 20, 21, 22]);
    expect(shown(clockDay[0])).toMatch(/Call the dentist/);
    // The 13th's morning nudge (the store's own day, which has tasks) is
    // written from them, true either way; it is not an empty day.
    const next = plan.find((item) => item.id === "daily-tasks:2026-10-13:morning:0800");
    expect(shown(next)).toMatch(/Call the dentist|Walk/);
    expect(next?.body).toMatch(HEDGED);
    expect(shown(next)).not.toMatch(/Nothing picked|A fresh page|yesterday|\d/);
    // The 14th's is the day after them: what is open is "from yesterday".
    const after = plan.find((item) => item.id === "daily-tasks:2026-10-14:morning:0800");
    expect(after?.body).toMatch(/yesterday/i);
    expect(after?.body).toMatch(/Call the dentist|Walk/);
    // The rest ask plainly.
    for (const later of plan.filter((item) => item.fireAt.getDate() >= 15)) {
      expect(later.body).toMatch(/^(Nothing picked yet\.|A fresh page\.)/);
    }
    // One per id.
    expect(new Set(plan.map((item) => item.id)).size).toBe(plan.length);

    // All of them done: no morning on their day, and a plain one the day after.
    const done = planFor({ now: monday(9, 5), today: "2026-10-13", tasks: [task("Walk", true)] });
    expect(done.map((item) => item.id)).not.toContain("daily-tasks:2026-10-13:morning:0800");
    expect(done.map(shown).join(" ")).not.toMatch(/Walk|yesterday/);
  });
});

/** Run with the process in another time zone (Node re-reads TZ when it is set). */
function inTimeZone(zone: string, offsetInJanuary: number, run: () => void) {
  const before = Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = zone;
  try {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(offsetInJanuary);
    run();
  } finally {
    process.env.TZ = before;
  }
}

describe("clock changes and time zones", () => {
  const settings = DEFAULT_NOTIFICATIONS;
  const mornings = (now: Date) => planUpcomingMornings({ now, settings, permissionState: "granted" });
  const expectLocalMornings = (now: Date) => {
    const slots = mornings(now);
    expect(slots).toHaveLength(6);
    slots.forEach((slot, index) => {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index + 1);
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      expect(toDateKey(slot.at)).toBe(toDateKey(day));
      expect([slot.at.getHours(), slot.at.getMinutes()]).toEqual([weekend ? 10 : 8, 0]);
      expect(slot.identifier).toBe(`daily-tasks:${toDateKey(day)}:morning:${weekend ? "1000" : "0800"}`);
    });
    expect(new Set(slots.map((slot) => slot.identifier)).size).toBe(6);
    return slots;
  };

  it("New York, spring forward (8 March 2026): 8:00 on weekdays, 10:00 at weekends, one per day", () => {
    inTimeZone("America/New_York", 300, () => {
      // From every hour of the days around the change, including 01:30 and 03:30 on the day itself.
      for (let day = 5; day <= 9; day++) {
        for (let hour = 0; hour < 24; hour++) expectLocalMornings(new Date(2026, 2, day, hour, 30));
      }
      const slots = expectLocalMornings(new Date(2026, 2, 6, 21, 0));
      // Saturday 10:00 EST to Sunday 10:00 EDT is 23 hours: calendar days, not +24h.
      expect((slots[1].at.getTime() - slots[0].at.getTime()) / 3_600_000).toBe(23);
      expect(slots.map((slot) => slot.at.toISOString())).toEqual([
        "2026-03-07T15:00:00.000Z",
        "2026-03-08T14:00:00.000Z",
        "2026-03-09T12:00:00.000Z",
        "2026-03-10T12:00:00.000Z",
        "2026-03-11T12:00:00.000Z",
        "2026-03-12T12:00:00.000Z",
      ]);
    });
  });

  it("New York, fall back (1 November 2026): the same local hours, and today's slots are not doubled", () => {
    inTimeZone("America/New_York", 300, () => {
      for (let day = 29; day <= 33; day++) {
        for (let hour = 0; hour < 24; hour++) expectLocalMornings(new Date(2026, 9, day, hour, 30));
      }
      const slots = expectLocalMornings(new Date(2026, 9, 30, 21, 0));
      expect((slots[1].at.getTime() - slots[0].at.getTime()) / 3_600_000).toBe(25);

      // The day with two 01:00s, planned from 00:30: every hourly slot once, at its local hour.
      const plan = taskAwareStrategy(
        context({
          now: new Date(2026, 10, 1, 0, 30),
          tasks: [task("Walk")],
          settings: { ...settings, hourly: true },
        }),
      );
      const today = plan.filter((item) => item.id.includes(":2026-11-01:"));
      expect(today.map((item) => item.fireAt.getHours())).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
      expect(new Set(plan.map((item) => item.id)).size).toBe(plan.length);
      expect(plan).toHaveLength(20);
    });
  });

  it("Kiritimati (UTC+14): local days and hours, though the UTC date is the day before", () => {
    inTimeZone("Pacific/Kiritimati", -840, () => {
      const now = new Date(2026, 9, 12, 9, 5);
      // 09:05 on the 12th here is still the 11th in UTC.
      expect(now.toISOString().slice(0, 10)).toBe("2026-10-11");
      expectLocalMornings(now);
      const plan = taskAwareStrategy(context({ now, tasks: [task("Walk")] }));
      expect(plan.map((item) => item.id)).toEqual([
        "daily-tasks:2026-10-12:progress:1000",
        "daily-tasks:2026-10-12:progress:1200",
        "daily-tasks:2026-10-12:progress:1400",
        "daily-tasks:2026-10-12:progress:1600",
        "daily-tasks:2026-10-12:evening:1700",
        "daily-tasks:2026-10-12:evening:1800",
        "daily-tasks:2026-10-12:evening:1900",
        "daily-tasks:2026-10-12:evening:2000",
        "daily-tasks:2026-10-12:evening:2100",
        "daily-tasks:2026-10-12:evening:2200",
        "daily-tasks:2026-10-13:morning:0800",
        "daily-tasks:2026-10-14:morning:0800",
        "daily-tasks:2026-10-15:morning:0800",
        "daily-tasks:2026-10-16:morning:0800",
        "daily-tasks:2026-10-17:morning:1000",
        "daily-tasks:2026-10-18:morning:1000",
      ]);
      // Tomorrow's nudge is about the local today.
      expect(plan[10].body).toMatch(/yesterday/i);
      expect(plan[10].body).toContain("Walk");
    });
  });
});

describe("fitPlanToLimit", () => {
  const now = monday(9, 0);
  /** `count` owned reminders a minute apart, latest first (so order has to be worked out). */
  const bigPlan = (count: number): ReminderPlan =>
    Array.from({ length: count }, (_, i) => ({
      id: `daily-tasks:test:${String(i).padStart(3, "0")}`,
      fireAt: new Date(now.getTime() + (i + 1) * 60_000),
      title: "t",
      body: "b",
    })).reverse();

  it("room is 64 minus the notifications that aren't ours, with at least two always left free", () => {
    expect(IOS_PENDING_NOTIFICATION_LIMIT).toBe(64);
    const kept = (otherPending: number) => fitPlanToLimit(bigPlan(80), { now, otherPending }).length;
    expect(kept(0)).toBe(62);
    expect(kept(1)).toBe(62);
    expect(kept(2)).toBe(62);
    expect(kept(3)).toBe(61);
    expect(kept(10)).toBe(54);
    expect(kept(64)).toBe(0);
    expect(kept(200)).toBe(0);
    expect(kept(Number.NaN)).toBe(62);
  });

  it("keeps the soonest, in order, and drops the latest", () => {
    const fitted = fitPlanToLimit(bigPlan(80), { now, otherPending: 4 });
    expect(fitted).toHaveLength(60);
    expect(fitted[0].id).toBe("daily-tasks:test:000");
    expect(fitted[59].id).toBe("daily-tasks:test:059");
    const times = fitted.map((item) => item.fireAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("only owned ids, still in the future, one per id", () => {
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    const plan: ReminderPlan = [
      { id: "daily-tasks:a", fireAt: at(30), title: "first", body: "" },
      { id: "daily-tasks:a", fireAt: at(10), title: "second", body: "" },
      { id: "three-today:focus-timer", fireAt: at(5), title: "", body: "" },
      { id: "plus-trial-ending", fireAt: at(5), title: "", body: "" },
      { id: "daily-tasks:past", fireAt: at(-1), title: "", body: "" },
      { id: "daily-tasks:now", fireAt: at(0), title: "", body: "" },
      { id: "daily-tasks:bad", fireAt: new Date(Number.NaN), title: "", body: "" },
      { id: "daily-tasks:b", fireAt: at(20), title: "", body: "" },
    ];
    expect(fitPlanToLimit(plan, { now, otherPending: 0 }).map((item) => [item.id, item.title])).toEqual([
      ["daily-tasks:b", ""],
      ["daily-tasks:a", "first"],
    ]);
  });

  it("with 63 others pending there is room for one: the soonest", () => {
    const fitted = fitPlanToLimit(bigPlan(80), { now, otherPending: 63 });
    expect(fitted.map((item) => item.id)).toEqual(["daily-tasks:test:000"]);
  });

  it("warns in development about ids outside the prefix, with a count and no words", () => {
    const dev = globalThis as { __DEV__?: boolean };
    const before = dev.__DEV__;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    const plan: ReminderPlan = [
      { id: "nag:1", fireAt: at(5), title: "Secret title", body: "Secret body" },
      { id: "three-today:focus-timer", fireAt: at(5), title: "Secret title", body: "Secret body" },
      { id: "daily-tasks:ok", fireAt: at(5), title: "ok", body: "ok" },
    ];
    try {
      dev.__DEV__ = true;
      expect(fitPlanToLimit(plan, { now, otherPending: 0 }).map((item) => item.id)).toEqual(["daily-tasks:ok"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/dropped 2 planned reminder/);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Secret/);
      // All owned: nothing to say. Not in development: quiet.
      warn.mockClear();
      fitPlanToLimit(plan.slice(2), { now, otherPending: 0 });
      dev.__DEV__ = false;
      fitPlanToLimit(plan, { now, otherPending: 0 });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      dev.__DEV__ = before;
      warn.mockRestore();
    }
  });

  it("makes any strategy's words safe: one line, no control characters, capped", () => {
    const at = new Date(now.getTime() + 60_000);
    const [item] = fitPlanToLimit(
      [
        {
          id: "daily-tasks:nag:1",
          fireAt: at,
          title: `  Line one\nLine\ttwo\u202E \u0000${"t".repeat(200)}`,
          body: `Body\r\nnext\u2028line ${"b".repeat(400)}`,
          data: { taskId: "t1" },
          kind: "nag",
          interruptionLevel: "passive",
          sound: true,
        },
      ],
      { now, otherPending: 0 },
    );
    expect(item.title.startsWith("Line one Line two t")).toBe(true);
    expect(reminderGraphemes(item.title)).toHaveLength(90);
    expect(item.title.endsWith("…")).toBe(true);
    expect(item.body.startsWith("Body next line b")).toBe(true);
    expect(reminderGraphemes(item.body)).toHaveLength(240);
    // eslint-disable-next-line no-control-regex -- the point of the test
    expect(`${item.title}${item.body}`).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/);
    // The rest of the item is passed through untouched.
    expect(item).toMatchObject({ id: "daily-tasks:nag:1", fireAt: at, data: { taskId: "t1" }, kind: "nag", interruptionLevel: "passive", sound: true });
    // The standard reminders' words are already clean: fitting changes none of them.
    const plan = planFor({ now: monday(7, 30), tasks: [DENTIST, REPORT, WALK] });
    expect(fitPlanToLimit(plan, { now: monday(7, 30), otherPending: 0 })).toEqual(plan);
  });

  it("the standard reminders never come near the limit (20 at most)", () => {
    const most = planFor({
      now: monday(0, 30),
      tasks: [WALK],
      settings: { ...DEFAULT_NOTIFICATIONS, hourly: true },
    });
    expect(most).toHaveLength(20);
    expect(fitPlanToLimit(most, { now: monday(0, 30), otherPending: 2 })).toHaveLength(20);
  });
});

describe("task names made safe for a notification", () => {
  const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
  const FLAG = "\u{1F1EB}\u{1F1F7}";
  const THUMB = "\u{1F44D}\u{1F3FD}";
  const E_ACUTE = "e\u0301";
  const KEYCAP = "1\uFE0F\u20E3";

  /** Run with Intl.Segmenter missing, as on Hermes. */
  function withoutSegmenter(run: () => void) {
    const intl = Intl as unknown as { Segmenter?: unknown };
    const original = intl.Segmenter;
    intl.Segmenter = undefined;
    try {
      run();
    } finally {
      intl.Segmenter = original;
    }
  }
  /** With the engine's Intl.Segmenter, then without it. */
  function bothWays(run: (label: string) => void) {
    expect(typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter).toBe("function");
    run("Intl.Segmenter");
    withoutSegmenter(() => run("fallback"));
  }

  it("counts an emoji family, a flag, a skin tone, an accent and a keycap as one character each", () => {
    bothWays((label) => {
      const parts = [FAMILY, FLAG, THUMB, E_ACUTE, KEYCAP, FLAG, FLAG];
      expect(reminderGraphemes(parts.join("")), label).toEqual(parts);
    });
  });

  it("cuts at 60 visible characters with an ellipsis, never through a joined character", () => {
    expect(MAX_REMINDER_TASK_CHARS).toBe(60);
    bothWays((label) => {
      for (const cluster of [FAMILY, FLAG, THUMB, E_ACUTE, KEYCAP]) {
        // Exactly 60: untouched.
        expect(reminderTaskName(cluster.repeat(60)), label).toBe(cluster.repeat(60));
        // 61: 59 whole ones and the ellipsis.
        expect(reminderTaskName(cluster.repeat(61)), label).toBe(`${cluster.repeat(59)}…`);
        // The cut falls on the cluster: all of it or none of it.
        for (let lead = 55; lead <= 60; lead++) {
          const name = reminderTaskName(`${"a".repeat(lead)}${cluster}${"b".repeat(10)}`);
          const shown = reminderGraphemes(name);
          expect(shown.length, label).toBe(60);
          expect(name.endsWith("…"), label).toBe(true);
          expect(name, label).toBe(
            lead < 59 ? `${"a".repeat(lead)}${cluster}${"b".repeat(58 - lead)}…` : `${"a".repeat(59)}…`,
          );
          // No half of a surrogate pair, no joiner left dangling before the ellipsis.
          expect(name, label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|\u200D…/);
        }
      }
    });
    expect(reminderTaskName("a".repeat(60))).toBe("a".repeat(60));
    expect(reminderTaskName("a".repeat(61))).toBe(`${"a".repeat(59)}…`);
    // A cut that lands after a space leaves no space before the ellipsis.
    expect(reminderTaskName(`${"a".repeat(58)} ${"b".repeat(10)}`)).toBe(`${"a".repeat(58)}…`);
  });

  it("strips newlines, tabs, control characters and text-direction overrides to single spaces", () => {
    expect(reminderTaskName("  Call\nmom\r\n\tabout\u0000 the\u0007 trip \u2028now\u2029 ")).toBe(
      "Call mom about the trip now",
    );
    expect(reminderTaskName("Pay \u202Egnp.exe\u202C \u2066rent\u2069\u202A\u202B\u202D\u2067\u2068")).toBe(
      "Pay gnp.exe rent",
    );
    expect(reminderTaskName("a\u007Fb\u0085c\u009Fd")).toBe("a b c d");
    for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
      for (const certain of [true, false]) {
        const line = shown(copy({ tasks: [task("Line one\nLine two\u202E"), task("Tab\there")], slotIndex, certain }));
        expect(line).toMatch(/Line one Line two|Tab here/);
        // eslint-disable-next-line no-control-regex -- the point of the test
        expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/);
      }
    }
  });

  it("adds no second full stop after a name that ends in . ! ? or …", () => {
    // Every wording of a one-task day, with the name's own ending kept and no stop added after it.
    const oneThing = (text: string) => lines({ kind: "progress", tasks: [task(text)] });
    expect(oneThing("Call mom")).toContain("A small nudge | Today's one thing: Call mom. Five minutes is a start.");
    for (const ending of [".", "!", "?", "…"]) {
      expect(oneThing(`Call mom${ending}`)).toContain(`A small nudge | Today's one thing: Call mom${ending} Five minutes is a start.`);
      // As a title the name is left as written.
      expect(oneThing(`Call mom${ending}`)).toContain(`Call mom${ending} | Today's one thing. A small start counts.`);
    }
    // A cut name ends in the ellipsis, and that is its full stop.
    expect(oneThing("a".repeat(80))).toContain(`A small nudge | Just one today: ${"a".repeat(59)}… Begin anywhere.`);
    for (const text of ["Call mom.", "Call mom!", "Call mom?", "Call mom…", "a".repeat(80)]) {
      for (const certain of [true, false]) {
        for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
          const tasks = [task("Done", true), task(text), task(text)];
          for (const situation of [{ tasks: [task(text)] }, { tasks }, { yesterdayOpen: [text] }, { yesterdayOpen: [text, text] }]) {
            for (const kind of KINDS) {
              expect(copy({ ...situation, kind, certain, slotIndex })?.body).not.toMatch(/[.!?…]\./);
            }
          }
        }
      }
    }
  });

  it("a trailing comma, semicolon or colon gives way to the full stop; a name that is only those is kept", () => {
    const oneThing = (text: string) => lines({ kind: "progress", tasks: [task(text)] });
    for (const ending of [",", ";", ":", " ,", ",;:", ": ;"]) {
      expect(oneThing(`Buy milk${ending}`)).toContain("A small nudge | Today's one thing: Buy milk. Five minutes is a start.");
    }
    // Only at the end: inside the name they stay.
    expect(oneThing("Milk, eggs; bread: today")).toContain("A small nudge | Just one today: Milk, eggs; bread: today. Begin anywhere.");
    // As a title the name is left as written.
    expect(oneThing("Buy milk,")).toContain("Buy milk, | Today's one thing. A small start counts.");
    expect(oneThing(";")).toContain("A small nudge | Just one today: ;. Begin anywhere.");
    // No wording on any path ends a name with one of them and then a stop.
    for (const text of ["Buy milk,", "Buy milk;", "Buy milk:", "Buy milk ,"]) {
      for (const certain of [true, false]) {
        for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
          const tasks = [task("Done", true), task(text), task(text)];
          for (const situation of [{ tasks: [task(text)] }, { tasks }, { yesterdayOpen: [text] }]) {
            for (const kind of KINDS) {
              expect(copy({ ...situation, kind, certain, slotIndex })?.body).not.toMatch(/[,;:]\s*\./);
            }
          }
        }
      }
    }
  });

  it("a name is never a sentence's subject: its own punctuation can't land mid-sentence", () => {
    // "Call mom! is still open." and "Call mom! was on yesterday's list." read badly: the name comes last.
    const tonight = lines({ kind: "evening", tasks: [task("Done", true), task("Call mom!")] });
    expect(tonight).toContain("Still time today | Still open: Call mom! A small finish is still a finish.");
    const ahead = lines({ kind: "morning", yesterdayOpen: ["Call mom!"], certain: false });
    expect(ahead).toContain("A calm start | From yesterday's list: Call mom! Want it in today's three?");
    for (const text of ["Call mom!", "Really?", "Wait…", "Ship it."]) {
      for (const certain of [true, false]) {
        for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
          const tasks = [task("Done", true), task(text), task("Other")];
          for (const situation of [{ tasks: [task(text)] }, { tasks }, { yesterdayOpen: [text] }, { yesterdayOpen: [text, "Other"] }]) {
            for (const kind of KINDS) {
              // After the name's own ending: the end, a new sentence, or the list's next name. Never a lower-case word.
              expect(copy({ ...situation, kind, certain, slotIndex })?.body).not.toMatch(/[.!?…] (is|was|are|were)\b/);
            }
          }
        }
      }
    }
  });

  it("a name with nothing readable in it is skipped: the next readable one, else the general line", () => {
    for (const blank of ["", "   ", "\n\t \r", "\u00A0\u2003\u3000", "\u202E\u2066", "\u0000"]) {
      expect(reminderTaskName(blank)).toBe("");
      expect(copy({ kind: "evening", tasks: [task(blank)] })).toEqual(GENERIC_REMINDER_COPY.evening);
      expect(copy({ kind: "evening", tasks: [task(blank)], certain: false })).toEqual(GENERIC_REMINDER_COPY.evening);
      for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
        expect(shown(copy({ tasks: [task(blank), WALK], slotIndex }))).toMatch(/Walk/);
        expect(shown(copy({ tasks: [task(blank), WALK], slotIndex, certain: false }))).toMatch(/Walk/);
        // From yesterday: the readable ones only, else the plain prompt.
        expect(shown(copy({ yesterdayOpen: [blank, "Renew passport"], slotIndex }))).toContain("Renew passport.");
        expect(shown(copy({ yesterdayOpen: [blank, "Renew passport"], slotIndex }))).not.toMatch(/\d still open/);
      }
      expect(copy({ yesterdayOpen: [blank] })?.body).toMatch(/^(Nothing picked yet\.|A fresh page\.)/);
    }
    expect(reminderTaskName(undefined)).toBe("");
    expect(reminderTaskName(42)).toBe("");
  });
});

describe("variants", () => {
  const PINNED = [1, 2, 3];
  it("a slot's wording is fixed by its day and its place in the day, and survives a reschedule later in the day", () => {
    for (let slot = 0; slot < 8; slot++) {
      const index = reminderVariantIndex("2026-10-12", slot, 4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
      expect(reminderVariantIndex("2026-10-12", slot, 4)).toBe(index);
      // One step on from the slot before.
      expect(reminderVariantIndex("2026-10-12", slot + 1, 4)).toBe((index + 1) % 4);
    }
    // Pinned: the hash must not depend on the engine (or change between releases).
    expect(["2026-10-12", "2026-10-13", "2026-10-14"].map((day) => reminderVariantIndex(day, 0, 4))).toEqual(PINNED);
    expect(reminderVariantIndex("2026-10-12", Number.NaN, 4)).toBe(reminderVariantIndex("2026-10-12", 0, 4));
    expect(reminderVariantIndex("2026-10-12", 3, 1)).toBe(0);

    // A slot's place is counted across the whole day, not per kind: 16:00
    // (the 4th) and 17:00 (the 5th) are neighbours.
    const all = planFor({ now: monday(7, 30), tasks: [task("Alpha"), task("Bravo"), task("Charlie")] }).filter((item) =>
      item.id.includes(":2026-10-12:"),
    );
    // Written ahead, each names open[slot % 3]: slots 1..9 (the first is the plain one).
    const turn = ["Alpha", "Bravo", "Charlie"];
    all.slice(1).forEach((item, index) => {
      if (!/Alpha · Bravo · Charlie/.test(item.body)) expect(shown(item)).toContain(turn[(index + 1) % 3]);
    });

    // The 14:00 to 22:00 reminders read the same whether planned at 09:05 or
    // at 11:05 (both times they are written ahead).
    const tasks = [task("Alpha", true), task("Bravo"), task("Charlie")];
    const early = planFor({ now: monday(9, 5), tasks });
    const later = planFor({ now: monday(11, 5), tasks });
    const words = (plan: ReminderPlan) =>
      plan.filter((item) => item.fireAt.getHours() >= 14 && item.id.includes(":2026-10-12:")).map((item) => [item.id, item.body]);
    expect(words(early)).toHaveLength(8);
    expect(words(later)).toEqual(words(early));
  });

  it("two reminders in a row on the same day never read the same", () => {
    const situations: Partial<ReminderContext>[] = [
      { tasks: [task("Alpha"), task("Bravo"), task("Charlie")] },
      { tasks: [task("Alpha", true), task("Bravo"), task("Charlie")] },
      { tasks: [task("Alpha", true), task("Bravo")], settings: { ...DEFAULT_NOTIFICATIONS, hourly: true } },
      { tasks: [] },
      { tasks: [], yesterdayOpen: ["Renew passport"] },
      { tasks: [], yesterdayOpen: ["Renew passport", "Buy stamps"] },
      { tasks: [task("Alpha")] },
      { tasks: [task("Alpha"), task("Bravo")] },
      { tasks: [task("Alpha")], settings: { ...DEFAULT_NOTIFICATIONS, hourly: true } },
      { tasks: [task("Alpha"), task("Bravo"), task("Charlie")], settings: { ...DEFAULT_NOTIFICATIONS, hourly: true } },
      { tasks: [task("Alpha", true), task("Bravo"), task("Charlie")], settings: { ...DEFAULT_NOTIFICATIONS, progress: false } },
    ];
    const repeats: string[] = [];
    const lists: string[] = [];
    for (let day = 0; day < 120; day++) {
      const now = new Date(2026, 9, 1 + day, 0, 30);
      for (const situation of situations) {
        const today = planFor({ now, today: toDateKey(now), ...situation }).filter((item) =>
          item.id.includes(`:${toDateKey(now)}:`),
        );
        expect(today.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < today.length; i++) {
          if (today[i].body === today[i - 1].body) repeats.push(`${today[i - 1].id} | ${today[i].id}`);
          // Nor do two in a row both read out the whole list.
          if (/ · /.test(today[i].body) && / · /.test(today[i - 1].body)) lists.push(`${today[i - 1].id} | ${today[i].id}`);
        }
      }
    }
    expect(repeats).toEqual([]);
    expect(lists).toEqual([]);
  });
});

describe("Hide task names in notifications", () => {
  const draft: TomorrowDraft = { forDate: "2026-10-13", tasks: ["Secret plan", "Buy ring"] } as TomorrowDraft;
  const secret = /Secret|ring|Alpha|Bravo|passport|Your three for/;
  const hidden = { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true };

  it("every reminder is a line that names no task: today's, tomorrow's from a draft, and the days after", () => {
    const cases: Partial<ReminderContext>[] = [
      { now: monday(9, 5), tasks: [task("Alpha secret", true), task("Bravo")], yesterdayOpen: ["Renew passport"], draft },
      { now: monday(9, 5), tasks: [task("Alpha")], settings: { ...hidden, hourly: true }, draft },
      { now: monday(7, 30), tasks: [], yesterdayOpen: ["Renew passport"], draft },
      // The morning of the draft's own day.
      { now: new Date(2026, 9, 13, 7, 30), tasks: [], draft },
    ];
    for (const overrides of cases) {
      const plan = planFor({ settings: hidden, ...overrides });
      expect(plan.length).toBeGreaterThanOrEqual(11);
      for (const item of plan) {
        expect(NAME_FREE_BODY(item.body), item.body).toBe(true);
        expect(GENERIC_TITLES).toContain(item.title);
        expect(`${item.title} ${item.body}`).not.toMatch(secret);
      }
      // The same plan with names shown does name them (so the check above means something).
      const shown = planFor({ ...overrides, settings: { ...DEFAULT_NOTIFICATIONS, hourly: overrides.settings?.hourly ?? false } });
      expect(shown.map((item) => item.id)).toEqual(plan.map((item) => item.id));
      expect(shown.some((item) => secret.test(`${item.title} ${item.body}`))).toBe(true);
    }
  });

  it("with names shown, the morning after an evening close still carries the draft", () => {
    const tomorrow = planFor({ now: monday(21, 30), tasks: [task("Alpha", true)], draft }).find(
      (item) => item.id === "daily-tasks:2026-10-13:morning:0800",
    );
    expect(tomorrow).toMatchObject({ title: "Your three for Tuesday", body: "Secret plan · Buy ring" });
  });

  it("the draft's task names are made safe like any other: one line each, capped", () => {
    const messy = { forDate: "2026-10-13", tasks: ["Call\nmom\u202E", "  ", "x".repeat(80), "Walk\tthe dog"] } as TomorrowDraft;
    const tomorrow = planFor({ now: monday(21, 30), tasks: [task("Alpha", true)], draft: messy }).find(
      (item) => item.id === "daily-tasks:2026-10-13:morning:0800",
    );
    expect(tomorrow).toMatchObject({
      title: "Your three for Tuesday",
      body: `Call mom · ${"x".repeat(59)}… · Walk the dog`,
    });
    // Nothing readable in it: the plain nudge.
    const blank = { forDate: "2026-10-13", tasks: [" ", "\n"] } as TomorrowDraft;
    expect(planFor({ now: monday(21, 30), tasks: [task("Alpha", true)], draft: blank })[0]).toMatchObject(
      GENERIC_REMINDER_COPY.morning,
    );
  });

  it("only a saved true hides them: older saves and damaged values load as off", () => {
    const load = (notifications: unknown) =>
      normalizeState({ ...buildInitialState(monday(9)), notifications })?.notifications.hideTaskNames;
    expect(buildInitialState(monday(9)).notifications.hideTaskNames).toBe(false);
    const modern = { enabled: true, morning: true, progress: true, evening: true, hourly: false };
    expect(load({ ...modern, hideTaskNames: true })).toBe(true);
    expect(load(modern)).toBe(false);
    for (const damaged of [false, "true", 1, "yes", null, {}, [true]]) {
      expect(load({ ...modern, hideTaskNames: damaged })).toBe(false);
    }
    // The pre-1.0 shape (per-slot objects) and no settings at all.
    expect(load({ morning: { enabled: true }, evening: { enabled: false } })).toBe(false);
    expect(load({ morning: { enabled: true }, hideTaskNames: true })).toBe(true);
    expect(load({ morning: { enabled: true }, hideTaskNames: "true" })).toBe(false);
    expect(load(undefined)).toBe(false);
    expect(load("broken")).toBe(false);
  });
});

describe("strategies", () => {
  const at = (minutes: number) => new Date(monday(9, 5).getTime() + minutes * 60_000);

  it("combineStrategies joins plans, waits for async ones, and the earlier strategy wins an id", async () => {
    const nag: ReminderStrategy = async (ctx) => [
      { id: "daily-tasks:nag:1", fireAt: at(30), title: "Nag", body: `${ctx.tasks.length} open`, kind: "nag", sound: true },
      { id: "daily-tasks:2026-10-13:morning:0800", fireAt: at(90), title: "Mine", body: "loses" },
    ];
    const combined = combineStrategies(morningsStrategy, nag);
    const plan = await combined(context({ tasks: [WALK] }));
    expect(plan.map((item) => item.id)).toEqual([
      "daily-tasks:2026-10-13:morning:0800",
      "daily-tasks:2026-10-14:morning:0800",
      "daily-tasks:2026-10-15:morning:0800",
      "daily-tasks:2026-10-16:morning:0800",
      "daily-tasks:2026-10-17:morning:1000",
      "daily-tasks:2026-10-18:morning:1000",
      "daily-tasks:nag:1",
    ]);
    expect(plan[0].title).toBe("A calm start");
    expect(plan[6]).toMatchObject({ kind: "nag", sound: true, body: "1 open" });
    // The mornings alone are the standard plan's mornings.
    expect(morningsStrategy(context({ tasks: [WALK] }))).toEqual(
      taskAwareStrategy(context({ tasks: [WALK] })).filter((item) => item.kind === "morning"),
    );
    expect(await combineStrategies()(context())).toEqual([]);
  });

  it("a failing strategy fails the whole plan (nothing is half-planned)", async () => {
    const broken: ReminderStrategy = async () => {
      throw new Error("offline");
    };
    await expect(combineStrategies(morningsStrategy, broken)(context())).rejects.toThrow("offline");
  });

  it("a strategy is handed what is pending and when one last went off, so it can keep its times", async () => {
    const pending = [{ id: "daily-tasks:nag:keep", fireAt: at(42), title: "Nag", body: "kept" }];
    const lastDeliveredAt = at(-20);
    const sticky: ReminderStrategy = (ctx) =>
      ctx.pending
        .filter((item) => item.id.startsWith("daily-tasks:nag:") && item.fireAt)
        .map((item) => ({ id: item.id, fireAt: item.fireAt as Date, title: item.title, body: item.body }));
    expect(await sticky(context({ pending, lastDeliveredAt }))).toEqual([
      { id: "daily-tasks:nag:keep", fireAt: at(42), title: "Nag", body: "kept" },
    ]);
    // The standard strategy plans the same whatever is pending.
    expect(taskAwareStrategy(context({ tasks: [WALK], pending, lastDeliveredAt }))).toEqual(taskAwareStrategy(context({ tasks: [WALK] })));
  });
});

describe("createDebounced", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("request: one run after the delay; asking again restarts the wait", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debounced = createDebounced(run);
    expect(REMINDER_SYNC_DEBOUNCE_MS).toBe(500);
    expect(debounced.pending()).toBe(false);
    debounced.request();
    expect(debounced.pending()).toBe(true);
    vi.advanceTimersByTime(400);
    debounced.request();
    vi.advanceTimersByTime(400);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(debounced.pending()).toBe(false);
    // Nothing more without another request.
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
    // A request made from inside the run waits its own turn.
    const again = createDebounced(() => {
      run();
      if (run.mock.calls.length === 2) again.request();
    }, 100);
    again.request();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(2);
    expect(again.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("flush: runs a waiting run now, once; nothing when none is waiting", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debounced = createDebounced(run, 200);
    debounced.flush();
    expect(run).not.toHaveBeenCalled();
    debounced.request();
    debounced.flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(debounced.pending()).toBe(false);
    debounced.flush();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancel: drops a waiting run; a later request still works", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debounced = createDebounced(run, 200);
    debounced.request();
    debounced.cancel();
    expect(debounced.pending()).toBe(false);
    vi.advanceTimersByTime(1000);
    debounced.flush();
    expect(run).not.toHaveBeenCalled();
    debounced.cancel();
    debounced.request();
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
