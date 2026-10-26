// Nag mode (1.4, PR #91): what the review asked for. The built-in lines say
// nothing about the time of day and never pose as a real message; with task
// names hidden every level still has its full day of lines; the title starts
// with the app's name; the proxy's sanitiser sees through hidden characters,
// allows a short list of emoji and can't be unlocked by a task's own words;
// and the night the clocks go back no two nags share an id.
import { afterEach, describe, expect, it } from "vitest";

import { toDateKey } from "../lib/daily-tasks/date";
import {
  NAG_BUILT_IN_MAX_CHARS,
  NAG_CLOCK_WORDS,
  NAG_LEVELS,
  NAG_PERSONAS,
  NAG_TEMPLATES,
  builtInNagLines,
  nagPools,
  nagTaskName,
  nagTitle,
  parseNagResponse,
  type NagPersona,
} from "../lib/daily-tasks/nag";
import {
  NAG_LEVEL_COUNTS,
  nagDayNeedsPlan,
  nagMinuteAt,
  nagOpenTasks,
  nagPlanFromRecord,
  nagRecordApplies,
  nagZoneOffset,
  normalizeNagRecord,
  planNagDay,
} from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";
import * as server from "../server/providers/nag-contract.mjs";

const HOME_ZONE = process.env.TZ;
afterEach(() => {
  if (HOME_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = HOME_ZONE;
});

function allTemplates(persona: NagPersona): string[] {
  const t = NAG_TEMPLATES[persona];
  return [...t.early, ...t.mid.gentle, ...t.mid.firm, ...t.late.gentle, ...t.late.firm, ...t.late.relentless];
}
const EVERY_LINE = NAG_PERSONAS.flatMap((persona) => allTemplates(persona).map((template) => ({ persona, template })));
const general = (pool: readonly string[]) => pool.filter((template) => !template.includes("{task}"));
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const GAP = 60 * 60_000;

describe("built-in lines", () => {
  it("no line names a time of day: the stage is the step's place in the day, not the hour", () => {
    // The words the review listed, at least.
    for (const word of ["morning", "afternoon", "evening", "tonight", "night", "late", "early", "sunrise", "sunset", "lunch", "dinner", "bedtime"]) {
      expect(NAG_CLOCK_WORDS, word).toContain(word);
    }
    const clock = new RegExp(`\\b(?:${NAG_CLOCK_WORDS.join("|")})\\b`, "i");
    for (const { template } of EVERY_LINE) expect(template, template).not.toMatch(clock);
    expect("Late in the game").toMatch(clock);
    expect("Halftime check. Later.").not.toMatch(clock);
  });

  it("the lines the review named are gone, and their replacements are there", () => {
    const all = EVERY_LINE.map(({ template }) => template);
    for (const gone of [
      "Morning, sweetheart. Just checking on {task}. No rush.",
      "Hi sweetheart. Just checking on {task}. No rush.",
      "No hurry, honey. There's still a little time for {task}.",
      "I taught you to tie your shoes. You can manage ten minutes on {task}.",
      "Hi, love. {task} is on today's list. Just saying.",
      "Hey, love. Still time for {task} if you're up for it.",
      "I love you. {task} is still not done. Both things are true.",
      "Love of my life. Light of my days. {task}. Please.",
      "At this point your list is basically our third housemate.",
      "It's your mother. I notice {task} is still open.",
      "I carried you for nine months. Carry {task} for ten minutes.",
      "I'm lighting a candle for {task}. That's where we are now.",
      "This is my ninth message. I counted. Your list is still open.",
      "I did not get up this early to watch a list sit there. MOVE.",
    ]) {
      expect(all).not.toContain(gone);
    }
    for (const there of [
      "I'm not mad, I'm just asking. Did {task} happen yet?",
      "I'm only peeking at your list. I'll be peeking again.",
      "I'm not mad about {task}. I'm just asking. Again.",
      "Whatever you get done today is fine. I'll still ask, mind you.",
      "Did you do {task} yet? No? I'll wait. I won't, actually.",
      "You know what would make my day? One tick. Just the one.",
      "Don't mind me. I'll just keep bringing up {task}.",
      "I've put {task} on the fridge. With a magnet. That's where we are.",
      "Do I have to come over there about {task}?",
      "I've lost count of my reminders. I'm starting the count over.",
      "{task} is on today's list. Just saying. I'll say it again.",
      "Is {task} ticked, or is it 'about to' be ticked?",
      "Hey, champ. First play of the day: {task}.",
      "Eyes front, recruit. Today's mission: {task}.",
      "Inspection time. The list is waiting, recruit.",
      "Roll call. {task}: still not ticked, recruit.",
      "{task} is STILL on my board, recruit. I checked.",
      "I did not polish these boots to watch a list sit there. MOVE.",
    ]) {
      expect(all, there).toContain(there);
    }
  });

  it("no line poses as a real message from a real person, or has an em dash or an emoji", () => {
    for (const { template } of EVERY_LINE) {
      expect(template, template).not.toMatch(/\bit'?s (?:me|your (?:mother|mom|mum|wife|husband|coach))\b|\bme again\b|\b(?:call|text|phone|ring) me\b|\bpick up\b/i);
      expect(template, template).not.toMatch(/[–—]|\p{Extended_Pictographic}/u);
    }
  });

  it("every line, with the longest task name, is 110 characters or fewer and passes the proxy's own sanitiser", () => {
    const longest = "W".repeat(60);
    for (const { persona, template } of EVERY_LINE) {
      const text = template.replace("{task}", () => nagTaskName(longest));
      expect(Array.from(text).length, text).toBeLessThanOrEqual(NAG_BUILT_IN_MAX_CHARS);
      expect(server.cleanNagLine(text, { persona, ownTexts: [longest] }), text).toBe(text);
      // And the words the sanitiser now refuses aren't in any of them.
      expect(template, template).not.toMatch(/\b(?:yourself|nobody|locked|package|asap|declined|give up)\b/i);
    }
  });

  it("no line appears twice, in a persona or across them", () => {
    const all = EVERY_LINE.map(({ template }) => template.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });

  it("every stage of every persona has three or four more general lines than before: early 6, mid 6, late 7", () => {
    for (const persona of NAG_PERSONAS) {
      const t = NAG_TEMPLATES[persona];
      expect(general(t.early), persona).toHaveLength(6);
      expect(general(t.mid.gentle).length + general(t.mid.firm).length, persona).toBe(6);
      expect(general(t.late.gentle).length + general(t.late.firm).length + general(t.late.relentless).length, persona).toBe(7);
    }
  });

  it("with task names hidden every level gets its full count, on any day, with no line twice and no task named", () => {
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        const days = new Set<string>();
        for (let day = 0; day < 60; day += 1) {
          const lines = builtInNagLines({ persona, level, tasks: [], count: NAG_LEVEL_COUNTS[level], seed: `2026-10-${day}|salt` });
          expect(lines, `${persona} ${level} ${day}`).toHaveLength(NAG_LEVEL_COUNTS[level]);
          expect(new Set(lines.map((line) => line.text)).size).toBe(lines.length);
          for (const line of lines) {
            expect(line.taskIndex).toBeNull();
            expect(line.text).not.toContain("{task}");
            expect(line.text).not.toContain("“");
          }
          days.add(lines.map((line) => line.text).join("|"));
        }
        // Not the same lines in the same order every day.
        expect(days.size, `${persona} ${level}`).toBeGreaterThan(20);
      }
    }
  });

  it("with names hidden a level still never reaches above itself", () => {
    for (const persona of NAG_PERSONAS) {
      const t = NAG_TEMPLATES[persona];
      for (let day = 0; day < 30; day += 1) {
        const gentle = builtInNagLines({ persona, level: "gentle", tasks: [], count: 4, seed: day }).map((line) => line.text);
        for (const text of gentle) expect([...t.early, ...t.mid.gentle, ...t.late.gentle], text).toContain(text);
        const firm = builtInNagLines({ persona, level: "firm", tasks: [], count: 7, seed: day }).map((line) => line.text);
        for (const text of firm) expect(t.late.relentless, text).not.toContain(text);
      }
      expect(nagPools(persona, "gentle", "late")).toEqual([t.late.gentle]);
    }
  });

  it("a whole planned day with names hidden schedules every nag of the level", () => {
    const dayKey = "2026-10-12";
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        const settings = { ...NAG_ON, nagPersona: persona, nagLevel: level, hideTaskNames: true };
        const now = nagMinuteAt(dayKey, 6 * 60);
        const record = planNagDay({ previous: null, now, dayKey, settings, open: nagOpenTasks(tasks), salt: "s" });
        const plan = nagPlanFromRecord(record, { now, today: dayKey, settings, permissionState: "granted", tasks, plus: true });
        expect(plan, `${persona} ${level}`).toHaveLength(NAG_LEVEL_COUNTS[level]);
        for (const item of plan) {
          expect(item.body).not.toMatch(/Zorvex/);
          expect(item.data).not.toHaveProperty("taskId");
        }
      }
    }
  });
});

