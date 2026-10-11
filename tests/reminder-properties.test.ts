// Task-aware reminders (1.4, PR #89), as properties over many generated days
// rather than hand-picked ones: privacy with names hidden, wording that stays
// true after a tick the app never saw, rotation, the evening, done tasks, the
// day the store is on, the 64 limit, and that nothing here can reach a network.
//
// Every property runs in each of ZONES (Node re-reads TZ when it is set), so
// the day keys and local hours are checked on both sides of the date line and
// across each zone's clock changes. Seeds are fixed: a failure repeats.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { addDays, toDateKey } from "../lib/daily-tasks/date";
import {
  NOTIFICATION_TITLE_HIDDEN,
  notificationBody,
  notificationTitle,
  startSession,
} from "../lib/daily-tasks/focus-session";
import {
  buildReminderCopy,
  cleanReminderText,
  GENERIC_REMINDER_COPY,
  MAX_REMINDER_BODY_CHARS,
  MAX_REMINDER_TITLE_CHARS,
  reminderGraphemes,
  reminderTaskName,
  type ReminderKind,
  type ReminderTask,
} from "../lib/daily-tasks/reminder-copy";
import {
  combineStrategies,
  fitPlanToLimit,
  IOS_PENDING_NOTIFICATION_LIMIT,
  morningsStrategy,
  RESERVED_PENDING_NOTIFICATIONS,
  taskAwareStrategy,
  type ReminderContext,
  type ReminderPlan,
  type ReminderPlanItem,
  type ReminderStrategy,
} from "../lib/daily-tasks/reminder-plan";
import { MANAGED_REMINDER_PREFIX } from "../lib/daily-tasks/reminders";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig, type TomorrowDraft } from "../lib/daily-tasks/types";

const ZONES = [
  "Pacific/Kiritimati", // UTC+14: the local day is ahead of UTC's
  "America/Los_Angeles", // UTC-8/-7, clock changes in March and November
  "Asia/Kolkata", // UTC+5:30
  "UTC",
  "Australia/Lord_Howe", // a half-hour clock change
  "America/Santiago", // the clock changes at midnight: some days have no 00:00
];

const HOME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = HOME_ZONE;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Run in each zone; a failure says which. */
function inEachZone(run: (zone: string) => void) {
  for (const zone of ZONES) {
    process.env.TZ = zone;
    try {
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

// Made-up words, letters only: none is in any reminder's own wording, so
// finding one in a title or body means a task's text is there.
const WORDS = [
  "Zorvex", "Plimth", "Quandle", "Brispo", "Fennock", "Wuxley", "Drambo", "Kleptu", "Mivorn", "Jastle",
  "Grobin", "Tharvy", "Yelkin", "Oswix", "Vantrip", "Skolme", "Narbex", "Uldrie", "Cowphin", "Hembrat",
  "Ixtapol", "Runcible", "Sprax", "Twillig", "Embrazo", "Agwump", "Lomfrey", "Pindrox", "Bextula", "Dwimmer",
];

interface Scenario {
  context: ReminderContext;
  /** Words only today's tasks have, only yesterday's, only the draft's. */
  taskWords: string[];
  yesterdayWords: string[];
  draftWords: string[];
}

interface ScenarioOptions {
  /** How many of the store's tasks (default: 0 to 3). */
  taskCount?: number;
  /** Which are done (default: random). */
  done?: (index: number, count: number, random: Random) => boolean;
  /** Store's day minus the clock's day (default 0). */
  storeOffset?: number;
  /** Local hour of `now` (default: any). */
  hour?: number;
  yesterdayCount?: number;
  draft?: "none" | "any";
  settings?: Partial<NotificationConfig>;
  locked?: boolean;
}

function scenario(random: Random, options: ScenarioOptions = {}): Scenario {
  const words = [...WORDS].sort(() => random.next() - 0.5);
  const phrase = () => Array.from({ length: random.int(1, 3) }, () => words.pop()!);
  const now = new Date(2026, 0, 1 + random.int(0, 729), options.hour ?? random.int(0, 23), options.hour === undefined ? random.int(0, 59) : 0);
  const clockDay = toDateKey(now);
  const today = addDays(clockDay, options.storeOffset ?? 0);

  const taskCount = options.taskCount ?? random.int(0, 3);
  const taskPhrases = Array.from({ length: taskCount }, phrase);
  const isDone = options.done ?? ((_i: number, _n: number, r: Random) => r.bool(0.35));
  const tasks: ReminderTask[] = taskPhrases.map((parts, index) => ({
    id: `t${index}`,
    text: parts.join(" "),
    done: isDone(index, taskCount, random),
  }));

  const yesterdayPhrases = Array.from({ length: options.yesterdayCount ?? (random.bool(0.4) ? random.int(1, 3) : 0) }, phrase);

  let draft: TomorrowDraft | null = null;
  let draftWords: string[] = [];
  if ((options.draft ?? "any") === "any" && random.bool(0.3)) {
    const draftPhrases = Array.from({ length: random.int(1, 3) }, phrase);
    draftWords = draftPhrases.flat();
    draft = {
      forDate: addDays(clockDay, random.int(0, 2)),
      tasks: draftPhrases.map((parts) => parts.join(" ")),
      note: "",
      because: "",
      source: "local",
    };
  }

  const settings: NotificationConfig = {
    ...DEFAULT_NOTIFICATIONS,
    morning: random.bool(0.85),
    progress: random.bool(0.85),
    evening: random.bool(0.85),
    hourly: random.bool(0.25),
    ...options.settings,
  };

  return {
    context: {
      now,
      today,
      settings,
      permissionState: "granted",
      tasks,
      locked: options.locked ?? random.bool(0.3),
      yesterdayOpen: yesterdayPhrases.map((parts) => parts.join(" ")),
      draft,
      pending: [],
      lastDeliveredAt: null,
    },
    taskWords: taskPhrases.flat(),
    yesterdayWords: yesterdayPhrases.flat(),
    draftWords,
  };
}

const bySoonest = (plan: ReminderPlan) => [...plan].sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
const planOf = (context: ReminderContext) => bySoonest(taskAwareStrategy(context));
const onClockDay = (plan: ReminderPlan, now: Date) => plan.filter((item) => toDateKey(item.fireAt) === toDateKey(now));
const afterClockDay = (plan: ReminderPlan, now: Date) => plan.filter((item) => toDateKey(item.fireAt) !== toDateKey(now));
const shown = (item: { title: string; body: string }) => `${item.title} | ${item.body}`;
const mentions = (text: string, words: string[]) => words.filter((word) => text.toLowerCase().includes(word.toLowerCase()));
/** The wording with each of `names` taken out, so the app's own words can be checked. */
const withoutNames = (text: string, names: string[]) =>
  [...names].sort((a, b) => b.length - a.length).reduce((out, name) => out.split(name).join("§"), text);

const KINDS: ReminderKind[] = ["morning", "progress", "evening"];
const GENERIC = KINDS.map((kind) => shown(GENERIC_REMINDER_COPY[kind]));

/** Wording that is true whether or not the task was ticked since it was written. */
const HEDGED = /\?|If it's still open|If there's five minutes left today/;
/** Wording that says a task is open, or how many are done. */
const ASSERTS = /Still open:|Still open tonight[:.]|Still open from|First up|Next:|to go|Just one|one thing|\bdone\b|\d/i;

const RUNS = 250;

describe("Hide task names: no task text on any path", () => {
  it("no title, body or data of any planned reminder has a word of today's tasks, yesterday's or the draft's", () => {
    inEachZone((zone) => {
      const random = seeded(89_001);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, { storeOffset: random.pick([0, 0, 0, -1, -2, 1]), settings: { hideTaskNames: true } });
        const secrets = [...made.taskWords, ...made.yesterdayWords, ...made.draftWords];
        for (const strategy of [taskAwareStrategy, morningsStrategy]) {
          const plan = strategy(made.context);
          // As scheduled, too: the scheduler's own pass adds nothing.
          const fitted = fitPlanToLimit(plan, { now: made.context.now, otherPending: 0 });
          for (const item of [...plan, ...fitted]) {
            expect(mentions(JSON.stringify(item), secrets), `${zone} run ${run}: ${shown(item)}`).toEqual([]);
            // Not just "none of these words": exactly the general line for its kind.
            expect(GENERIC).toContain(shown(item));
            expect(shown(item)).toBe(shown(GENERIC_REMINDER_COPY[item.kind as ReminderKind]));
            expect(item.data).toBeUndefined();
          }
        }
      }
    });
  });

  it("every kind, slot and situation of the copy builder is the general line (or nothing, when all done)", () => {
    const random = seeded(89_002);
    for (let run = 0; run < 400; run++) {
      const made = scenario(random);
      const kind = random.pick(KINDS);
      const words = buildReminderCopy({
        kind,
        dayKey: made.context.today,
        slotIndex: random.pick([0, 1, 2, 3, 7, 13, -1, Number.NaN, 2.5]),
        tasks: made.context.tasks,
        locked: made.context.locked,
        yesterdayOpen: made.context.yesterdayOpen,
        hideNames: true,
        certain: random.bool(),
        evening: random.pick([undefined, true, false]),
      });
      const allDone = made.context.tasks.length > 0 && made.context.tasks.every((task) => task.done);
      if (allDone) expect(words).toBeNull();
      else expect(words).toEqual(GENERIC_REMINDER_COPY[kind]);
    }
  });

  it("the focus timer's end says \"Time's up\" and nothing of the task or its step, timer or starter", () => {
    const random = seeded(89_003);
    for (let run = 0; run < 100; run++) {
      const taskText = `${random.pick(WORDS)} ${random.pick(WORDS)}`;
      const stepText = random.bool() ? `${random.pick(WORDS)} step` : null;
      const kind = random.pick(["timer", "starter"] as const);
      const session = startSession({
        id: "s1",
        taskId: "t0",
        taskText,
        stepText,
        date: "2026-10-12",
        kind,
        minutes: random.int(1, 90),
        now: new Date(2026, 9, 12, 9).getTime(),
      });
      const hidden = `${notificationTitle(session, true)} | ${notificationBody(session, true)}`;
      expect(notificationTitle(session, true)).toBe(NOTIFICATION_TITLE_HIDDEN);
      expect(mentions(hidden, [...taskText.split(" "), ...(stepText ? stepText.split(" ") : [])])).toEqual([]);
      // "Time's up" is said once, not in both lines.
      expect(hidden.match(/Time's up/g)).toHaveLength(1);
      // With names shown the title is the task, so the switch is what hides it.
      expect(notificationTitle(session)).toBe(taskText);
      // The body never has the task's words, shown or hidden.
      expect(mentions(notificationBody(session), taskText.split(" "))).toEqual([]);
    }
  });

  it("with names shown, a task's words are only ever in the title or body: the data has ids and the kind, never text", () => {
    inEachZone(() => {
      const random = seeded(89_004);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, { storeOffset: random.pick([0, 0, -1, 1]), settings: { hideTaskNames: false } });
        const secrets = [...made.taskWords, ...made.yesterdayWords, ...made.draftWords];
        for (const item of planOf(made.context)) {
          expect(mentions(JSON.stringify(item.data ?? {}), secrets)).toEqual([]);
          expect(mentions(`${item.id} ${item.kind}`, secrets)).toEqual([]);
          expect(Object.keys(item.data ?? {})).toEqual(item.data ? ["taskId"] : []);
        }
      }
    });
  });
});

describe("truth: what a reminder written ahead may say", () => {
  it("only the next reminder states that a task is open or how many are done; every later one today is true either way", () => {
    inEachZone((zone) => {
      const random = seeded(89_101);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, { taskCount: random.int(1, 3), draft: "none", settings: { hideTaskNames: false } });
        const names = made.context.tasks.map((task) => reminderTaskName(task.text));
        const today = onClockDay(planOf(made.context), made.context.now);
        today.slice(1).forEach((item) => {
          const words = withoutNames(shown(item), names);
          expect(words, `${zone} run ${run}`).toMatch(HEDGED);
          expect(words, `${zone} run ${run}`).not.toMatch(ASSERTS);
        });
      }
    });
  });

  it("tomorrow's nudge, written a day ahead from what is open now, asks rather than asserts", () => {
    inEachZone((zone) => {
      const random = seeded(89_102);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, {
          taskCount: random.int(1, 3),
          done: (index) => index > 0 && random.bool(0.4),
          draft: "none",
          settings: { hideTaskNames: false, morning: true },
        });
        const names = made.context.tasks.map((task) => reminderTaskName(task.text));
        const [tomorrow, ...later] = afterClockDay(planOf(made.context), made.context.now);
        expect(toDateKey(tomorrow.fireAt)).toBe(addDays(toDateKey(made.context.now), 1));
        const words = withoutNames(shown(tomorrow), names);
        expect(mentions(shown(tomorrow), made.taskWords).length, `${zone} run ${run}: ${shown(tomorrow)}`).toBeGreaterThan(0);
        expect(words).toMatch(/\?/);
        expect(words).not.toMatch(ASSERTS);
        // The days after know nothing of today's tasks.
        later.forEach((item) => expect(mentions(shown(item), made.taskWords)).toEqual([]));
      }
    });
  });

  it("no reminder on any path says 'missed', 'overdue', 'late', 'failed' or 'forgot', or has a dash in its own words", () => {
    inEachZone(() => {
      const random = seeded(89_103);
      const seen = new Set<string>();
      for (let run = 0; run < RUNS * 2; run++) {
        const made = scenario(random, { storeOffset: random.pick([0, 0, 0, -1, -2, 1]), settings: { hideTaskNames: random.bool(0.2) } });
        const names = [...made.context.tasks.map((task) => task.text), ...made.context.yesterdayOpen, ...(made.context.draft?.tasks ?? [])];
        for (const item of planOf(made.context)) seen.add(withoutNames(shown(item), names.map((name) => reminderTaskName(name))));
      }
      // Enough variety to mean something.
      expect(seen.size).toBeGreaterThan(40);
      for (const words of seen) {
        expect(words).not.toMatch(/missed|overdue|\blate\b|failed|forgot|behind|should have/i);
        expect(words).not.toMatch(/[\u2012\u2013\u2014\u2015]| - /);
      }
    });
  });

  it("the fixed strings have no dash either: the general lines and the focus timer's", () => {
    const session = (kind: "timer" | "starter") =>
      startSession({ id: "s", taskId: "t", taskText: "Walk", date: "2026-10-12", kind, minutes: 10, now: 0 });
    const fixed = [
      ...KINDS.flatMap((kind) => [GENERIC_REMINDER_COPY[kind].title, GENERIC_REMINDER_COPY[kind].body]),
      NOTIFICATION_TITLE_HIDDEN,
      ...[true, false].flatMap((hide) => [notificationBody(session("timer"), hide), notificationBody(session("starter"), hide)]),
    ];
    for (const text of fixed) {
      expect(text).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
      expect(text).not.toMatch(/missed|overdue/i);
    }
  });
});