describe("the title", () => {
  it("starts with the app's name, so a bare 'Mom' never sits on the lock screen", () => {
    expect(NAG_PERSONAS.map(nagTitle)).toEqual(["Three Today · Mom", "Three Today · Dad", "Three Today · Partner", "Three Today · Coach", "Three Today · Drill sergeant"]);
    const dayKey = "2026-10-12";
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    for (const persona of NAG_PERSONAS) {
      const settings = { ...NAG_ON, nagPersona: persona };
      const now = nagMinuteAt(dayKey, 8 * 60);
      const record = planNagDay({ previous: null, now, dayKey, settings, open: nagOpenTasks(tasks), salt: "s" });
      const plan = nagPlanFromRecord(record, { now, today: dayKey, settings, permissionState: "granted", tasks, plus: true });
      expect(plan.length).toBeGreaterThan(0);
      for (const item of plan) expect(item.title).toBe(nagTitle(persona));
    }
  });
});

describe("the proxy's sanitiser, hardened", () => {
  const drop = (text: string, options: { persona?: string; ownTexts?: string[] } = { persona: "mom" }) =>
    expect(server.cleanNagLine(text, options), JSON.stringify(text)).toBe("");
  const keep = (text: string, options: { persona?: string; ownTexts?: string[] } = { persona: "mom" }) =>
    expect(server.cleanNagLine(text, options), JSON.stringify(text)).toBe(text);

  it.each([
    ["call me", "Call me when the list is done."],
    ["call me (end of line)", "When you see this, call me"],
    ["phone me", "Phone me about the list."],
    ["text me", "Text me once it is ticked."],
    ["asap", "Tick it off ASAP, friend."],
    ["declined", "Your card was declined, also your list."],
    ["locked", "You will be locked out of the list."],
    ["expire", "This reminder will expire soon."],
    ["expires", "Your list expires today."],
    ["expired", "The list has expired."],
    ["evict", "They will evict the list."],
    ["eviction", "An eviction notice for your list."],
    ["package", "Your package is waiting, like your list."],
    ["apple id", "Your Apple ID needs the list done."],
    ["you always", "You always leave the list open."],
    ["you never", "You never finish the list."],
    ["give up", "Do not give up on the list."],
    ["embarrassing", "This list is getting embarrassing."],
    ["embarrass", "Do not embarrass the list."],
    ["kys", "kys, says the list."],
    ["unalive", "The list wants to unalive the task."],
  ])("drops a line with %s", (_name, text) => {
    drop(text);
    expect(server.hitsNagBlocklist(text)).toBe(true);
  });

  it("the new patterns are whole words: ordinary lines still pass", () => {
    for (const text of [
      "The list is unlocked and waiting for you.",
      "Recall me saying the list was short?",
      "I expect one tick. Just one.",
      "Context: me, looking at your list.",
      "You could always start with the small one.",
      "Packaged up neatly: one list, three items.",
    ]) {
      keep(text);
    }
  });

  it("folds the text before matching: full-width letters, accents, zero-width characters and soft hyphens hide nothing", () => {
    for (const text of [
      "You are an id​iot about lists.",
      "What a lo⁠ser of a list.",
      "Stu­pid list, still open.",
      "﻿Such a path‌etic list.",
      "Ｓｔｕｐｉｄ list.", // full-width "Stupid"
      "Stüpid list, still open.", // u with a diaeresis
      "Stúpid list, still open.", // a combining accent
      "I̶d̶i̶o̶t̶ list.", // struck through
      "Visit ex​ample.com for the list.",
      "Ring ５５５ １２３ ４５６７ about the list.", // full-width digits
    ]) {
      drop(text);
    }
    expect(server.foldForMatch("Stüp​id ｌｉｓｔ")).toBe("Stupid list");
  });

  it("zero-width characters and soft hyphens are taken out of a line that is kept; its accents stay", () => {
    expect(server.cleanNagLine("Café list, still​ open­.", { persona: "mom" })).toBe("Café list, still open.");
  });

  it("a bidi mark, override or isolate drops the line", () => {
    for (const mark of ["‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"]) {
      drop(`The list is ${mark}still open.`);
    }
  });

  it("mom and spouse may keep one emoji from the short list; any other emoji is taken out; coach and drill get none", () => {
    expect(server.NAG_EMOJI_ALLOWED).toHaveLength(9);
    for (const emoji of ["\u{1F642}", "\u{1F60A}", "\u{1F609}", "\u{1F33C}", "☕", "\u{1F36A}", "✅", "\u{1F440}", "\u{1F64F}"]) {
      for (const persona of ["mom", "spouse"]) {
        expect(server.cleanNagLine(`The list is still open ${emoji}`, { persona }), emoji).toBe(`The list is still open ${emoji}`);
      }
      for (const persona of ["coach", "drill"]) {
        expect(server.cleanNagLine(`The list is still open ${emoji}`, { persona }), emoji).toBe("The list is still open");
      }
    }
    // A heart is no longer on the list: it comes out and the line stays.
    for (const emoji of ["❤️", "❤", "\u{1F49B}", "\u{1F495}", "\u{1F618}", "\u{1F60D}", "\u{1F52A}", "\u{1F480}", "\u{1F621}", "\u{1F4A9}", "\u{1F595}", "\u{1F6A8}", "\u{1F4B8}", "\u{1F389}", "\u{1F64F}\u{1F3FD}", "\u{1F468}‍\u{1F469}‍\u{1F467}"]) {
      expect(server.cleanNagLine(`The list is still open ${emoji}`, { persona: "mom" }), emoji).toBe("The list is still open");
    }
    // One at most, and one that isn't allowed doesn't use up the turn.
    expect(server.cleanNagLine("\u{1F389} Still open \u{1F642} and waiting ☕", { persona: "spouse" })).toBe("Still open \u{1F642} and waiting");
  });

  it("the user's own words still don't count against a line that repeats the task", () => {
    keep("Time to kill the weeds, friend.", { persona: "mom", ownTexts: ["Kill the weeds"] });
    keep("The pills are still on your list.", { persona: "mom", ownTexts: ["Take the pills"] });
    keep("Still open: hit the gym.", { persona: "coach", ownTexts: ["Hit the gym"] });
    keep("End the day with a walk, it is still open.", { persona: "mom", ownTexts: ["End the day with a walk"] });
  });

  it("but a task's words can't unlock harm said to the person, or 'you are' with a blocked word", () => {
    const tasks = ["kill", "hurt", "end", "hate", "hit", "Kill you", "Hate yourself", "Feed the pigs", "Call the idiot", "Be less lazy", "Buy fat balls for the birds"];
    for (const text of [
      "I will kill you if this stays open.",
      "This list will hurt you.",
      "I could end you over this list.",
      "I hate you and this list.",
      "I should hit you with this list.",
      "Kill yourself over the list.",
      "I hate u, says the list.",
      "You're an idiot about this list.",
      "You are lazy today.",
      "You are so fat with tasks.",
      "You're a pig about lists.",
      "You’re so lazy, list still open.",
    ]) {
      drop(text, { persona: "mom", ownTexts: tasks });
      expect(server.hitsNagBlocklist(text, tasks), text).toBe(true);
    }
    // Through the whole sanitiser, with the task sent.
    const payload = { persona: "mom", level: "firm", count: 6, tasks: [{ text: "kill" }, { text: "Be less lazy" }] };
    const result = server.sanitizeNagLines(
      {
        lines: [
          { step: 1, taskIndex: 0, text: "I will kill you, list or no list." },
          { step: 2, taskIndex: 1, text: "You are lazy and the list knows." },
          { step: 3, taskIndex: 1, text: "Be less lazy is still on your list." },
        ],
      },
      payload,
    );
    expect(result.lines.map((line: { text: string }) => line.text)).toEqual(["Be less lazy is still on your list."]);
  });

  it("the prompt tells the model not to name the time of day, and which emoji it may use", () => {
    expect(server.NAG_SYSTEM_PROMPT).toContain(
      "- Do not mention the time of day or a meal (morning, afternoon, evening, tonight, noon, midnight, breakfast, lunch, dinner, bedtime, late): the app picks when each line is shown. A task's own words are fine.",
    );
    expect(server.NAG_SYSTEM_PROMPT).toContain("only one of these: \u{1F642} \u{1F60A} \u{1F609} \u{1F33C} ☕ \u{1F36A} ✅ \u{1F440} \u{1F64F}. No hearts.");
    expect(server.NAG_SYSTEM_PROMPT).not.toMatch(/[–—]/);
  });

  it("user text loses its invisible characters on the way into the prompt, but a family emoji stays whole", () => {
    expect(server.oneLine("Call​ the‮ dentist﻿")).toBe("Call the dentist");
    expect(server.oneLine("Hug \u{1F468}‍\u{1F469}‍\u{1F467}")).toBe("Hug \u{1F468}‍\u{1F469}‍\u{1F467}");
    expect(nagTaskName("Call​ the‮ dentist﻿")).toBe("“Call the dentist”");
    expect(nagTaskName("Hug \u{1F468}‍\u{1F469}‍\u{1F467}")).toBe("“Hug \u{1F468}‍\u{1F469}‍\u{1F467}”");
  });

  it("the phone drops a line with a bidi mark too, and strips zero-width characters from one it keeps", () => {
    const lines = parseNagResponse(
      {
        lines: [
          { step: 1, taskIndex: null, text: "Read this ‮backwards." },
          { step: 2, taskIndex: null, text: "Still​ open, fri­end." },
        ],
      },
      { taskCount: 1, count: 4 },
    );
    expect(lines).toEqual([{ step: 1, taskIndex: null, text: "Still open, friend." }]);
  });
});

describe("the night the clocks go back (US, 1 November 2026)", () => {
  const dayKey = "2026-11-01";

  it("a window over 1:00 to 2:00: every nag has its own id, an hour or more after the one before, inside the window", () => {
    process.env.TZ = "America/New_York";
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(300);
    const window = { startMinutes: 0, endMinutes: 5 * 60 };
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    let shared = 0;
    for (let salt = 0; salt < 300; salt += 1) {
      const settings = { ...NAG_ON, nagLevel: "relentless" as const, nagWindow: window };
      const now = new Date(2026, 9, 31, 23, 0);
      const record = planNagDay({ previous: null, now, dayKey, settings, open: nagOpenTasks(tasks), salt: `s${salt}` });
      // Six real hours fit in the window that night (1:00 to 2:00 happens twice).
      expect(record.slots.length, `salt ${salt}`).toBeGreaterThanOrEqual(5);
      const ids = record.slots.map((slot) => slot.id);
      expect(new Set(ids).size, `salt ${salt}: ${ids.join(" ")}`).toBe(ids.length);
      record.slots.forEach((slot, index) => {
        const at = new Date(slot.fireAtMs);
        expect(toDateKey(at)).toBe(dayKey);
        expect(slot.id).toBe(`daily-tasks:${dayKey}:nag:${String(at.getHours()).padStart(2, "0")}${String(at.getMinutes()).padStart(2, "0")}`);
        expect(slot.fireAtMs).toBeLessThanOrEqual(nagMinuteAt(dayKey, window.endMinutes).getTime());
        if (index > 0) expect(slot.fireAtMs - record.slots[index - 1].fireAtMs, `salt ${salt}`).toBeGreaterThanOrEqual(GAP);
      });
      // How many of these days had two nags with the same clock time (told apart only by the minute moved).
      const clocks = record.slots.map((slot) => new Date(slot.fireAtMs)).filter((at) => at.getHours() === 1);
      if (clocks.length >= 2) shared += 1;
    }
    expect(shared).toBeGreaterThan(50);
  });

  it("a nag that went off in the first 1:30 keeps its id: a redraw doesn't give the second 1:30 the same one", () => {
    process.env.TZ = "America/Los_Angeles";
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    const settings = { ...NAG_ON, nagLevel: "relentless" as const, nagWindow: { startMinutes: 0, endMinutes: 6 * 60 } };
    const first = planNagDay({ previous: null, now: new Date(2026, 9, 31, 23, 0), dayKey, settings, open: nagOpenTasks(tasks), salt: "s" });
    for (let minute = 0; minute < 60; minute += 7) {
      // The first 1:xx (daylight time) has gone off; it is now exactly an hour on, the second 1:xx.
      const went = new Date(2026, 10, 1, 0, 0).getTime() + (60 + minute) * 60_000;
      const past = { ...first.slots[0], id: `daily-tasks:${dayKey}:nag:01${String(minute).padStart(2, "0")}`, fireAtMs: went };
      const previous = { ...first, slots: [past] };
      const redrawn = planNagDay({
        previous,
        now: new Date(went + 30 * 60_000),
        dayKey,
        settings: { ...settings, nagWindow: { startMinutes: 0, endMinutes: 5 * 60 } },
        open: nagOpenTasks(tasks),
        salt: "s",
      });
      const ids = redrawn.slots.map((slot) => slot.id);
      expect(new Set(ids).size, ids.join(" ")).toBe(ids.length);
      expect(redrawn.slots.length).toBeGreaterThan(1);
      for (let index = 1; index < redrawn.slots.length; index += 1) {
        expect(redrawn.slots[index].fireAtMs - redrawn.slots[index - 1].fireAtMs).toBeGreaterThanOrEqual(GAP);
      }
    }
  });
});