describe("rotation over many days", () => {
  it("two reminders in a row on the same day never share a body, at any time of day and with any settings", () => {
    inEachZone((zone) => {
      const random = seeded(89_201);
      for (let run = 0; run < RUNS * 2; run++) {
        const made = scenario(random, { draft: "none", locked: false, settings: { hideTaskNames: false } });
        const today = onClockDay(planOf(made.context), made.context.now);
        for (let index = 1; index < today.length; index++) {
          expect(today[index].body, `${zone} run ${run}: ${shown(today[index - 1])} then ${shown(today[index])}`).not.toBe(
            today[index - 1].body,
          );
          expect(today[index].title === today[index - 1].title && today[index].body === today[index - 1].body).toBe(false);
        }
      }
    });
  });

  it.each([2, 3])("a full day with %i open tasks names each of them, by id, at least once", (count) => {
    inEachZone((zone) => {
      const random = seeded(89_202 + count);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, {
          taskCount: count,
          done: () => false,
          hour: random.int(0, 7),
          draft: "none",
          settings: { hideTaskNames: false, morning: true, progress: true, evening: true, hourly: random.bool() },
        });
        const today = onClockDay(planOf(made.context), made.context.now);
        const namedById = new Set(today.map((item) => item.data?.taskId));
        for (const task of made.context.tasks) {
          expect(namedById.has(task.id), `${zone} run ${run}: ${task.text} never named in ${today.map(shown).join(" / ")}`).toBe(true);
          expect(today.some((item) => shown(item).includes(task.text))).toBe(true);
        }
        // The id is the one whose words are there.
        for (const item of today) {
          const named = made.context.tasks.find((task) => task.id === item.data?.taskId);
          if (named) expect(shown(item)).toContain(named.text);
        }
      }
    });
  });

  it("with one of three done, a full day still names both open ones, and whatever the settings every open one is said", () => {
    inEachZone(() => {
      const random = seeded(89_204);
      for (let run = 0; run < RUNS; run++) {
        const doneIndex = random.int(0, 2);
        const made = scenario(random, {
          taskCount: 3,
          done: (index) => index === doneIndex,
          hour: random.int(0, 7),
          draft: "none",
          // At least one of the two kinds that speak on a day with tasks.
          settings: { hideTaskNames: false, ...(random.bool() ? { progress: true } : { evening: true }) },
        });
        const today = onClockDay(planOf(made.context), made.context.now);
        for (const task of made.context.tasks.filter((each) => !each.done)) {
          expect(today.some((item) => shown(item).includes(task.text))).toBe(true);
        }
      }
    });
  });

  it("yesterday's open tasks take turns: on an empty day each is offered, and the first one offered differs between days", () => {
    inEachZone((zone) => {
      const random = seeded(89_205);
      const firstNamed = new Set<number>();
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, {
          taskCount: 0,
          yesterdayCount: random.int(2, 3),
          hour: random.int(0, 7),
          draft: "none",
          locked: false,
          settings: { hideTaskNames: false, morning: true },
        });
        const today = onClockDay(planOf(made.context), made.context.now);
        expect(today.length).toBeGreaterThanOrEqual(3);
        made.context.yesterdayOpen.forEach((text) => {
          expect(today.some((item) => shown(item).includes(text)), `${zone} run ${run}: ${text} never offered`).toBe(true);
        });
        const single = today.find((item) => made.context.yesterdayOpen.filter((text) => shown(item).includes(text)).length === 1);
        if (single) firstNamed.add(made.context.yesterdayOpen.findIndex((text) => shown(single).includes(text)));
      }
      expect(firstNamed.size).toBeGreaterThan(1);
    });
  });

  it("tomorrow's single nudge doesn't always pick the same one of today's open tasks", () => {
    const tasks: ReminderTask[] = ["Zorvex", "Plimth", "Quandle"].map((text, index) => ({ id: `t${index}`, text, done: false }));
    const named = new Set<string>();
    for (let day = 0; day < 90; day++) {
      const now = new Date(2026, 0, 5 + day, 9, 5);
      const context: ReminderContext = {
        now,
        today: toDateKey(now),
        settings: DEFAULT_NOTIFICATIONS,
        permissionState: "granted",
        tasks,
        locked: false,
        yesterdayOpen: [],
        draft: null,
        pending: [],
        lastDeliveredAt: null,
      };
      const [tomorrow] = afterClockDay(planOf(context), now);
      const which = tasks.filter((task) => shown(tomorrow).includes(task.text));
      if (which.length === 1) named.add(which[0].text);
    }
    expect([...named].sort()).toEqual(["Plimth", "Quandle", "Zorvex"]);
  });
});

describe("a one-task day, and the evening", () => {
  it("a one-task day is never 'first' and never read out as a list, at any hour, done or not", () => {
    inEachZone((zone) => {
      const random = seeded(89_301);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, { taskCount: 1, done: () => false, draft: "none", settings: { hideTaskNames: false } });
        const name = made.context.tasks[0].text;
        for (const item of onClockDay(planOf(made.context), made.context.now)) {
          const words = withoutNames(shown(item), [name]);
          expect(words, `${zone} run ${run}`).not.toMatch(/\bfirst\b|First up|Today's first|Today's three|On today's list|·/i);
          expect(shown(item)).toContain(name);
          expect(item.data).toEqual({ taskId: "t0" });
        }
      }
    });
  });

  it("from 17:00 a reminder about a task reads as the evening's, whatever its kind; before 17:00 none does", () => {
    inEachZone((zone) => {
      const random = seeded(89_302);
      let evenings = 0;
      for (let run = 0; run < RUNS * 2; run++) {
        const made = scenario(random, { taskCount: random.int(1, 3), draft: "none", settings: { hideTaskNames: false } });
        if (made.context.tasks.every((task) => task.done)) continue;
        const names = made.context.tasks.map((task) => reminderTaskName(task.text));
        for (const item of onClockDay(planOf(made.context), made.context.now)) {
          const title = withoutNames(item.title, names);
          const body = withoutNames(item.body, names);
          const label = `${zone} run ${run} ${item.id}: ${shown(item)}`;
          if (item.fireAt.getHours() >= 17) {
            evenings++;
            expect(title === GENERIC_REMINDER_COPY.evening.title || /tonight|No rush/.test(body), label).toBe(true);
            expect(`${title} | ${body}`, label).not.toMatch(/First up|A small nudge|A calm start|Begin anywhere|Just the first step|Next:/);
          } else {
            expect(`${title} | ${body}`, label).not.toMatch(/tonight|Still time today/i);
          }
        }
      }
      expect(evenings).toBeGreaterThan(100);
    });
  });

  it("16:59 is not the evening and 17:00 is: the boundary is the reminder's own local hour, not the time it was written", () => {
    inEachZone(() => {
      const tasks: ReminderTask[] = [{ id: "t0", text: "Zorvex", done: false }];
      for (const writtenAt of [6, 12, 16]) {
        const now = new Date(2026, 9, 12, writtenAt, 30);
        const plan = onClockDay(
          planOf({
            now,
            today: toDateKey(now),
            settings: { ...DEFAULT_NOTIFICATIONS, hourly: true },
            permissionState: "granted",
            tasks,
            locked: false,
            yesterdayOpen: [],
            draft: null,
            pending: [],
            lastDeliveredAt: null,
          }),
          now,
        );
        // "Every hour": all of them are progress reminders.
        expect(new Set(plan.map((item) => item.kind))).toEqual(new Set(["progress"]));
        const at = (hour: number) => plan.find((item) => item.fireAt.getHours() === hour)!;
        expect(shown(at(17))).toMatch(/tonight|No rush|Still time today/);
        expect(shown(at(21))).toMatch(/tonight|No rush|Still time today/);
        if (writtenAt < 16) expect(shown(at(16))).not.toMatch(/tonight|Still time today/);
      }
    });
  });
});