describe("another time zone the same day", () => {
  it("the rest of the day is drawn again for the new clock, an hour or more after the last nag that went off", () => {
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    const dayKey = "2026-10-12";
    process.env.TZ = "America/Los_Angeles";
    const planned = planNagDay({ previous: null, now: nagMinuteAt(dayKey, 8 * 60), dayKey, settings: NAG_ON, open: nagOpenTasks(tasks), salt: "s" });
    expect(planned.zone).toBe(-420);
    expect(nagZoneOffset(dayKey)).toBe(-420);
    // Two have gone off; then the phone is in New York (three hours ahead).
    const instant = planned.slots[1].fireAtMs + 5 * 60_000;

    process.env.TZ = "America/New_York";
    const now = new Date(instant);
    expect(toDateKey(now)).toBe(dayKey);
    const open = nagOpenTasks(tasks);
    const context = { now, today: dayKey, settings: NAG_ON, permissionState: "granted" as const, tasks, plus: true };
    // Until it is planned again its times are for another clock: not used.
    expect(nagRecordApplies(planned, context)).toBe(false);
    expect(nagPlanFromRecord(planned, context)).toEqual([]);
    expect(nagDayNeedsPlan(planned, { dayKey, settings: NAG_ON, open })).toBe(true);

    const record = planNagDay({ previous: planned, now, dayKey, settings: NAG_ON, open, salt: "unused" });
    expect(record.zone).toBe(-240);
    expect(record.draws).toBe(planned.draws + 1);
    expect(nagDayNeedsPlan(record, { dayKey, settings: NAG_ON, open })).toBe(false);
    expect(record.slots.slice(0, 2)).toEqual(planned.slots.slice(0, 2));
    const plan = nagPlanFromRecord(record, context);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].fireAt.getTime() - planned.slots[1].fireAtMs).toBeGreaterThanOrEqual(GAP);
    for (const item of plan) {
      const minutes = item.fireAt.getHours() * 60 + item.fireAt.getMinutes();
      expect(toDateKey(item.fireAt)).toBe(dayKey);
      expect(minutes).toBeGreaterThanOrEqual(NAG_ON.nagWindow.startMinutes);
      expect(minutes).toBeLessThanOrEqual(NAG_ON.nagWindow.endMinutes);
    }
    const steps = record.slots.map((slot) => slot.step);
    expect(steps).toEqual([...new Set(steps)].sort((a, b) => a - b));
    expect(new Set(record.slots.map((slot) => slot.text)).size).toBe(record.slots.length);
  });

  it("a record saved before the zone was kept is used as it is, and the zone survives a save", () => {
    const dayKey = "2026-10-12";
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    const now = nagMinuteAt(dayKey, 8 * 60);
    const planned = planNagDay({ previous: null, now, dayKey, settings: NAG_ON, open: nagOpenTasks(tasks), salt: "s" });
    const { zone, ...old } = planned;
    const restored = normalizeNagRecord(JSON.parse(JSON.stringify(old)));
    expect(restored?.zone).toBeNull();
    expect(nagDayNeedsPlan(restored, { dayKey, settings: NAG_ON, open: nagOpenTasks(tasks) })).toBe(false);
    expect(nagPlanFromRecord(restored, { now, today: dayKey, settings: NAG_ON, permissionState: "granted", tasks, plus: true })).toHaveLength(7);
    expect(normalizeNagRecord(JSON.parse(JSON.stringify(planned)))?.zone).toBe(zone);
  });
});