describe("done tasks", () => {
  it("a done task is never the one a reminder names: not by id, and by name only where the whole list is read out as a question", () => {
    inEachZone((zone) => {
      const random = seeded(89_401);
      let listed = 0;
      for (let run = 0; run < RUNS * 2; run++) {
        const count = random.int(2, 3);
        const doneIndex = random.int(0, count - 1);
        const made = scenario(random, {
          taskCount: count,
          done: (index) => index === doneIndex || (index !== (doneIndex + 1) % count && random.bool(0.3)),
          draft: "none",
          settings: { hideTaskNames: false },
        });
        const done = made.context.tasks.filter((task) => task.done);
        const open = made.context.tasks.filter((task) => !task.done);
        expect(open.length).toBeGreaterThan(0);
        const plan = planOf(made.context);
        const [next] = onClockDay(plan, made.context.now);
        for (const item of plan) {
          const label = `${zone} run ${run}: ${shown(item)}`;
          expect(done.map((task) => task.id), label).not.toContain(item.data?.taskId);
          expect(done.some((task) => item.title.includes(task.text)), label).toBe(false);
          if (done.some((task) => item.body.includes(task.text))) {
            listed++;
            // "Today's three: A · B · C. Anything still open?": the list as it was set, and a question.
            expect(item.body, label).toMatch(/^(Today's three|On today's list): .+\. Anything still open( tonight)?\?$/);
            expect(item.data, label).toBeUndefined();
            // Written ahead only: the next reminder never lists a done task.
            expect(item, label).not.toBe(next);
          }
        }
        // The next reminder names the first open one in Today's order.
        if (next) {
          expect(next.data).toEqual({ taskId: open[0].id });
          expect(shown(next)).toContain(open[0].text);
        }
      }
      expect(listed).toBeGreaterThan(10);
    });
  });

  it("an all-done day has no reminder left today, and nothing later says a word of its tasks", () => {
    inEachZone((zone) => {
      const random = seeded(89_402);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, {
          taskCount: random.int(1, 3),
          done: () => true,
          draft: "none",
          settings: { hideTaskNames: random.bool(0.2) },
        });
        const plan = planOf(made.context);
        expect(onClockDay(plan, made.context.now), `${zone} run ${run}`).toEqual([]);
        plan.forEach((item) => expect(mentions(shown(item), made.taskWords)).toEqual([]));
        // The mornings ahead are still there (when mornings are on): a new day starts open.
        expect(plan.length).toBe(made.context.settings.enabled && made.context.settings.morning ? 6 : 0);
      }
    });
  });

  it("the store's day ahead of the clock (after flying west) and all done: that day's own morning is skipped too", () => {
    inEachZone(() => {
      const random = seeded(89_403);
      for (let run = 0; run < 60; run++) {
        const made = scenario(random, {
          taskCount: random.int(1, 3),
          done: () => true,
          storeOffset: 1,
          draft: "none",
          settings: { hideTaskNames: false, morning: true },
        });
        const plan = planOf(made.context);
        expect(onClockDay(plan, made.context.now)).toEqual([]);
        expect(plan.map((item) => toDateKey(item.fireAt))).not.toContain(made.context.today);
        expect(plan).toHaveLength(5);
      }
    });
  });
});

describe("the store's day and the clock's day", () => {
  it("store two or more days behind: nothing of its tasks or its 'from yesterday' is said, today or later", () => {
    inEachZone((zone) => {
      const random = seeded(89_501);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, {
          taskCount: random.int(1, 3),
          storeOffset: -random.int(2, 9),
          yesterdayCount: random.int(0, 3),
          draft: "none",
          settings: { hideTaskNames: false },
        });
        const plan = planOf(made.context);
        for (const item of plan) {
          expect(mentions(shown(item), [...made.taskWords, ...made.yesterdayWords]), `${zone} run ${run}: ${shown(item)}`).toEqual([]);
          expect(item.data).toBeUndefined();
          // An empty day: only morning nudges.
          expect(item.kind).toBe("morning");
        }
      }
    });
  });

  it("store one day behind (just after midnight): its open tasks are 'from yesterday', its done ones and its own leftovers are gone", () => {
    inEachZone((zone) => {
      const random = seeded(89_502);
      let offered = 0;
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, {
          taskCount: random.int(1, 3),
          storeOffset: -1,
          yesterdayCount: random.int(0, 2),
          hour: random.int(0, 9),
          draft: "none",
          locked: random.bool(),
          settings: { hideTaskNames: false, morning: true },
        });
        const open = made.context.tasks.filter((task) => !task.done);
        const done = made.context.tasks.filter((task) => task.done);
        const plan = planOf(made.context);
        const today = onClockDay(plan, made.context.now);
        for (const item of plan) {
          const label = `${zone} run ${run}: ${shown(item)}`;
          expect(item.kind, label).toBe("morning");
          expect(done.some((task) => shown(item).includes(task.text)), label).toBe(false);
          // What was "from yesterday" on the store's day is two days old now.
          expect(mentions(shown(item), made.yesterdayWords), label).toEqual([]);
          // No counts and no "next": the clock's day has nothing set on it.
          expect(withoutNames(shown(item), made.context.tasks.map((task) => task.text)), label).not.toMatch(/\d of \d|Next:|First up|to go/);
          expect(item.data, label).toBeUndefined();
        }
        for (const item of today) {
          const named = open.filter((task) => shown(item).includes(task.text));
          if (named.length > 0) {
            offered++;
            expect(shown(item)).toMatch(/yesterday/i);
          }
        }
        // The store's lock was yesterday's: a new day starts open, so the open ones are offered.
        if (open.length > 0) expect(today.every((item) => /yesterday/i.test(shown(item)))).toBe(true);
        // The days after the clock's day know nothing of them.
        afterClockDay(plan, made.context.now).forEach((item) => expect(mentions(shown(item), made.taskWords)).toEqual([]));
      }
      expect(offered).toBeGreaterThan(50);
    });
  });

  it("store one day ahead (after flying west): today names its tasks, its own morning asks, the morning after says 'yesterday'", () => {
    inEachZone((zone) => {
      const random = seeded(89_503);
      for (let run = 0; run < RUNS; run++) {
        const made = scenario(random, {
          taskCount: random.int(1, 3),
          done: (index) => index > 0 && random.bool(0.4),
          storeOffset: 1,
          yesterdayCount: 0,
          draft: "none",
          settings: { hideTaskNames: false, morning: true },
        });
        const names = made.context.tasks.map((task) => task.text);
        const plan = planOf(made.context);
        const clockDay = toDateKey(made.context.now);
        const on = (dayKey: string) => plan.filter((item) => toDateKey(item.fireAt) === dayKey);
        const label = `${zone} run ${run}`;

        // The clock's day: its remaining slots name the tasks, never as "yesterday".
        on(clockDay).forEach((item) => {
          expect(mentions(shown(item), made.taskWords).length, label).toBeGreaterThan(0);
          expect(shown(item), label).not.toMatch(/yesterday/i);
        });
        // The tasks' own day (the clock's tomorrow): one morning, hedged, no counts.
        const own = on(made.context.today);
        expect(own, label).toHaveLength(1);
        expect(mentions(shown(own[0]), made.taskWords).length, label).toBeGreaterThan(0);
        expect(withoutNames(shown(own[0]), names), label).toMatch(HEDGED);
        expect(withoutNames(shown(own[0]), names), label).not.toMatch(ASSERTS);
        expect(shown(own[0]), label).not.toMatch(/yesterday/i);
        // The day after it: what is open now, as "from yesterday", asked.
        const after = on(addDays(made.context.today, 1));
        expect(after, label).toHaveLength(1);
        expect(shown(after[0]), label).toMatch(/yesterday/i);
        expect(withoutNames(shown(after[0]), names), label).toMatch(/\?/);
        // And nothing beyond.
        plan
          .filter((item) => toDateKey(item.fireAt) > addDays(made.context.today, 1))
          .forEach((item) => expect(mentions(shown(item), made.taskWords), label).toEqual([]));
      }
    });
  });
});

describe("times, ids and clock changes in every zone", () => {
  const TODAY_HOURS = new Set([10, 12, 14, 16, 17, 18, 19, 20, 21, 22]);
  const HOURLY_HOURS = new Set([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);

  it("from every day of 2026 (each zone's clock changes included): local whole hours, in the future, unique ids that say their own local time", () => {
    inEachZone((zone) => {
      const tasks: ReminderTask[] = [
        { id: "t0", text: "Zorvex", done: false },
        { id: "t1", text: "Plimth", done: false },
      ];
      for (let day = 0; day < 365; day++) {
        for (const [hour, minute] of [[0, 30], [2, 30], [9, 5], [23, 59]] as const) {
          const now = new Date(2026, 0, 1 + day, hour, minute);
          const hourly = day % 2 === 0;
          const plan = planOf({
            now,
            today: toDateKey(now),
            settings: { ...DEFAULT_NOTIFICATIONS, hourly },
            permissionState: "granted",
            tasks,
            locked: false,
            yesterdayOpen: [],
            draft: null,
            pending: [],
            lastDeliveredAt: null,
          });
          const label = `${zone} ${now.toString()}`;
          expect(new Set(plan.map((item) => item.id)).size, label).toBe(plan.length);
          for (const item of plan) {
            expect(item.fireAt.getTime(), label).toBeGreaterThan(now.getTime());
            expect([item.fireAt.getMinutes(), item.fireAt.getSeconds(), item.fireAt.getMilliseconds()], label).toEqual([0, 0, 0]);
            const hh = String(item.fireAt.getHours()).padStart(2, "0");
            expect(item.id, label).toBe(`${MANAGED_REMINDER_PREFIX}${toDateKey(item.fireAt)}:${item.kind}:${hh}00`);
          }
          // Today's: the set hours that are still ahead, each once.
          const today = onClockDay(plan, now);
          const wanted = [...(hourly ? HOURLY_HOURS : TODAY_HOURS)].filter(
            (h) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).getTime() > now.getTime(),
          );
          expect(today.map((item) => item.fireAt.getHours()), label).toEqual(wanted);
          // The six mornings: the next six local days, 8:00 on weekdays and 10:00 at weekends.
          const mornings = afterClockDay(plan, now);
          expect(mornings, label).toHaveLength(6);
          mornings.forEach((item, index) => {
            const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index + 1, 12);
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            expect(toDateKey(item.fireAt), label).toBe(toDateKey(date));
            expect(item.fireAt.getHours(), label).toBe(weekend ? 10 : 8);
          });
        }
      }
    });
  });

  it("the plan is the same whichever zone it is written in, when the local date and time are the same", () => {
    // The wording depends on the local day key and the slot, never on UTC.
    const plans = new Map<string, string>();
    inEachZone((zone) => {
      const now = new Date(2026, 5, 15, 9, 5);
      const plan = planOf({
        now,
        today: toDateKey(now),
        settings: DEFAULT_NOTIFICATIONS,
        permissionState: "granted",
        tasks: [
          { id: "t0", text: "Zorvex", done: true },
          { id: "t1", text: "Plimth", done: false },
          { id: "t2", text: "Quandle", done: false },
        ],
        locked: false,
        yesterdayOpen: [],
        draft: null,
        pending: [],
        lastDeliveredAt: null,
      });
      plans.set(zone, JSON.stringify(plan.map((item) => [item.id, item.title, item.body, item.data])));
    });
    expect(new Set(plans.values()).size).toBe(1);
  });
});