describe("the day's record keeps every slot", () => {
  it("a slot saved with no words stays in the record, is never scheduled, and gets words when there is a line again", () => {
    const dayKey = "2026-10-12";
    const tasks = [{ id: "t0", text: "Zorvex", done: false }];
    const now = nagMinuteAt(dayKey, 8 * 60);
    const planned = planNagDay({ previous: null, now, dayKey, settings: NAG_ON, open: nagOpenTasks(tasks), salt: "s" });
    const blank = { ...planned, slots: planned.slots.map((slot, index) => (index === 3 ? { ...slot, text: "", taskId: null } : slot)) };
    const restored = normalizeNagRecord(JSON.parse(JSON.stringify(blank)));
    expect(restored?.slots).toHaveLength(7);
    const context = { now, today: dayKey, settings: NAG_ON, permissionState: "granted" as const, tasks, plus: true };
    const plan = nagPlanFromRecord(restored, context);
    expect(plan.map((item) => item.id)).toEqual(planned.slots.filter((_slot, index) => index !== 3).map((slot) => slot.id));
    // Planned again (another persona): the same seven times, all with words.
    const coach = { ...NAG_ON, nagPersona: "coach" as const };
    const again = planNagDay({ previous: restored, now, dayKey, settings: coach, open: nagOpenTasks(tasks), salt: "s" });
    expect(again.slots.map((slot) => [slot.id, slot.fireAtMs, slot.step])).toEqual(planned.slots.map((slot) => [slot.id, slot.fireAtMs, slot.step]));
    expect(again.slots.every((slot) => slot.text !== "")).toBe(true);
  });
});