describe("fitPlanToLimit, on generated plans", () => {
  const NOW = new Date(2026, 9, 12, 9, 5);
  const NASTY = ["\n", "\t", "\r\n", "\u0000", "\u0007", "\u001b[31m", "\u007f", "\u0085", "\u2028", "\u2029", "\u202e", "\u2066", "\u2069"];
  const WIDE = ["👨‍👩‍👧‍👦", "🇰🇮", "👍🏽", "é", "é", "1️⃣", "日本語", "a", " ", "Zorvex"];

  function nastyText(random: Random, length: number): string {
    return Array.from({ length }, () => (random.bool(0.15) ? random.pick(NASTY) : random.pick(WIDE))).join("");
  }

  function randomPlan(random: Random): ReminderPlan {
    return Array.from({ length: random.int(0, 120) }, (_unused, index): ReminderPlanItem => {
      const owned = random.bool(0.8);
      const id = random.bool(0.1)
        ? `${MANAGED_REMINDER_PREFIX}dup:${random.int(0, 3)}`
        : owned
          ? `${MANAGED_REMINDER_PREFIX}x:${index}`
          : random.pick(["three-today:focus-timer", "plus-trial-ending", "daily-task:typo", " daily-tasks:space", "", "DAILY-TASKS:caps"]);
      const fireAt = random.bool(0.05)
        ? (random.pick([new Date(Number.NaN), "2026-10-13", null, undefined, 1_800_000_000_000]) as unknown as Date)
        : new Date(NOW.getTime() + random.int(-3_600_000, 86_400_000 * 7));
      return { id, fireAt, title: nastyText(random, random.int(0, 140)), body: nastyText(random, random.int(0, 400)) };
    });
  }

  it("whatever it is handed: owned ids only, each once, future only, soonest first, within the room left, words one clean line and capped", () => {
    const random = seeded(89_701);
    for (let run = 0; run < 300; run++) {
      const plan = randomPlan(random);
      const otherPending = random.pick([0, 1, 2, 3, 40, 62, 63, 64, 65, 200, -5, Number.NaN, Number.POSITIVE_INFINITY, 1.5]);
      const fitted = fitPlanToLimit(plan, { now: NOW, otherPending });
      const others = Number.isFinite(otherPending) ? Math.max(RESERVED_PENDING_NOTIFICATIONS, otherPending) : RESERVED_PENDING_NOTIFICATIONS;
      const room = Math.max(0, Math.floor(IOS_PENDING_NOTIFICATION_LIMIT - others));
      const label = `run ${run}, ${otherPending} others`;

      expect(fitted.length, label).toBeLessThanOrEqual(room);
      // Never over iOS's limit together with the ones that aren't ours.
      if (Number.isFinite(otherPending)) expect(fitted.length + Math.max(0, otherPending), label).toBeLessThanOrEqual(Math.max(IOS_PENDING_NOTIFICATION_LIMIT, otherPending));
      expect(new Set(fitted.map((item) => item.id)).size, label).toBe(fitted.length);
      const times = fitted.map((item) => item.fireAt.getTime());
      expect([...times].sort((a, b) => a - b), label).toEqual(times);
      for (const item of fitted) {
        expect(item.id.startsWith(MANAGED_REMINDER_PREFIX), label).toBe(true);
        expect(item.fireAt).toBeInstanceOf(Date);
        expect(item.fireAt.getTime(), label).toBeGreaterThan(NOW.getTime());
        expect(reminderGraphemes(item.title).length, label).toBeLessThanOrEqual(MAX_REMINDER_TITLE_CHARS);
        expect(reminderGraphemes(item.body).length, label).toBeLessThanOrEqual(MAX_REMINDER_BODY_CHARS);
        for (const text of [item.title, item.body]) {
          expect(text, label).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
          expect(text, label).not.toMatch(/^\s|\s$| {2}/);
        }
      }

      // What it keeps is the soonest of what could be kept: nothing dropped is sooner than something kept.
      const firstOfEachId = new Map<string, number>();
      for (const item of plan) {
        const time = item.fireAt instanceof Date ? item.fireAt.getTime() : Number.NaN;
        if (typeof item.id !== "string" || !item.id.startsWith(MANAGED_REMINDER_PREFIX)) continue;
        if (!Number.isFinite(time) || time <= NOW.getTime()) continue;
        if (!firstOfEachId.has(item.id)) firstOfEachId.set(item.id, time);
      }
      expect(fitted.length, label).toBe(Math.min(room, firstOfEachId.size));
      const kept = new Set(fitted.map((item) => item.id));
      const latestKept = Math.max(...times, -Infinity);
      for (const [id, time] of firstOfEachId) if (!kept.has(id)) expect(time, label).toBeGreaterThanOrEqual(latestKept);
      // A duplicate id keeps the first one's time and words.
      for (const item of fitted) expect(item.fireAt.getTime(), label).toBe(firstOfEachId.get(item.id));
    }
  });

  it("a cut never splits a joined character: what is kept is a whole-character prefix of the cleaned words, then an ellipsis", () => {
    const random = seeded(89_702);
    for (let run = 0; run < 300; run++) {
      const raw = Array.from({ length: random.int(200, 400) }, () => random.pick(WIDE.filter((part) => part !== " "))).join("");
      for (const max of [MAX_REMINDER_TITLE_CHARS, MAX_REMINDER_BODY_CHARS]) {
        const cut = cleanReminderText(raw, max);
        const wanted = reminderGraphemes(raw);
        const got = reminderGraphemes(cut);
        if (wanted.length <= max) {
          expect(cut).toBe(raw);
          continue;
        }
        expect(got).toHaveLength(max);
        expect(got[got.length - 1]).toBe("…");
        expect(got.slice(0, -1)).toEqual(wanted.slice(0, max - 1));
        // No lone half of a surrogate pair anywhere.
        expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      }
    }
  });

  it("exactly at the cap nothing is cut, one over is; words that aren't text become empty, never 'undefined'", () => {
    const at = (count: number) => "é".repeat(count);
    const plan: ReminderPlan = [
      { id: "daily-tasks:a", fireAt: new Date(NOW.getTime() + 60_000), title: at(90), body: at(240) },
      { id: "daily-tasks:b", fireAt: new Date(NOW.getTime() + 120_000), title: at(91), body: at(241) },
      {
        id: "daily-tasks:c",
        fireAt: new Date(NOW.getTime() + 180_000),
        title: undefined as unknown as string,
        body: 42 as unknown as string,
      },
    ];
    const [a, b, c] = fitPlanToLimit(plan, { now: NOW, otherPending: 0 });
    expect([a.title, a.body]).toEqual([at(90), at(240)]);
    expect([b.title, b.body]).toEqual([`${at(89)}…`, `${at(239)}…`]);
    expect([c.title, c.body]).toEqual(["", ""]);
  });

  it("a reminder due exactly now is past; one a millisecond on is kept; the input is left as it was", () => {
    const plan: ReminderPlan = [
      { id: "daily-tasks:now", fireAt: new Date(NOW.getTime()), title: "A", body: "B" },
      { id: "daily-tasks:soon", fireAt: new Date(NOW.getTime() + 1), title: "A\nB", body: "B" },
    ];
    const before = JSON.stringify(plan);
    expect(fitPlanToLimit(plan, { now: NOW, otherPending: 0 }).map((item) => item.id)).toEqual(["daily-tasks:soon"]);
    expect(JSON.stringify(plan)).toBe(before);
    expect(plan[1].title).toBe("A\nB");
  });

  it.each([
    [63, 1],
    [62, 2],
    [40, 24],
    [64, 0],
    [0, 62],
  ])("with %i others pending there is room for %i", (others, room) => {
    const plan: ReminderPlan = Array.from({ length: 80 }, (_unused, index) => ({
      id: `daily-tasks:n:${index}`,
      fireAt: new Date(NOW.getTime() + (80 - index) * 60_000),
      title: "t",
      body: `b${index}`,
    }));
    const fitted = fitPlanToLimit(plan, { now: NOW, otherPending: others });
    expect(fitted).toHaveLength(room);
    expect(fitted.length + others).toBeLessThanOrEqual(IOS_PENDING_NOTIFICATION_LIMIT);
    // The soonest ones (the plan was latest first).
    expect(fitted.map((item) => item.id)).toEqual(Array.from({ length: room }, (_unused, index) => `daily-tasks:n:${79 - index}`));
  });

  it("the standard plan always fits whole beside up to 40 others, in any situation", () => {
    const random = seeded(89_703);
    for (let run = 0; run < 300; run++) {
      const made = scenario(random, { storeOffset: random.pick([0, -1, 1]) });
      const plan = taskAwareStrategy(made.context);
      expect(plan.length).toBeLessThanOrEqual(20);
      expect(fitPlanToLimit(plan, { now: made.context.now, otherPending: 40 })).toHaveLength(plan.length);
      // And is already clean: the scheduler's pass changes no word of it.
      const fitted = fitPlanToLimit(plan, { now: made.context.now, otherPending: 0 });
      expect(fitted.map((item) => [item.id, item.title, item.body])).toEqual(bySoonest(plan).map((item) => [item.id, item.title, item.body]));
    }
  });
});

describe("combineStrategies", () => {
  const NOW = new Date(2026, 9, 12, 9, 5);
  const context: ReminderContext = {
    now: NOW,
    today: "2026-10-12",
    settings: DEFAULT_NOTIFICATIONS,
    permissionState: "granted",
    tasks: [{ id: "t0", text: "Zorvex", done: false }],
    locked: false,
    yesterdayOpen: [],
    draft: null,
    pending: [],
    lastDeliveredAt: null,
  };
  const item = (id: string, body = id, minutesOn = 5): ReminderPlanItem => ({
    id: `daily-tasks:${id}`,
    fireAt: new Date(NOW.getTime() + minutesOn * 60_000),
    title: "t",
    body,
  });
  const later = <T,>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  it("none gives an empty plan; one gives its own", async () => {
    expect(await combineStrategies()(context)).toEqual([]);
    expect(await combineStrategies(() => [item("a")])(context)).toEqual([item("a")]);
  });

  it("joins in the order the strategies are given, not the order they finish, and the earlier strategy keeps a shared id", async () => {
    const slow: ReminderStrategy = () => later([item("a", "slow"), item("shared", "slow")], 30);
    const fast: ReminderStrategy = async () => [item("shared", "fast"), item("b", "fast")];
    const sync: ReminderStrategy = () => [item("a", "sync"), item("c", "sync"), item("c", "sync again")];
    const plan = await combineStrategies(slow, fast, sync)(context);
    expect(plan.map((each) => [each.id, each.body])).toEqual([
      ["daily-tasks:a", "slow"],
      ["daily-tasks:shared", "slow"],
      ["daily-tasks:b", "fast"],
      ["daily-tasks:c", "sync"],
    ]);
  });

  it("hands every strategy the very same context, once each", async () => {
    const seen: ReminderContext[] = [];
    const watch: ReminderStrategy = (given) => {
      seen.push(given);
      return [];
    };
    await combineStrategies(watch, watch, watch)(context);
    expect(seen).toHaveLength(3);
    seen.forEach((given) => expect(given).toBe(context));
  });

  it("a rejection, or a throw from a plain strategy, rejects the whole plan with that error (even when the others finish later)", async () => {
    const ok: ReminderStrategy = () => later([item("a")], 20);
    const rejects: ReminderStrategy = () => Promise.reject(new Error("no lines today"));
    const throws: ReminderStrategy = () => {
      throw new Error("threw");
    };
    await expect(combineStrategies(ok, rejects)(context)).rejects.toThrow("no lines today");
    await expect(combineStrategies(rejects, ok)(context)).rejects.toThrow("no lines today");
    // Not thrown at the call: a strategy is always awaited.
    const combined = combineStrategies(ok, throws);
    let promise: ReturnType<ReminderStrategy> | undefined;
    expect(() => (promise = combined(context))).not.toThrow();
    await expect(promise).rejects.toThrow("threw");
  });

  it("the mornings beside the standard plan change nothing: the same ids once each, the standard plan's words", async () => {
    const standard = taskAwareStrategy(context);
    const plan = await combineStrategies(taskAwareStrategy, morningsStrategy)(context);
    expect(plan).toEqual(standard);
    const reversed = await combineStrategies(morningsStrategy, taskAwareStrategy)(context);
    expect(reversed.map((each) => each.id).sort()).toEqual(standard.map((each) => each.id).sort());
  });
});

describe("nothing leaves the device", () => {
  it("planning any day's reminders makes no network call of any sort", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network used")));
    const forbidden = vi.fn(() => {
      throw new Error("network used");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", forbidden);
    vi.stubGlobal("WebSocket", forbidden);
    vi.stubGlobal("EventSource", forbidden);
    const beacon = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon: beacon });

    const random = seeded(89_901);
    for (let run = 0; run < 200; run++) {
      const made = scenario(random, { storeOffset: random.pick([0, -1, 1]), settings: { hideTaskNames: random.bool() } });
      const plan = await combineStrategies(taskAwareStrategy, morningsStrategy)(made.context);
      fitPlanToLimit(plan, { now: made.context.now, otherPending: 2 });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("the modules that write and schedule reminders import nothing that could send: no analytics, no AI client, no fetch", () => {
    const dir = join(__dirname, "..", "lib", "daily-tasks");
    const allowed: Record<string, string[]> = {
      "reminder-copy.ts": [],
      "reminders.ts": ["./date", "./reminder-copy", "./types"],
      "reminder-plan.ts": ["./date", "./reminder-copy", "./reminders", "./types"],
      "notifications.ts": ["react-native", "expo-notifications", "./reminder-plan", "./reminders", "./types"],
    };
    for (const [file, imports] of Object.entries(allowed)) {
      const source = readFileSync(join(dir, file), "utf8");
      const found = [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]);
      expect([...new Set(found)].sort(), file).toEqual([...imports].sort());
      expect(source, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\btrack\s*\(/);
    }
    // date.ts and reminder-copy.ts, which they lean on, are leaves.
    expect(readFileSync(join(dir, "date.ts"), "utf8")).not.toMatch(/\bimport\b|\bfetch\s*\(/);
  });
});
